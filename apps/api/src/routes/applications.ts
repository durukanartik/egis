import { Router } from "express";
import { nanoid } from "nanoid";
import { db, recordAudit } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { applySuspensionCascade, licenceIsUsable, upgradeEligibility, type EspRow } from "../lib/lifecycle.js";
import { runDocumentScreening } from "../lib/aiScreening.js";
import { runScoring, type Criterion, type IntegratedData, type LifecycleRules, type TierThresholds } from "../lib/scoring.js";

export const applicationsRouter = Router();
applicationsRouter.use(requireAuth);

function getEsp(espId: string): EspRow {
  return db.prepare("SELECT * FROM esps WHERE id = ?").get(espId) as EspRow;
}

function getPublishedConfig() {
  const row = db.prepare("SELECT * FROM config_versions WHERE status = 'published' ORDER BY version_number DESC LIMIT 1").get() as
    | {
        id: string;
        version_number: number;
        criteria_json: string;
        lifecycle_rules_json: string;
        tier_thresholds_json: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    version_number: row.version_number,
    criteria: JSON.parse(row.criteria_json) as Criterion[],
    lifecycleRules: JSON.parse(row.lifecycle_rules_json) as LifecycleRules,
    tierThresholds: JSON.parse(row.tier_thresholds_json) as TierThresholds,
  };
}

function getIntegratedData(espId: string): IntegratedData {
  const bolisaty = db
    .prepare("SELECT payload_json FROM integrated_data_snapshots WHERE esp_id = ? AND source = 'bolisaty' ORDER BY captured_at DESC LIMIT 1")
    .get(espId) as { payload_json: string } | undefined;
  const iwms = db
    .prepare("SELECT payload_json FROM integrated_data_snapshots WHERE esp_id = ? AND source = 'iwms' ORDER BY captured_at DESC LIMIT 1")
    .get(espId) as { payload_json: string } | undefined;
  // Compliance/violations sample: MVP assumes zero open violations unless seeded otherwise.
  return {
    bolisaty: bolisaty ? JSON.parse(bolisaty.payload_json) : {},
    iwms: iwms ? JSON.parse(iwms.payload_json) : {},
    compliance: { open_violations: 0 },
  };
}

applicationsRouter.get("/", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = db
    .prepare(
      `SELECT a.*, e.legal_name, e.sector, e.licence_status, e.current_tier
       FROM applications a JOIN esps e ON e.id = a.esp_id
       ${status ? "WHERE a.status = ?" : ""}
       ORDER BY a.submitted_at DESC`
    )
    .all(...(status ? [status] : []));
  res.json({ applications: rows });
});

applicationsRouter.get("/:id", (req, res) => {
  const app = db.prepare("SELECT * FROM applications WHERE id = ?").get(req.params.id) as { esp_id: string } | undefined;
  if (!app) return res.status(404).json({ error: "Application not found" });

  applySuspensionCascade(app.esp_id);
  const esp = getEsp(app.esp_id);
  const documents = db.prepare("SELECT * FROM documents WHERE application_id = ?").all(req.params.id);
  const eligibilityRuns = db
    .prepare("SELECT * FROM eligibility_runs WHERE application_id = ? ORDER BY executed_at DESC")
    .all(req.params.id);
  const aiScreeningRuns = db
    .prepare("SELECT * FROM ai_screening_runs WHERE application_id = ? ORDER BY executed_at DESC")
    .all(req.params.id);
  const scoreRuns = db.prepare("SELECT * FROM score_runs WHERE application_id = ? ORDER BY executed_at DESC").all(req.params.id);
  const decisions = db.prepare("SELECT * FROM decisions WHERE application_id = ? ORDER BY decided_at DESC").all(req.params.id);
  const config = getPublishedConfig();

  res.json({
    application: app,
    esp,
    documents,
    eligibility_runs: eligibilityRuns.map((r: any) => ({ ...r, reasons: JSON.parse(r.reasons_json) })),
    ai_screening_runs: aiScreeningRuns.map((r: any) => ({ ...r, findings: JSON.parse(r.findings_json) })),
    score_runs: scoreRuns.map((r: any) => ({ ...r, breakdown: JSON.parse(r.criteria_breakdown_json) })),
    decisions,
    upgrade_eligibility: config ? upgradeEligibility(esp, config.lifecycleRules) : null,
  });
});

