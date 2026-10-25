// Public Register (Section 11.2): "Anonymous, per ESP: name, licence number, activity category,
// tier, validity and status (Active / Under review / Suspended / Revoked) — no category or
// criterion scores." Deliberately mounted without requireAuth. Only ESPs holding an issued
// Authorisation (a WML or Environmental Permit) are listed — an entity still at PQ pre-registration
// has nothing public to show yet.

import { Router } from "express";
import { db } from "../db.js";

export const publicRouter = Router();

publicRouter.get("/register", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT legal_name, sector, waste_licence_number, current_tier, classification_valid_until, classification_status
       FROM esps WHERE waste_licence_number IS NOT NULL ORDER BY legal_name`
    )
    .all();
  res.json({
    register: rows.map((r: any) => ({
      legal_name: r.legal_name,
      activity_category: r.sector,
      licence_number: r.waste_licence_number,
      tier: r.current_tier,
      valid_until: r.classification_valid_until,
      status: r.classification_status,
    })),
  });
});
