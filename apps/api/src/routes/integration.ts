// Integration Gateway (Section 9): all external dependencies are reached exclusively through this
// gateway. For the MVP demo, TAMM/AD Connect(Bolisaty)/IWMS are simulated with seeded mock payloads —
// the real adapters are out of scope for this deliverable (Section 2.5) but the contract shape mirrors
// Section 21.2's sample API.

import { Router } from "express";
import { nanoid } from "nanoid";
import { db, recordAudit } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const integrationRouter = Router();

integrationRouter.get("/bolisaty/:espId", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT payload_json, captured_at FROM integrated_data_snapshots WHERE esp_id = ? AND source = 'bolisaty' ORDER BY captured_at DESC LIMIT 1")
    .get(req.params.espId) as { payload_json: string; captured_at: string } | undefined;
  if (!row) return res.status(404).json({ error: "No Bolisaty snapshot for this ESP" });
  res.json({ source: "bolisaty", captured_at: row.captured_at, data: JSON.parse(row.payload_json) });
});

integrationRouter.get("/iwms/:espId", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT payload_json, captured_at FROM integrated_data_snapshots WHERE esp_id = ? AND source = 'iwms' ORDER BY captured_at DESC LIMIT 1")
    .get(req.params.espId) as { payload_json: string; captured_at: string } | undefined;
  if (!row) return res.status(404).json({ error: "No IWMS snapshot for this ESP" });
  res.json({ source: "iwms", captured_at: row.captured_at, data: JSON.parse(row.payload_json) });
});

// Simulates TAMM's Technical Modification sub-service pushing a new prequalification application
// into the platform (Section 2.2, Stage 1; Section 21.2 sample contract). In production this is an
// inbound webhook from TAMM's existing push API, not an admin-triggered action — it is exposed here,
// gated to admins, purely so the MVP can be demonstrated end-to-end without a live TAMM connection.
integrationRouter.post("/tamm/applications", requireAuth, requireRole("admin"), (req, res) => {
  const { esp_id } = req.body ?? {};
  const esp = db.prepare("SELECT * FROM esps WHERE id = ?").get(esp_id) as { id: string } | undefined;
  if (!esp) return res.status(404).json({ error: "Unknown ESP" });

  const id = nanoid();
  const tammRef = `TAMM-WML-2026-${Math.floor(100000 + Math.random() * 899999)}`;
  db.prepare(
    `INSERT INTO applications (id, esp_id, source, stage, status, declaration_accepted, tamm_reference)
     VALUES (?, ?, 'TAMM_TECHNICAL_MODIFICATION', 'prequalification', 'submitted', 1, ?)`
  ).run(id, esp_id, tammRef);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "integration.tamm_push_simulated",
    entityType: "application",
    entityId: id,
    after: { esp_id, tamm_reference: tammRef },
  });

  res.status(202).json({ application_id: id, status: "submitted", tamm_reference: tammRef });
});
