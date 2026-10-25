// Prequalification (Section 9.1, Appendix 21.2): assessed per ESP per activity category, at entity
// pre-registration, before any Authorisation (WML / Environmental Permit) is issued. Reuses the
// Application entity at stage='prequalification' — see db.ts and routes/integration.ts for the
// inbound TAMM push that creates these rows. Independent of classification entirely: "the
// authorisation rule applies to classification only, not PQ" (Section 8.1).

import { Router } from "express";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, recordAudit } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const pqRouter = Router();
pqRouter.use(requireAuth);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type PqCriterion = { id: string; theme: string; requirement: string };
const classificationData: { pqCriteria: Record<string, PqCriterion[]> } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "classification.json"), "utf-8")
);

const RESULTS = ["Eligible", "Conditional", "Not eligible", "Manual review"] as const;

type PqApplicationRow = {
  id: string;
  esp_id: string;
  stage: string;
  status: string;
  tamm_reference: string;
  pq_activity_category: string | null;
  pq_reason: string | null;
  pq_overall_result: string | null;
  pq_conditional_open_items: string | null;
  pq_decision_note: string | null;
  pq_decided_by: string | null;
  pq_decided_at: string | null;
  submitted_at: string;
};

function getPqApplication(id: string): PqApplicationRow | undefined {
  const row = db.prepare("SELECT * FROM applications WHERE id = ? AND stage = 'prequalification'").get(id) as PqApplicationRow | undefined;
  return row;
}

function activeBlock(espId: string) {
  return db
    .prepare("SELECT * FROM blocks WHERE esp_id = ? AND lift_date IS NULL AND effective_date <= datetime('now') ORDER BY effective_date DESC LIMIT 1")
    .get(espId) as { id: string; reason: string; source: string; effective_date: string } | undefined;
}

pqRouter.get("/", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = db
    .prepare(
      `SELECT a.*, e.legal_name, e.sector, e.commercial_licence_number, e.licence_status
       FROM applications a JOIN esps e ON e.id = a.esp_id
       WHERE a.stage = 'prequalification' ${status ? "AND a.status = ?" : ""}
       ORDER BY a.submitted_at DESC`
    )
    .all(...(status ? [status] : []));
  res.json({ pq_assessments: rows });
});

pqRouter.get("/:id", (req, res) => {
  const app = getPqApplication(req.params.id);
  if (!app) return res.status(404).json({ error: "PQ assessment not found" });

  const esp = db.prepare("SELECT * FROM esps WHERE id = ?").get(app.esp_id) as { sector: string } | undefined;
  if (!esp) return res.status(404).json({ error: "ESP not found" });

  const criteria = classificationData.pqCriteria[esp.sector] ?? [];
  const entryRows = db.prepare("SELECT * FROM pq_criterion_entries WHERE application_id = ?").all(req.params.id) as Array<{
    criterion_id: string;
    outcome: string;
    note: string | null;
  }>;
  const entryMap = new Map(entryRows.map((r) => [r.criterion_id, r]));
  const criteriaWithEntries = criteria.map((c) => ({ ...c, entry: entryMap.get(c.id) ?? null }));

  res.json({
    pq_assessment: { ...app, pq_conditional_open_items: app.pq_conditional_open_items ? JSON.parse(app.pq_conditional_open_items) : [] },
    esp,
    criteria: criteriaWithEntries,
    active_block: activeBlock(app.esp_id) ?? null,
  });
});

pqRouter.put("/:id/criteria/:criterionId", requireRole("reviewer", "admin"), (req, res) => {
  const app = getPqApplication(req.params.id);
  if (!app) return res.status(404).json({ error: "PQ assessment not found" });
  if (app.status === "decided") return res.status(409).json({ error: "This PQ assessment has already been decided" });

  const { outcome, note } = req.body ?? {};
  if (!RESULTS.includes(outcome)) return res.status(400).json({ error: `outcome must be one of ${RESULTS.join(", ")}` });

  const existing = db
    .prepare("SELECT id FROM pq_criterion_entries WHERE application_id = ? AND criterion_id = ?")
    .get(req.params.id, req.params.criterionId) as { id: string } | undefined;

  if (existing) {
    db.prepare("UPDATE pq_criterion_entries SET outcome = ?, note = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
      outcome,
      note ?? null,
      req.user!.username,
      existing.id
    );
  } else {
    db.prepare(
      "INSERT INTO pq_criterion_entries (id, application_id, criterion_id, outcome, note, updated_by) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(nanoid(), req.params.id, req.params.criterionId, outcome, note ?? null, req.user!.username);
  }

  db.prepare("UPDATE applications SET status = 'under_review' WHERE id = ? AND status = 'submitted'").run(req.params.id);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "pq.criterion_entry_set",
    entityType: "application",
    entityId: req.params.id,
    after: { criterionId: req.params.criterionId, outcome, note },
  });

  res.json({ ok: true });
});