applicationsRouter.post("/:id/documents/:docId/expiry", requireRole("reviewer", "admin"), (req, res) => {
  const { expiry_date } = req.body ?? {};
  if (typeof expiry_date !== "string") return res.status(400).json({ error: "expiry_date (YYYY-MM-DD) is required" });

  const before = db.prepare("SELECT * FROM documents WHERE id = ? AND application_id = ?").get(req.params.docId, req.params.id);
  if (!before) return res.status(404).json({ error: "Document not found" });

  db.prepare("UPDATE documents SET expiry_date = ?, status = 'uploaded' WHERE id = ?").run(expiry_date, req.params.docId);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "document.expiry_set",
    entityType: "document",
    entityId: req.params.docId,
    before,
    after: { expiry_date },
  });

  res.json({ ok: true });
});

applicationsRouter.post("/:id/eligibility/run", requireRole("reviewer", "admin"), (req, res) => {
  const app = db.prepare("SELECT * FROM applications WHERE id = ?").get(req.params.id) as { esp_id: string } | undefined;
  if (!app) return res.status(404).json({ error: "Application not found" });

  applySuspensionCascade(app.esp_id);
  const esp = getEsp(app.esp_id);
  const licence = licenceIsUsable(esp);

  const reasons: string[] = [];
  if (!licence.ok) reasons.push(licence.reason!);

  const passed = reasons.length === 0;
  const id = nanoid();
  db.prepare(
    `INSERT INTO eligibility_runs (id, application_id, passed, reasons_json, executed_by) VALUES (?, ?, ?, ?, ?)`
  ).run(id, req.params.id, passed ? 1 : 0, JSON.stringify(reasons), req.user!.username);

  db.prepare("UPDATE applications SET status = ? WHERE id = ?").run(passed ? "under_review" : "eligibility_failed", req.params.id);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "eligibility.run",
    entityType: "application",
    entityId: req.params.id,
    after: { passed, reasons },
  });

  res.json({ id, passed, reasons });
});

applicationsRouter.post("/:id/ai-screening/run", requireRole("reviewer", "admin"), (req, res) => {
  const app = db.prepare("SELECT * FROM applications WHERE id = ?").get(req.params.id) as { esp_id: string } | undefined;
  if (!app) return res.status(404).json({ error: "Application not found" });
  const esp = getEsp(app.esp_id);
  const docs = db.prepare("SELECT doc_type, expiry_date, status FROM documents WHERE application_id = ?").all(req.params.id) as any[];

  const { passed, findings } = runDocumentScreening(esp.sector, docs);
  const id = nanoid();
  db.prepare(`INSERT INTO ai_screening_runs (id, application_id, passed, findings_json) VALUES (?, ?, ?, ?)`).run(
    id,
    req.params.id,
    passed ? 1 : 0,
    JSON.stringify(findings)
  );

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "ai_screening.run",
    entityType: "application",
    entityId: req.params.id,
    after: { passed, findings },
  });

  res.json({ id, passed, findings });
});

