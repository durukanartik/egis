import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { JWT_SECRET, requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "username and password are required" });
  }
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | { id: string; username: string; password_hash: string; role: string; display_name: string }
    | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const payload = { id: row.id, username: row.username, role: row.role, display_name: row.display_name };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, user: payload });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
