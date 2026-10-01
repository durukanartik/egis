// Reporting & Analytics (Section 6 / 18): operational dashboards at MVP; warehouse-backed executive
// and regulatory reporting is a production-hardening item, not built here.

import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const reportingRouter = Router();
reportingRouter.use(requireAuth);

reportingRouter.get("/dashboard", (req, res) => {
  const byStatus = db.prepare("SELECT status, COUNT(*) as count FROM applications GROUP BY status").all();
  const byTier = db
    .prepare("SELECT current_tier as tier, COUNT(*) as count FROM esps WHERE current_tier IS NOT NULL GROUP BY current_tier")
    .all();
  const bySector = db.prepare("SELECT sector, COUNT(*) as count FROM esps GROUP BY sector").all();
  const licenceStatus = db.prepare("SELECT licence_status, COUNT(*) as count FROM esps GROUP BY licence_status").all();
  const totals = db.prepare("SELECT (SELECT COUNT(*) FROM esps) as total_esps, (SELECT COUNT(*) FROM applications) as total_applications").get();
  const scoreRunsCompleted = db.prepare("SELECT COUNT(*) as c FROM score_runs").get() as { c: number };
  const decisionsRecorded = db.prepare("SELECT COUNT(*) as c FROM decisions").get() as { c: number };
  const pendingConfigApprovals = db.prepare("SELECT COUNT(*) as c FROM config_versions WHERE status = 'pending_approval'").get();

  res.json({
    totals,
    by_status: byStatus,
    by_tier: byTier,
    by_sector: bySector,
    by_licence_status: licenceStatus,
    score_runs_completed: scoreRunsCompleted.c,
    decisions_recorded: decisionsRecorded.c,
    pending_config_approvals: pendingConfigApprovals,
  });
});
