// Configuration Governance Flow (Section 8.3): Draft -> Simulate -> Submit for approval ->
// Approve (separate approver from editor) -> Publish new ConfigVersion. Historical ScoreRuns keep
// their original ConfigVersion for audit reproducibility; this router never mutates a published
// or superseded version.

import { Router } from "express";
import { nanoid } from "nanoid";
import { db, recordAudit } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { runScoring, type Criterion, type IntegratedData, type TierThresholds } from "../lib/scoring.js";

export const configRouter = Router();
configRouter.use(requireAuth);

function rowToConfig(row: any) {
  return {
    id: row.id,
    version_number: row.version_number,
    status: row.status,
    criteria: JSON.parse(row.criteria_json),
    lifecycle_rules: JSON.parse(row.lifecycle_rules_json),
    tier_thresholds: JSON.parse(row.tier_thresholds_json),
    notes: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    submitted_by: row.submitted_by,
    submitted_at: row.submitted_at,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    approval_note: row.approval_note,
    published_at: row.published_at,
  };
}

configRouter.get("/versions", (req, res) => {
  const rows = db.prepare("SELECT * FROM config_versions ORDER BY version_number DESC").all();
  res.json({ versions: rows.map(rowToConfig) });
});

configRouter.get("/active", (req, res) => {
  const row = db.prepare("SELECT * FROM config_versions WHERE status = 'published' ORDER BY version_number DESC LIMIT 1").get();
  if (!row) return res.status(404).json({ error: "No published ConfigVersion" });
  res.json({ version: rowToConfig(row) });
});

configRouter.get("/versions/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM config_versions WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ version: rowToConfig(row) });
});

configRouter.post("/versions", requireRole("admin"), (req, res) => {
  const { criteria, lifecycle_rules, tier_thresholds, notes } = req.body ?? {};
  if (!Array.isArray(criteria) || !lifecycle_rules || !tier_thresholds) {
    return res.status(400).json({ error: "criteria[], lifecycle_rules and tier_thresholds are required" });
  }

  const maxVersion = (db.prepare("SELECT MAX(version_number) as m FROM config_versions").get() as { m: number | null }).m ?? 0;
  const id = nanoid();
  db.prepare(
    `INSERT INTO config_versions (id, version_number, status, criteria_json, lifecycle_rules_json, tier_thresholds_json, notes, created_by)
     VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`
  ).run(id, maxVersion + 1, JSON.stringify(criteria), JSON.stringify(lifecycle_rules), JSON.stringify(tier_thresholds), notes ?? null, req.user!.username);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "config_version.draft_created",
    entityType: "config_version",
    entityId: id,
    after: { version_number: maxVersion + 1 },
  });

  res.status(201).json({ id, version_number: maxVersion + 1 });
});

configRouter.put("/versions/:id", requireRole("admin"), (req, res) => {
  const before = db.prepare("SELECT * FROM config_versions WHERE id = ?").get(req.params.id) as { status: string } | undefined;
  if (!before) return res.status(404).json({ error: "Not found" });
  if (before.status !== "draft") return res.status(409).json({ error: "Only draft ConfigVersions can be edited" });

  const { criteria, lifecycle_rules, tier_thresholds, notes } = req.body ?? {};
  db.prepare(
    `UPDATE config_versions SET criteria_json = COALESCE(?, criteria_json), lifecycle_rules_json = COALESCE(?, lifecycle_rules_json),
     tier_thresholds_json = COALESCE(?, tier_thresholds_json), notes = COALESCE(?, notes) WHERE id = ?`
  ).run(
    criteria ? JSON.stringify(criteria) : null,
    lifecycle_rules ? JSON.stringify(lifecycle_rules) : null,
    tier_thresholds ? JSON.stringify(tier_thresholds) : null,
    notes ?? null,
    req.params.id
  );

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "config_version.draft_edited",
    entityType: "config_version",
    entityId: req.params.id,
    before,
  });

  res.json({ ok: true });
});

