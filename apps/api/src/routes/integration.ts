// Integration Gateway (Section 9): all external dependencies are reached exclusively through this
// gateway. For the MVP demo, the ESP Classification Calculator's per-criterion data sources
// (Bolisaty, EAD Licensing, SRA, ESP uploads, site verification...) are reflected as reference text
// on each criterion (see classification.json) rather than a live pulled payload — per the
// calculator's own "How to use" instructions, the reviewer enters verified measured values
// directly. TAMM is simulated with seeded ESPs; the real adapters are out of scope for this
// deliverable (Section 2.5) but the contract shape mirrors Section 21.2's sample API.

import { Router } from "express";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, recordAudit } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const integrationRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const classificationData: { pqCriteria: Record<string, Array<{ id: string }>> } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "classification.json"), "utf-8")
);

// Simulates TAMM's Technical Modification sub-service pushing a new prequalification application
// into the platform (Section 2.2, Stage 1; Appendix 21.2 sample contract — POST
// /v1/applications/{id}/submitAuthorization). In production this is an inbound webhook from TAMM's
// existing push API, not an admin-triggered action — it is exposed here, gated to admins, purely so
// the MVP can be demonstrated end-to-end without a live TAMM connection.
integrationRouter.post("/tamm/applications", requireAuth, requireRole("admin"), (req, res) => {
  const { esp_id, activity_category, reason } = req.body ?? {};
  const esp = db.prepare("SELECT * FROM esps WHERE id = ?").get(esp_id) as { id: string; sector: string } | undefined;
  if (!esp) return res.status(404).json({ error: "Unknown ESP" });
  if (typeof activity_category !== "string" || !activity_category) {
    return res.status(400).json({ error: "activity_category is required" });
  }
  if (!["NEW_ENTITY", "FIRST_RENEWAL", "ADD_ACTIVITY_CATEGORY"].includes(reason)) {
    return res.status(400).json({ error: "reason must be one of NEW_ENTITY, FIRST_RENEWAL, ADD_ACTIVITY_CATEGORY" });
  }

  const id = nanoid();
  const tammRef = `TAMM-PQ-2026-${Math.floor(100000 + Math.random() * 899999)}`;
  db.prepare(
    `INSERT INTO applications (id, esp_id, source, stage, status, declaration_accepted, tamm_reference, pq_activity_category, pq_reason)
     VALUES (?, ?, 'TAMM_TECHNICAL_MODIFICATION', 'prequalification', 'submitted', 1, ?, ?, ?)`
  ).run(id, esp_id, tammRef, activity_category, reason);

  const insertEntry = db.prepare(
    `INSERT INTO pq_criterion_entries (id, application_id, criterion_id, outcome, updated_by) VALUES (?, ?, ?, 'Manual review', 'system-tamm')`
  );
  for (const c of classificationData.pqCriteria[esp.sector] ?? []) {
    insertEntry.run(nanoid(), id, c.id);
  }

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "integration.tamm_push_simulated",
    entityType: "application",
    entityId: id,
    after: { esp_id, tamm_reference: tammRef, activity_category, reason },
  });

  res.status(202).json({ application_id: id, pq_assessment_id: id, status: "submitted", tamm_reference: tammRef });
});