pqRouter.post("/:id/decide", requireRole("reviewer", "admin"), (req, res) => {
  const app = getPqApplication(req.params.id);
  if (!app) return res.status(404).json({ error: "PQ assessment not found" });
  if (app.status === "decided") return res.status(409).json({ error: "This PQ assessment has already been decided" });

  const { result, note, conditional_open_items } = req.body ?? {};
  if (!RESULTS.includes(result)) return res.status(400).json({ error: `result must be one of ${RESULTS.join(", ")}` });
  if (result === "Conditional" && (!Array.isArray(conditional_open_items) || conditional_open_items.length === 0)) {
    return res.status(400).json({ error: "A Conditional result requires a non-empty list of open items that must close before the Authorisation is issued" });
  }

  db.prepare(
    `UPDATE applications SET status = 'decided', pq_overall_result = ?, pq_conditional_open_items = ?, pq_decision_note = ?, pq_decided_by = ?, pq_decided_at = datetime('now') WHERE id = ?`
  ).run(result, result === "Conditional" ? JSON.stringify(conditional_open_items) : null, note ?? null, req.user!.username, req.params.id);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "pq.decide",
    entityType: "application",
    entityId: req.params.id,
    after: { result, note, conditional_open_items },
  });

  res.json({ ok: true, result });
});

// Issues the Authorisation (WML or Environmental Permit) once PQ is Eligible and no active block
// exists (Section 7.1: "an Authorisation can be issued only against an active PQ status and no
// active Block"). The WML/Environmental Permit is described as issued automatically via TAMM once
// these checks pass (Appendix 21.3 glossary); it is exposed here as a Licensing action so the MVP
// can demonstrate the step, rather than as an unauthenticated webhook.
pqRouter.post("/:id/issue-authorisation", requireRole("licensing", "admin"), (req, res) => {
  const app = getPqApplication(req.params.id);
  if (!app) return res.status(404).json({ error: "PQ assessment not found" });
  if (app.pq_overall_result !== "Eligible") {
    return res.status(409).json({ error: "An Authorisation can be issued only once PQ is decided Eligible" });
  }

  const block = activeBlock(app.esp_id);
  if (block) return res.status(409).json({ error: `An active block prevents issuance: ${block.reason}` });

  const esp = db.prepare("SELECT * FROM esps WHERE id = ?").get(app.esp_id) as { sector: string; legal_name: string } | undefined;
  if (!esp) return res.status(404).json({ error: "ESP not found" });

  const licenceNumber = `${esp.sector === "Treatment" ? "EP" : "WML"}-${Math.floor(10000 + Math.random() * 89999)}`;
  const issueDate = new Date();
  const expiryDate = new Date(issueDate);
  expiryDate.setMonth(expiryDate.getMonth() + 12);

  db.prepare(
    `UPDATE esps SET waste_licence_number = ?, licence_status = 'active', licence_issue_date = ?, licence_expiry_date = ? WHERE id = ?`
  ).run(licenceNumber, issueDate.toISOString().slice(0, 10), expiryDate.toISOString().slice(0, 10), app.esp_id);

  // Classification starts once the Authorisation is issued (Section 8.1) — open the classification
  // application so the Reviewer Portal can pick it up immediately.
  const classificationAppId = nanoid();
  const classificationRef = `TAMM-WML-2026-${Math.floor(100000 + Math.random() * 899999)}`;
  db.prepare(
    `INSERT INTO applications (id, esp_id, source, stage, status, declaration_accepted, tamm_reference, g1_critical_violation, g2_suspension_12mo, g3_holds_hazardous_permit)
     VALUES (?, ?, 'TAMM_TECHNICAL_MODIFICATION', 'classification', 'submitted', 1, ?, 'N', 'N', 'N')`
  ).run(classificationAppId, app.esp_id, classificationRef);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "licensing.authorisation_issued",
    entityType: "esp",
    entityId: app.esp_id,
    after: { licence_number: licenceNumber, issue_date: issueDate.toISOString().slice(0, 10), expiry_date: expiryDate.toISOString().slice(0, 10), classification_application_id: classificationAppId },
  });

  res.json({ ok: true, licence_number: licenceNumber, classification_application_id: classificationAppId });
});
