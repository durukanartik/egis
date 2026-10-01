// RBAC Matrix (Section 13.2): Admin and Auditor can read the full audit log; Reviewer access is
// limited to their own actions.

import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const auditRouter = Router();
auditRouter.use(requireAuth);

auditRouter.get("/", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const entityType = typeof req.query.entity_type === "string" ? req.query.entity_type : undefined;
  const entityId = typeof req.query.entity_id === "string" ? req.query.entity_id : undefined;

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (req.user!.role === "reviewer") {
    clauses.push("actor_username = ?");
    params.push(req.user!.username);
  }
  if (entityType) {
    clauses.push("entity_type = ?");
    params.push(entityType);
  }
  if (entityId) {
    clauses.push("entity_id = ?");
    params.push(entityId);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit) as any[];

  res.json({
    entries: rows.map((r) => ({
      ...r,
      before: r.before_json ? JSON.parse(r.before_json) : null,
      after: r.after_json ? JSON.parse(r.after_json) : null,
    })),
  });
});
