import "./db.js"; // ensures schema + seed run before the server accepts traffic
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { applicationsRouter } from "./routes/applications.js";
import { configRouter } from "./routes/config.js";
import { auditRouter } from "./routes/audit.js";
import { reportingRouter } from "./routes/reporting.js";
import { espsRouter } from "./routes/esps.js";
import { integrationRouter } from "./routes/integration.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "ead-esp-api" }));

app.use("/api/auth", authRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/config", configRouter);
app.use("/api/audit", auditRouter);
app.use("/api/reporting", reportingRouter);
app.use("/api/esps", espsRouter);
app.use("/api/integration", integrationRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`[ead-esp-api] listening on :${port}`);
});
