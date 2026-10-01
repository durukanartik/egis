import { Router } from "express";
import { nanoid } from "nanoid";
import { db, recordAudit } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { applySuspensionCascade, licenceIsUsable, upgradeEligibility, type EspRow, type LifecycleRules } from "../lib/lifecycle.js";
import { runDocumentScreening } from "../lib/aiScreening.js";
import {
  runClassification,
  evaluateHazardousModule,
  type Criterion,
  type CriterionEntry,
  type ClassificationParameters,
  type Gates,
  type HazardousModuleItem,
  type Tier,
} from "../lib/scoring.js";

export const applicationsRouter = Router();
applicationsRouter.use(requireAuth);

function getEsp(espId: string): EspRow {
  return db.prepare("SELECT * FROM esps WHERE id = ?").get(espId) as EspRow;
}

type AppRow = {
  id: string;
  esp_id: string;
  g1_critical_violation: "Y" | "N" | null;
  g2_suspension_12mo: "Y" | "N" | null;
  g3_holds_hazardous_permit: "Y" | "N" | null;
};

function getApplication(id: string): AppRow | undefined {
  return db.prepare("SELECT * FROM applications WHERE id = ?").get(id) as AppRow | undefined;
}

function getPublishedConfig() {
  const row = db.prepare("SELECT * FROM config_versions WHERE status = 'published' ORDER BY version_number DESC LIMIT 1").get() as
    | {
        id: string;
        version_number: number;
        criteria_json: string;
        hazardous_module_json: string;
        classification_parameters_json: string;
        lifecycle_rules_json: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    version_number: row.version_number,
    criteria: JSON.parse(row.criteria_json) as Criterion[],
    hazardousModule: JSON.parse(row.hazardous_module_json) as Record<string, HazardousModuleItem[]>,
    parameters: JSON.parse(row.classification_parameters_json) as ClassificationParameters,
    lifecycleRules: JSON.parse(row.lifecycle_rules_json) as LifecycleRules,
  };
}

function getCriterionEntries(applicationId: string): Map<string, CriterionEntry> {
  const rows = db.prepare("SELECT * FROM criterion_entries WHERE application_id = ?").all(applicationId) as Array<{
    criterion_id: string;
    applicable: "Y" | "N/A";
    value: number | null;
    evidence_verified: "Y" | "N" | null;
  }>;
  const map = new Map<string, CriterionEntry>();
  for (const r of rows) {
    map.set(r.criterion_id, { criterionId: r.criterion_id, applicable: r.applicable, value: r.value, evidenceVerified: r.evidence_verified });
  }
  return map;
}

