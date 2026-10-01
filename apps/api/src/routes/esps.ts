import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { applySuspensionCascade } from "../lib/lifecycle.js";

export const espsRouter = Router();
espsRouter.use(requireAuth);

espsRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM esps ORDER BY legal_name").all() as { id: string }[];
  rows.forEach((r) => applySuspensionCascade(r.id));
  const refreshed = db.prepare("SELECT * FROM esps ORDER BY legal_name").all();
  res.json({ esps: refreshed });
});

espsRouter.get("/:id", (req, res) => {
  applySuspensionCascade(req.params.id);
  const esp = db.prepare("SELECT * FROM esps WHERE id = ?").get(req.params.id);
  if (!esp) return res.status(404).json({ error: "Not found" });
  res.json({ esp });
});
