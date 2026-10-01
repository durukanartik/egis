// Integration Gateway (Section 9): all external dependencies are reached exclusively through this
// gateway. For the MVP demo, the ESP Classification Calculator's per-criterion data sources
// (Bolisaty, EAD Licensing, SRA, ESP uploads, site verification...) are reflected as reference text
// on each criterion (see classification.json) rather than a live pulled payload — per the
// calculator's own "How to use" instructions, the reviewer enters verified measured values
// directly. TAMM is simulated with seeded ESPs; the real adapters are out of scope for this
// deliverable (Section 2.5) but the contract shape mirrors Section 21.2's sample API.

import { Router } from "express";
import { nanoid } from "nanoid";
import { db, recordAudit } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const integrationRouter = Router();

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