function getGates(app: AppRow, esp: EspRow): Gates {
  const licence = licenceIsUsable(esp);
  return {
    g0: licence.ok ? "Y" : "N",
    g1: app.g1_critical_violation ?? "N",
    g2: app.g2_suspension_12mo ?? "N",
    g3: app.g3_holds_hazardous_permit ?? "N",
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
  const app = getApplication(req.params.id);
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

  const sectorCriteria = config ? config.criteria.filter((c) => c.sector === esp.sector) : [];
  const entries = getCriterionEntries(req.params.id);
  const criteriaWithEntries = sectorCriteria.map((c) => ({ ...c, entry: entries.get(c.id) ?? null }));

  const hazardousItems = config ? config.hazardousModule[esp.sector] ?? [] : [];
  const hazEntryRows = db.prepare("SELECT requirement_id, met FROM hazardous_module_entries WHERE application_id = ?").all(req.params.id) as Array<{
    requirement_id: string;
    met: "Y" | "N";
  }>;
  const hazMap = new Map(hazEntryRows.map((r) => [r.requirement_id, r.met]));
  const hazardousWithEntries = hazardousItems.map((h) => ({ ...h, met: hazMap.get(h.id) ?? null }));

  res.json({
    application: app,
    esp,
    documents,
    gates: getGates(app, esp),
    criteria: criteriaWithEntries,
    hazardous_module: hazardousWithEntries,
    eligibility_runs: eligibilityRuns.map((r: any) => ({ ...r, reasons: JSON.parse(r.reasons_json) })),
    ai_screening_runs: aiScreeningRuns.map((r: any) => ({ ...r, findings: JSON.parse(r.findings_json) })),
    score_runs: scoreRuns.map((r: any) => ({ ...r, result: JSON.parse(r.result_json) })),
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

// Gates G1-G3 (ESP INFORMATION & GATES block). G0 is derived from licence status, not stored.
applicationsRouter.put("/:id/gates", requireRole("reviewer", "admin"), (req, res) => {
  const app = getApplication(req.params.id);
  if (!app) return res.status(404).json({ error: "Application not found" });

  const { g1, g2, g3 } = req.body ?? {};
  for (const [key, val] of [["g1", g1], ["g2", g2], ["g3", g3]] as const) {
    if (val !== undefined && !["Y", "N"].includes(val)) {
      return res.status(400).json({ error: `${key} must be 'Y' or 'N'` });
    }
  }

  db.prepare(
    `UPDATE applications SET g1_critical_violation = COALESCE(?, g1_critical_violation), g2_suspension_12mo = COALESCE(?, g2_suspension_12mo), g3_holds_hazardous_permit = COALESCE(?, g3_holds_hazardous_permit) WHERE id = ?`
  ).run(g1 ?? null, g2 ?? null, g3 ?? null, req.params.id);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "application.gates_set",
    entityType: "application",
    entityId: req.params.id,
    after: { g1, g2, g3 },
  });

  res.json({ ok: true });
});

// Upserts one criterion's Applicable / Measured value / Evidence verified entry.
applicationsRouter.put("/:id/criteria/:criterionId", requireRole("reviewer", "admin"), (req, res) => {
  const app = getApplication(req.params.id);
  if (!app) return res.status(404).json({ error: "Application not found" });

  const { applicable, value, evidenceVerified } = req.body ?? {};
  if (!["Y", "N/A"].includes(applicable)) return res.status(400).json({ error: "applicable must be 'Y' or 'N/A'" });
  if (value !== null && typeof value !== "number") return res.status(400).json({ error: "value must be a number or null" });
  if (evidenceVerified !== null && !["Y", "N"].includes(evidenceVerified)) {
    return res.status(400).json({ error: "evidenceVerified must be 'Y', 'N' or null" });
  }

  const existing = db
    .prepare("SELECT id FROM criterion_entries WHERE application_id = ? AND criterion_id = ?")
    .get(req.params.id, req.params.criterionId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE criterion_entries SET applicable = ?, value = ?, evidence_verified = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`
    ).run(applicable, value, evidenceVerified, req.user!.username, existing.id);
  } else {
    db.prepare(
      `INSERT INTO criterion_entries (id, application_id, criterion_id, applicable, value, evidence_verified, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(nanoid(), req.params.id, req.params.criterionId, applicable, value, evidenceVerified, req.user!.username);
  }

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "criterion_entry.set",
    entityType: "application",
    entityId: req.params.id,
    after: { criterionId: req.params.criterionId, applicable, value, evidenceVerified },
  });

  res.json({ ok: true });
});

// Upserts one Hazardous Waste Module requirement's Met (Y/N) answer.
applicationsRouter.put("/:id/hazardous-module/:requirementId", requireRole("reviewer", "admin"), (req, res) => {
  const app = getApplication(req.params.id);
  if (!app) return res.status(404).json({ error: "Application not found" });
  if (app.g3_holds_hazardous_permit !== "Y") {
    return res.status(409).json({ error: "Hazardous Waste Module only applies when gate G3 is set to Y" });
  }

  const { met } = req.body ?? {};
  if (!["Y", "N"].includes(met)) return res.status(400).json({ error: "met must be 'Y' or 'N'" });

  const existing = db
    .prepare("SELECT id FROM hazardous_module_entries WHERE application_id = ? AND requirement_id = ?")
    .get(req.params.id, req.params.requirementId) as { id: string } | undefined;

  if (existing) {
    db.prepare(`UPDATE hazardous_module_entries SET met = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(
      met,
      req.user!.username,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO hazardous_module_entries (id, application_id, requirement_id, met, updated_by) VALUES (?, ?, ?, ?, ?)`
    ).run(nanoid(), req.params.id, req.params.requirementId, met, req.user!.username);
  }

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "hazardous_module_entry.set",
    entityType: "application",
    entityId: req.params.id,
    after: { requirementId: req.params.requirementId, met },
  });

  res.json({ ok: true });
});

