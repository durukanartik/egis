// Configuration Governance Flow (Section 8.3 of the System Architecture Document): Draft -> Simulate
// -> Submit for approval -> Approve (separate approver from editor) -> Publish new ConfigVersion.
// Historical ScoreRuns keep their original ConfigVersion for audit reproducibility; this router
// never mutates a published or superseded version. Criteria, category minimums, tier thresholds,
// the retention buffer and gate caps are reproduced from the EAD ESP Classification & Rating
// Calculator (R02, 30 Sept 2026) — see apps/api/src/data/classification.json.

import { Router } from "express";
import { nanoid } from "nanoid";
import { db, recordAudit } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
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
import { licenceIsUsable, type EspRow } from "../lib/lifecycle.js";

export const configRouter = Router();
configRouter.use(requireAuth);

function rowToConfig(row: any) {
  return {
    id: row.id,
    version_number: row.version_number,
    status: row.status,
    criteria: JSON.parse(row.criteria_json),
    hazardous_module: JSON.parse(row.hazardous_module_json),
    classification_parameters: JSON.parse(row.classification_parameters_json),
    lifecycle_rules: JSON.parse(row.lifecycle_rules_json),
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
  const { criteria, hazardous_module, classification_parameters, lifecycle_rules, notes } = req.body ?? {};
  if (!Array.isArray(criteria) || !hazardous_module || !classification_parameters || !lifecycle_rules) {
    return res.status(400).json({ error: "criteria[], hazardous_module, classification_parameters and lifecycle_rules are required" });
  }

  const maxVersion = (db.prepare("SELECT MAX(version_number) as m FROM config_versions").get() as { m: number | null }).m ?? 0;
  const id = nanoid();
  db.prepare(
    `INSERT INTO config_versions (id, version_number, status, criteria_json, hazardous_module_json, classification_parameters_json, lifecycle_rules_json, notes, created_by)
     VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    maxVersion + 1,
    JSON.stringify(criteria),
    JSON.stringify(hazardous_module),
    JSON.stringify(classification_parameters),
    JSON.stringify(lifecycle_rules),
    notes ?? null,
    req.user!.username
  );

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

  const { criteria, hazardous_module, classification_parameters, lifecycle_rules, notes } = req.body ?? {};
  db.prepare(
    `UPDATE config_versions SET criteria_json = COALESCE(?, criteria_json), hazardous_module_json = COALESCE(?, hazardous_module_json),
     classification_parameters_json = COALESCE(?, classification_parameters_json), lifecycle_rules_json = COALESCE(?, lifecycle_rules_json),
     notes = COALESCE(?, notes) WHERE id = ?`
  ).run(
    criteria ? JSON.stringify(criteria) : null,
    hazardous_module ? JSON.stringify(hazardous_module) : null,
    classification_parameters ? JSON.stringify(classification_parameters) : null,
    lifecycle_rules ? JSON.stringify(lifecycle_rules) : null,
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

function loadEntries(applicationId: string): Map<string, CriterionEntry> {
  const rows = db.prepare("SELECT * FROM criterion_entries WHERE application_id = ?").all(applicationId) as Array<{
    criterion_id: string;
    applicable: "Y" | "N/A";
    value: number | null;
    evidence_verified: "Y" | "N" | null;
  }>;
  const map = new Map<string, CriterionEntry>();
  for (const r of rows) map.set(r.criterion_id, { criterionId: r.criterion_id, applicable: r.applicable, value: r.value, evidenceVerified: r.evidence_verified });
  return map;
}

// Dry-run: scores every ESP with at least one submitted application against this draft/pending
// version and compares to the currently published version, without writing any ScoreRun.
configRouter.post("/versions/:id/simulate", requireRole("admin"), (req, res) => {
  const candidateRow = db.prepare("SELECT * FROM config_versions WHERE id = ?").get(req.params.id) as any;
  if (!candidateRow) return res.status(404).json({ error: "Not found" });

  const publishedRow = db.prepare("SELECT * FROM config_versions WHERE status = 'published' ORDER BY version_number DESC LIMIT 1").get() as any;

  const candidateCriteria: Criterion[] = JSON.parse(candidateRow.criteria_json);
  const candidateHaz: Record<string, HazardousModuleItem[]> = JSON.parse(candidateRow.hazardous_module_json);
  const candidateParams: ClassificationParameters = JSON.parse(candidateRow.classification_parameters_json);

  const publishedCriteria: Criterion[] | null = publishedRow ? JSON.parse(publishedRow.criteria_json) : null;
  const publishedHaz: Record<string, HazardousModuleItem[]> | null = publishedRow ? JSON.parse(publishedRow.hazardous_module_json) : null;
  const publishedParams: ClassificationParameters | null = publishedRow ? JSON.parse(publishedRow.classification_parameters_json) : null;

  const sampleApps = db
    .prepare(
      `SELECT a.id as application_id, e.* FROM applications a JOIN esps e ON e.id = a.esp_id
       GROUP BY e.id ORDER BY a.submitted_at DESC LIMIT 12`
    )
    .all() as Array<EspRow & { id: string; application_id: string; sector: string }>;

  const results = sampleApps.map((esp) => {
    const entries = loadEntries(esp.application_id);
    const gates: Gates = {
      g0: licenceIsUsable(esp).ok ? "Y" : "N",
      g1: "N",
      g2: "N",
      g3: "N",
    };
    const previousTier: Tier | "None" = (esp.previous_published_tier as Tier | null) ?? "None";

    const candidateSectorCriteria = candidateCriteria.filter((c) => c.sector === esp.sector);
    const candidateHazItems = candidateHaz[esp.sector] ?? [];
    const candidateHazResult = evaluateHazardousModule(gates, candidateHazItems, new Map());
    const candidateResult = runClassification(candidateSectorCriteria, entries, candidateParams, gates, previousTier, candidateHazResult);

    let publishedSummary: { total: number; tier: string } | null = null;
    if (publishedCriteria && publishedHaz && publishedParams) {
      const publishedSectorCriteria = publishedCriteria.filter((c) => c.sector === esp.sector);
      const publishedHazItems = publishedHaz[esp.sector] ?? [];
      const publishedHazResult = evaluateHazardousModule(gates, publishedHazItems, new Map());
      const publishedResult = runClassification(publishedSectorCriteria, entries, publishedParams, gates, previousTier, publishedHazResult);
      publishedSummary = { total: publishedResult.total, tier: publishedResult.finalClassification };
    }

    return {
      esp_id: esp.id,
      esp_name: esp.legal_name,
      sector: esp.sector,
      candidate: { total: candidateResult.total, tier: candidateResult.finalClassification },
      published: publishedSummary,
      tier_changed: publishedSummary ? publishedSummary.tier !== candidateResult.finalClassification : null,
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
