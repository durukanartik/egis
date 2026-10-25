import { Router } from "express";
import { nanoid } from "nanoid";
import { db, recordAudit } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
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

// Licensing blocks (Section 7.1/8.1): raised by a block rule (configuration) or manually by EAD
// Licensing; an Authorisation cannot be issued while a block is active.
espsRouter.get("/:id/blocks", (req, res) => {
  const blocks = db.prepare("SELECT * FROM blocks WHERE esp_id = ? ORDER BY effective_date DESC").all(req.params.id);
  res.json({ blocks });
});

espsRouter.post("/:id/blocks", requireRole("licensing", "admin"), (req, res) => {
  const esp = db.prepare("SELECT id FROM esps WHERE id = ?").get(req.params.id) as { id: string } | undefined;
  if (!esp) return res.status(404).json({ error: "ESP not found" });

  const { reason } = req.body ?? {};
  if (typeof reason !== "string" || reason.trim().length < 5) {
    return res.status(400).json({ error: "A reason (5+ characters) is required to raise a block" });
  }

  const id = nanoid();
  db.prepare(`INSERT INTO blocks (id, esp_id, reason, source, created_by) VALUES (?, ?, ?, 'manual', ?)`).run(id, req.params.id, reason, req.user!.username);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "block.raised",
    entityType: "esp",
    entityId: req.params.id,
    after: { block_id: id, reason, source: "manual" },
  });

  res.json({ ok: true, id });
});

espsRouter.post("/:id/blocks/:blockId/lift", requireRole("licensing", "admin"), (req, res) => {
  const block = db.prepare("SELECT * FROM blocks WHERE id = ? AND esp_id = ?").get(req.params.blockId, req.params.id) as { id: string; lift_date: string | null } | undefined;
  if (!block) return res.status(404).json({ error: "Block not found" });
  if (block.lift_date) return res.status(409).json({ error: "Block is already lifted" });

  db.prepare("UPDATE blocks SET lift_date = datetime('now'), lifted_by = ? WHERE id = ?").run(req.user!.username, req.params.blockId);

  recordAudit({
    actorId: req.user!.id,
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: "block.lifted",
    entityType: "esp",
    entityId: req.params.id,
    after: { block_id: req.params.blockId },
  });

  res.json({ ok: true });
});