applicationsRouter.post("/:id/score/run", requireRole("reviewer", "admin"), (req, res) => {
  const app = db.prepare("SELECT * FROM applications WHERE id = ?").get(req.params.id) as { esp_id: string } | undefined;
  if (!app) return res.status(404).json({ error: "Application not found" });

  applySuspensionCascade(app.esp_id);
  const esp = getEsp(app.esp_id);
  const licence = licenceIsUsable(esp);
  if (!licence.ok) {
    return res.status(409).json({ error: `Cannot score: ${licence.reason}` });
  }

  const config = getPublishedConfig();
  if (!config) return res.status(500).json({ error: "No published ConfigVersion is available" });

  const data = getIntegratedData(app.esp_id);
  const result = runScoring(config.criteria, config.tierThresholds, esp.sector, data);

  const id = nanoid();
  db.prepare(
    `INSERT INTO score_runs (id, application_id, config_version_id, criteria_breakdown_json, raw_score, tier, integrated_data_snapshot_json, executed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.params.id, config.id, JSON.stringify(result.breakdown), result.raw_score, result.tier, JSON.stringify(data), req.user!.username);

  db.prepare("UPDATE applications SET status = 'scoring' WHERE id = ?").run(req.params.id);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "score.run",
    entityType: "application",
    entityId: req.params.id,
    after: { score_run_id: id, config_version: config.version_number, raw_score: result.raw_score, tier: result.tier },
  });

  res.json({ id, config_version: config.version_number, ...result });
});

applicationsRouter.post("/:id/score/:scoreRunId/override", requireRole("reviewer"), (req, res) => {
  const { tier, justification } = req.body ?? {};
  if (!["A", "B", "C", "D"].includes(tier)) return res.status(400).json({ error: "tier must be one of A, B, C, D" });
  if (typeof justification !== "string" || justification.trim().length < 10) {
    return res.status(400).json({ error: "A written justification (10+ characters) is required to override a score" });
  }

  const before = db.prepare("SELECT * FROM score_runs WHERE id = ? AND application_id = ?").get(req.params.scoreRunId, req.params.id);
  if (!before) return res.status(404).json({ error: "Score run not found" });

  db.prepare(
    `UPDATE score_runs SET overridden = 1, override_tier = ?, override_justification = ?, override_by = ?, override_at = datetime('now') WHERE id = ?`
  ).run(tier, justification, req.user!.username, req.params.scoreRunId);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "score.override",
    entityType: "score_run",
    entityId: req.params.scoreRunId,
    before,
    after: { override_tier: tier, justification },
  });

  res.json({ ok: true });
});

applicationsRouter.post("/:id/decision", requireRole("reviewer"), (req, res) => {
  const { decision, tier, note } = req.body ?? {};
  if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });

  const app = db.prepare("SELECT * FROM applications WHERE id = ?").get(req.params.id) as { esp_id: string } | undefined;
  if (!app) return res.status(404).json({ error: "Application not found" });

  const id = nanoid();
  db.prepare(
    `INSERT INTO decisions (id, application_id, decision, tier, note, decided_by) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, req.params.id, decision, tier ?? null, note ?? null, req.user!.username);

  db.prepare("UPDATE applications SET status = 'decided' WHERE id = ?").run(req.params.id);

  if (decision === "approved" && tier) {
    const config = getPublishedConfig();
    const validityMonths = config?.lifecycleRules.classification_validity_months ?? 12;
    const validUntil = new Date();
    validUntil.setMonth(validUntil.getMonth() + validityMonths);
    db.prepare(
      `UPDATE esps SET current_tier = ?, last_classification_at = datetime('now'), classification_valid_until = ? WHERE id = ?`
    ).run(tier, validUntil.toISOString().slice(0, 10), app.esp_id);
  }

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "application.decide",
    entityType: "application",
    entityId: req.params.id,
    after: { decision, tier, note },
  });

  res.json({ id, decision, tier });
});

// Simulates pushing the tier/status result back to TAMM via the existing API (Section 2.2, Stage 3).
applicationsRouter.post("/:id/push-to-tamm", requireRole("reviewer", "admin"), (req, res) => {
  const decision = db
    .prepare("SELECT * FROM decisions WHERE application_id = ? ORDER BY decided_at DESC LIMIT 1")
    .get(req.params.id) as { id: string; pushed_to_tamm: number } | undefined;
  if (!decision) return res.status(409).json({ error: "No decision recorded yet for this application" });

  db.prepare("UPDATE decisions SET pushed_to_tamm = 1, pushed_at = datetime('now') WHERE id = ?").run(decision.id);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "integration.tamm_push_result",
    entityType: "decision",
    entityId: decision.id,
    after: { pushed_to_tamm: true },
  });

  res.json({ ok: true, pushed_at: new Date().toISOString() });
});

applicationsRouter.post("/:id/upgrade-request", requireRole("reviewer"), (req, res) => {
  const app = db.prepare("SELECT * FROM applications WHERE id = ?").get(req.params.id) as { esp_id: string } | undefined;
  if (!app) return res.status(404).json({ error: "Application not found" });

  applySuspensionCascade(app.esp_id);
  const esp = getEsp(app.esp_id);
  const config = getPublishedConfig();
  if (!config) return res.status(500).json({ error: "No published ConfigVersion is available" });

  const elig = upgradeEligibility(esp, config.lifecycleRules);
  if (!elig.eligible) return res.status(409).json({ error: elig.reason });

  db.prepare("UPDATE esps SET last_upgrade_request_at = datetime('now') WHERE id = ?").run(app.esp_id);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "esp.upgrade_request",
    entityType: "esp",
    entityId: app.esp_id,
    after: { requested_at: new Date().toISOString() },
  });

  res.json({ ok: true });
});