applicationsRouter.post("/:id/eligibility/run", requireRole("reviewer", "admin"), (req, res) => {
  const app = getApplication(req.params.id);
  if (!app) return res.status(404).json({ error: "Application not found" });

  applySuspensionCascade(app.esp_id);
  const esp = getEsp(app.esp_id);
  const licence = licenceIsUsable(esp);

  const reasons: string[] = [];
  if (!licence.ok) reasons.push(`Gate G0 (valid EAD permit AND active account) not met: ${licence.reason}`);

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
  const app = getApplication(req.params.id);
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
  const app = getApplication(req.params.id);
  if (!app) return res.status(404).json({ error: "Application not found" });

  applySuspensionCascade(app.esp_id);
  const esp = getEsp(app.esp_id);

  const config = getPublishedConfig();
  if (!config) return res.status(500).json({ error: "No published ConfigVersion is available" });

  const sectorCriteria = config.criteria.filter((c) => c.sector === esp.sector);
  const entries = getCriterionEntries(req.params.id);
  const gates = getGates(app, esp);

  const hazardousItems = config.hazardousModule[esp.sector] ?? [];
  const hazEntryRows = db.prepare("SELECT requirement_id, met FROM hazardous_module_entries WHERE application_id = ?").all(req.params.id) as Array<{
    requirement_id: string;
    met: "Y" | "N";
  }>;
  const hazAnswers = new Map(hazEntryRows.map((r) => [r.requirement_id, r.met]));
  const hazardousModuleResult = evaluateHazardousModule(gates, hazardousItems, hazAnswers);

  const previousPublishedTier: Tier | "None" = (esp.previous_published_tier as Tier | null) ?? "None";

  const result = runClassification(sectorCriteria, entries, config.parameters, gates, previousPublishedTier, hazardousModuleResult);

  const id = nanoid();
  db.prepare(
    `INSERT INTO score_runs (id, application_id, config_version_id, result_json, total_score, final_classification, context_snapshot_json, executed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.params.id,
    config.id,
    JSON.stringify(result),
    result.total,
    result.finalClassification,
    JSON.stringify({ gates, previousPublishedTier, hazardousModuleResult }),
    req.user!.username
  );

  db.prepare("UPDATE applications SET status = 'scoring' WHERE id = ?").run(req.params.id);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "score.run",
    entityType: "application",
    entityId: req.params.id,
    after: { score_run_id: id, config_version: config.version_number, total: result.total, final_classification: result.finalClassification },
  });

  res.json({ id, config_version: config.version_number, ...result });
});

applicationsRouter.post("/:id/score/:scoreRunId/override", requireRole("reviewer"), (req, res) => {
  const { tier, justification } = req.body ?? {};
  if (!["Basic", "Advanced", "Premium"].includes(tier)) {
    return res.status(400).json({ error: "tier must be one of Basic, Advanced, Premium" });
  }
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
  if (decision === "approved" && tier && !["Basic", "Advanced", "Premium"].includes(tier)) {
    return res.status(400).json({ error: "tier must be one of Basic, Advanced, Premium" });
  }

  const app = getApplication(req.params.id);
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
      `UPDATE esps SET current_tier = ?, previous_published_tier = ?, last_classification_at = datetime('now'), classification_valid_until = ? WHERE id = ?`
    ).run(tier, tier, validUntil.toISOString().slice(0, 10), app.esp_id);
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
  const app = getApplication(req.params.id);
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