// Dry-run: scores a sample of real applications' ESPs against this draft/pending version and compares
// to the currently published version, without writing any ScoreRun or mutating application state.
configRouter.post("/versions/:id/simulate", requireRole("admin"), (req, res) => {
  const candidate = db.prepare("SELECT * FROM config_versions WHERE id = ?").get(req.params.id) as any;
  if (!candidate) return res.status(404).json({ error: "Not found" });

  const published = db.prepare("SELECT * FROM config_versions WHERE status = 'published' ORDER BY version_number DESC LIMIT 1").get() as any;

  const sampleEsps = db.prepare("SELECT * FROM esps LIMIT 8").all() as any[];
  const candidateCriteria: Criterion[] = JSON.parse(candidate.criteria_json);
  const candidateThresholds: TierThresholds = JSON.parse(candidate.tier_thresholds_json);
  const publishedCriteria: Criterion[] | null = published ? JSON.parse(published.criteria_json) : null;
  const publishedThresholds: TierThresholds | null = published ? JSON.parse(published.tier_thresholds_json) : null;

  const results = sampleEsps.map((esp) => {
    const bolisaty = db
      .prepare("SELECT payload_json FROM integrated_data_snapshots WHERE esp_id = ? AND source = 'bolisaty' ORDER BY captured_at DESC LIMIT 1")
      .get(esp.id) as { payload_json: string } | undefined;
    const iwms = db
      .prepare("SELECT payload_json FROM integrated_data_snapshots WHERE esp_id = ? AND source = 'iwms' ORDER BY captured_at DESC LIMIT 1")
      .get(esp.id) as { payload_json: string } | undefined;
    const data: IntegratedData = {
      bolisaty: bolisaty ? JSON.parse(bolisaty.payload_json) : {},
      iwms: iwms ? JSON.parse(iwms.payload_json) : {},
      compliance: { open_violations: 0 },
    };

    const candidateResult = runScoring(candidateCriteria, candidateThresholds, esp.sector, data);
    const publishedResult =
      publishedCriteria && publishedThresholds ? runScoring(publishedCriteria, publishedThresholds, esp.sector, data) : null;

    return {
      esp_id: esp.id,
      esp_name: esp.legal_name,
      sector: esp.sector,
      candidate: { raw_score: candidateResult.raw_score, tier: candidateResult.tier },
      published: publishedResult ? { raw_score: publishedResult.raw_score, tier: publishedResult.tier } : null,
      tier_changed: publishedResult ? publishedResult.tier !== candidateResult.tier : null,
    };
  });

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "config_version.simulated",
    entityType: "config_version",
    entityId: req.params.id,
    after: { sample_size: results.length, changed_count: results.filter((r) => r.tier_changed).length },
  });

  res.json({ results });
});

configRouter.post("/versions/:id/submit-for-approval", requireRole("admin"), (req, res) => {
  const before = db.prepare("SELECT * FROM config_versions WHERE id = ?").get(req.params.id) as { status: string } | undefined;
  if (!before) return res.status(404).json({ error: "Not found" });
  if (before.status !== "draft") return res.status(409).json({ error: "Only draft ConfigVersions can be submitted for approval" });

  db.prepare("UPDATE config_versions SET status = 'pending_approval', submitted_by = ?, submitted_at = datetime('now') WHERE id = ?").run(
    req.user!.username,
    req.params.id
  );

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "config_version.submitted_for_approval",
    entityType: "config_version",
    entityId: req.params.id,
  });

  res.json({ ok: true });
});

// Segregation of duties (Section 13.1 / RBAC Matrix 13.2): the approver must be a different
// admin user than whoever created/edited the draft.
configRouter.post("/versions/:id/approve", requireRole("admin"), (req, res) => {
  const before = db.prepare("SELECT * FROM config_versions WHERE id = ?").get(req.params.id) as
    | { status: string; created_by: string }
    | undefined;
  if (!before) return res.status(404).json({ error: "Not found" });
  if (before.status !== "pending_approval") return res.status(409).json({ error: "ConfigVersion is not pending approval" });
  if (before.created_by === req.user!.username) {
    return res.status(403).json({ error: "Segregation of duties: the editor cannot also approve this ConfigVersion" });
  }

  const { note } = req.body ?? {};
  db.prepare(
    "UPDATE config_versions SET status = 'approved', approved_by = ?, approved_at = datetime('now'), approval_note = ? WHERE id = ?"
  ).run(req.user!.username, note ?? null, req.params.id);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "config_version.approved",
    entityType: "config_version",
    entityId: req.params.id,
    after: { approved_by: req.user!.username, note },
  });

  res.json({ ok: true });
});

configRouter.post("/versions/:id/publish", requireRole("admin"), (req, res) => {
  const before = db.prepare("SELECT * FROM config_versions WHERE id = ?").get(req.params.id) as { status: string } | undefined;
  if (!before) return res.status(404).json({ error: "Not found" });
  if (before.status !== "approved") return res.status(409).json({ error: "ConfigVersion must be approved before publishing" });

  const tx = db.transaction(() => {
    db.prepare("UPDATE config_versions SET status = 'superseded' WHERE status = 'published'").run();
    db.prepare("UPDATE config_versions SET status = 'published', published_at = datetime('now') WHERE id = ?").run(req.params.id);
  });
  tx();

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "config_version.publish",
    entityType: "config_version",
    entityId: req.params.id,
  });

  res.json({ ok: true });
});

configRouter.post("/versions/:id/reject", requireRole("admin"), (req, res) => {
  const before = db.prepare("SELECT * FROM config_versions WHERE id = ?").get(req.params.id) as { status: string } | undefined;
  if (!before) return res.status(404).json({ error: "Not found" });
  if (before.status !== "pending_approval") return res.status(409).json({ error: "ConfigVersion is not pending approval" });

  const { note } = req.body ?? {};
  db.prepare("UPDATE config_versions SET status = 'rejected', approved_by = ?, approved_at = datetime('now'), approval_note = ? WHERE id = ?").run(
    req.user!.username,
    note ?? null,
    req.params.id
  );

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "config_version.rejected",
    entityType: "config_version",
    entityId: req.params.id,
    after: { note },
  });

  res.json({ ok: true });
});
