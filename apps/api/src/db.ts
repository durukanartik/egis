import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "ead_esp.db");
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reviewer','admin','auditor')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sector is one of the three ESP Classification & Rating Calculator matrices (R02, 30 Sept 2026):
-- Transportation, Trading, Treatment (the latter covers Treatment & Recycling together).
CREATE TABLE IF NOT EXISTS esps (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  commercial_licence_number TEXT NOT NULL,
  waste_licence_number TEXT NOT NULL,
  sector TEXT NOT NULL CHECK (sector IN ('Transportation','Trading','Treatment')),
  permitted_waste_types TEXT NOT NULL,
  licence_status TEXT NOT NULL CHECK (licence_status IN ('active','suspended','expired','revoked')),
  licence_issue_date TEXT NOT NULL,
  licence_expiry_date TEXT NOT NULL,
  last_classification_at TEXT,
  classification_valid_until TEXT,
  current_tier TEXT CHECK (current_tier IN ('Basic','Advanced','Premium')),
  previous_published_tier TEXT CHECK (previous_published_tier IN ('Basic','Advanced','Premium')),
  last_upgrade_request_at TEXT
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  esp_id TEXT NOT NULL REFERENCES esps(id),
  source TEXT NOT NULL DEFAULT 'TAMM_TECHNICAL_MODIFICATION',
  stage TEXT NOT NULL DEFAULT 'prequalification' CHECK (stage IN ('prequalification','licence_gating','classification')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','eligibility_failed','scoring','decided','voided')),
  declaration_accepted INTEGER NOT NULL DEFAULT 1,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  tamm_reference TEXT NOT NULL,
  -- Gates G1-G3 (Parameters sheet / ESP INFORMATION & GATES block). G0 is computed from licence_status.
  g1_critical_violation TEXT CHECK (g1_critical_violation IN ('Y','N')),
  g2_suspension_12mo TEXT CHECK (g2_suspension_12mo IN ('Y','N')),
  g3_holds_hazardous_permit TEXT CHECK (g3_holds_hazardous_permit IN ('Y','N'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','expired','missing'))
);

-- One row per (application, criterion): the reviewer's entered measured value and evidence
-- verification, mirroring the calculator's "Applicable / Measured value / Evidence verified" input
-- columns (I/J/K in each sector sheet).
CREATE TABLE IF NOT EXISTS criterion_entries (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  criterion_id TEXT NOT NULL,
  applicable TEXT NOT NULL DEFAULT 'Y' CHECK (applicable IN ('Y','N/A')),
  value REAL,
  evidence_verified TEXT CHECK (evidence_verified IN ('Y','N')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL,
  UNIQUE (application_id, criterion_id)
);

-- Hazardous Waste Module pass/fail answers (H-1..H-5), completed only when G3 = Y.
CREATE TABLE IF NOT EXISTS hazardous_module_entries (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  requirement_id TEXT NOT NULL,
  met TEXT NOT NULL CHECK (met IN ('Y','N')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL,
  UNIQUE (application_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS config_versions (
  id TEXT PRIMARY KEY,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','published','superseded','rejected')),
  criteria_json TEXT NOT NULL,
  hazardous_module_json TEXT NOT NULL,
  classification_parameters_json TEXT NOT NULL,
  lifecycle_rules_json TEXT NOT NULL,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_by TEXT,
  submitted_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  approval_note TEXT,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS eligibility_runs (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  passed INTEGER NOT NULL,
  reasons_json TEXT NOT NULL,
  executed_at TEXT NOT NULL DEFAULT (datetime('now')),
  executed_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_screening_runs (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  passed INTEGER NOT NULL,
  findings_json TEXT NOT NULL,
  executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS score_runs (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  config_version_id TEXT NOT NULL REFERENCES config_versions(id),
  result_json TEXT NOT NULL,
  total_score REAL NOT NULL,
  final_classification TEXT NOT NULL,
  context_snapshot_json TEXT NOT NULL,
  executed_at TEXT NOT NULL DEFAULT (datetime('now')),
  executed_by TEXT NOT NULL,
  overridden INTEGER NOT NULL DEFAULT 0,
  override_tier TEXT,
  override_justification TEXT,
  override_by TEXT,
  override_at TEXT
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  tier TEXT,
  note TEXT,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  pushed_to_tamm INTEGER NOT NULL DEFAULT 0,
  pushed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_username TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function recordAudit(entry: {
  actorId?: string | null;
  actorUsername: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  db.prepare(
    `INSERT INTO audit_log (id, actor_id, actor_username, actor_role, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nanoid(),
    entry.actorId ?? null,
    entry.actorUsername,
    entry.actorRole,
    entry.action,
    entry.entityType,
    entry.entityId ?? null,
    entry.before !== undefined ? JSON.stringify(entry.before) : null,
    entry.after !== undefined ? JSON.stringify(entry.after) : null
  );
}

type RawClassification = {
  sectors: Record<
    string,
    {
      criteria: Array<Record<string, unknown>>;
      hazardousModule: Array<{ id: string; requirement: string; verification: string; exampleMet: string | null }>;
      example: {
        espName: string;
        g0: string;
        g1: string;
        g2: string;
        g3: string;
        hazardousResult: string;
        currentPublishedTier: string;
        total: number;
        finalClassification: string;
      };
    }
  >;
  parameters: {
    advancedMinTotal: number;
    premiumMinTotal: number;
    retentionBufferPoints: number;
    gateCapG1: string;
    gateCapG2: string;
    gateCapG3: string;
    categoryMinimums: Record<string, { advanced: number; premium: number }>;
  };
};

const classificationDataPath = path.join(__dirname, "data", "classification.json");
export const classificationData: RawClassification = JSON.parse(fs.readFileSync(classificationDataPath, "utf-8"));

function stripExampleFields(criteria: Array<Record<string, unknown>>) {
  return criteria.map((c) => {
    const { exampleApplicable, exampleValue, exampleEvidenceVerified, exampleScore, ...rest } = c;
    return rest;
  });
}

function seed() {
  const userCount = (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
  if (userCount > 0) return;

  console.log("[seed] seeding demo data...");

  const hash = (pw: string) => bcrypt.hashSync(pw, 10);
  const insertUser = db.prepare(
    `INSERT INTO users (id, username, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)`
  );
  insertUser.run(nanoid(), "reviewer1", hash("Password123!"), "reviewer", "Fatima Al Mazrouei (Reviewer)");
  insertUser.run(nanoid(), "admin1", hash("Password123!"), "admin", "Omar Al Suwaidi (Config Editor)");
  insertUser.run(nanoid(), "admin2", hash("Password123!"), "admin", "Sara Al Nuaimi (Config Approver)");
  insertUser.run(nanoid(), "auditor1", hash("Password123!"), "auditor", "Khalid Al Zaabi (Auditor)");

  // ---- Published ConfigVersion v1, seeded from the EAD ESP Classification & Rating Calculator (R02) ----
  const allCriteria = Object.values(classificationData.sectors).flatMap((s) => stripExampleFields(s.criteria));
  const hazardousModule = Object.fromEntries(
    Object.entries(classificationData.sectors).map(([sector, s]) => [
      sector,
      s.hazardousModule.map(({ id, requirement, verification }) => ({ id, requirement, verification })),
    ])
  );
  const classificationParameters = classificationData.parameters;
  const lifecycleRules = {
    licence_status_gating: true,
    suspension_cascade: true,
    classification_validity_months: 12,
    upgrade_cycle_months: 6,
    review_window_days: 30,
    gps_scope: "equipped_active_status_only",
  };

  const cfgId = nanoid();
  db.prepare(
    `INSERT INTO config_versions (id, version_number, status, criteria_json, hazardous_module_json, classification_parameters_json, lifecycle_rules_json, notes, created_by, submitted_by, submitted_at, approved_by, approved_at, approval_note, published_at)
     VALUES (?, 1, 'published', ?, ?, ?, ?, ?, 'system-seed', 'system-seed', datetime('now'), 'system-seed', datetime('now'), 'Initial baseline ConfigVersion seeded from the EAD ESP Classification & Rating Calculator (R02, 30 Sept 2026).', datetime('now'))`
  ).run(
    cfgId,
    JSON.stringify(allCriteria),
    JSON.stringify(hazardousModule),
    JSON.stringify(classificationParameters),
    JSON.stringify(lifecycleRules),
    "Criteria, category minimums, tier thresholds, retention buffer and gate caps reproduced exactly from the EAD-issued ESP Classification & Rating Calculator (Output 3, R02)."
  );

  recordAudit({
    actorUsername: "system-seed",
    actorRole: "admin",
    action: "config_version.publish",
    entityType: "config_version",
    entityId: cfgId,
    after: { version_number: 1, status: "published" },
  });

  // ---- Seed ESPs + applications ----
  type EspSeed = {
    name: string;
    sector: "Transportation" | "Trading" | "Treatment";
    waste: string;
    licenceStatus: "active" | "suspended" | "expired" | "revoked";
    useExample: boolean; // pre-fill every criterion entry from the calculator's own illustrative example
    gates: { g1: "Y" | "N"; g2: "Y" | "N"; g3: "Y" | "N" };
    previousPublishedTier: "Basic" | "Advanced" | "Premium" | null;
  };

  const esps: EspSeed[] = [
    {
      name: "Al Dhafra Waste Transport LLC",
      sector: "Transportation",
      waste: "General, Construction & Demolition",
      licenceStatus: "active",
      useExample: true,
      gates: { g1: "N", g2: "N", g3: "N" },
      previousPublishedTier: null,
    },
    {
      name: "Emirates Circular Trading FZE",
      sector: "Trading",
      waste: "Scrap Metal, E-waste",
      licenceStatus: "active",
      useExample: true,
      gates: { g1: "N", g2: "N", g3: "N" },
      previousPublishedTier: null,
    },
    {
      name: "Khalifa Port Recycling Facility",
      sector: "Treatment",
      waste: "Plastics, Metals, Paper (hazardous-permitted)",
      licenceStatus: "active",
      useExample: true,
      gates: { g1: "N", g2: "N", g3: "Y" },
      previousPublishedTier: null,
    },
    {
      name: "Capital Clean Transport Services",
      sector: "Transportation",
      waste: "Hazardous, General",
      licenceStatus: "active",
      useExample: false,
      gates: { g1: "N", g2: "Y", g3: "N" }, // suspended in the last 12 months -> gate-capped at Advanced
      previousPublishedTier: "Advanced",
    },
    {
      name: "Bani Yas Fleet Logistics",
      sector: "Transportation",
      waste: "General",
      licenceStatus: "suspended",
      useExample: false,
      gates: { g1: "N", g2: "Y", g3: "N" },
      previousPublishedTier: null,
    },
    {
      name: "Yas Industrial Waste Treatment",
      sector: "Treatment",
      waste: "Industrial, Chemical",
      licenceStatus: "expired",
      useExample: false,
      gates: { g1: "N", g2: "N", g3: "N" },
      previousPublishedTier: null,
    },
  ];

  const insertEsp = db.prepare(
    `INSERT INTO esps (id, legal_name, commercial_licence_number, waste_licence_number, sector, permitted_waste_types, licence_status, licence_issue_date, licence_expiry_date, previous_published_tier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertApplication = db.prepare(
    `INSERT INTO applications (id, esp_id, source, stage, status, declaration_accepted, submitted_at, tamm_reference, g1_critical_violation, g2_suspension_12mo, g3_holds_hazardous_permit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertDoc = db.prepare(
    `INSERT INTO documents (id, application_id, doc_type, file_name, expiry_date, status) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertCriterionEntry = db.prepare(
    `INSERT INTO criterion_entries (id, application_id, criterion_id, applicable, value, evidence_verified, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 'system-seed')`
  );

  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);
  const addMonths = (d: Date, months: number) => {
    const r = new Date(d);
    r.setMonth(r.getMonth() + months);
    return r;
  };

  const requiredDocsBySector: Record<string, string[]> = {
    Transportation: ["Vehicle Registration Schedule", "Insurance Certificate", "Waste Carrier Permit"],
    Treatment: ["Facility Operating Permit", "Environmental Compliance Certificate", "Insurance Certificate"],
    Trading: ["Trade Licence Copy", "Insurance Certificate"],
  };

  esps.forEach((e, idx) => {
    const espId = nanoid();
    const issue = addMonths(now, -(10 + idx));
    const expiry = e.licenceStatus === "expired" ? addDays(now, -20) : addMonths(now, 14);
    insertEsp.run(
      espId,
      e.name,
      `CN-${1000 + idx}`,
      `WML-${2000 + idx}`,
      e.sector,
      e.waste,
      e.licenceStatus,
      iso(issue),
      iso(expiry),
      e.previousPublishedTier
    );

    const appId = nanoid();
    insertApplication.run(
      appId,
      espId,
      "TAMM_TECHNICAL_MODIFICATION",
      "classification",
      "submitted",
      1,
      addDays(now, -(3 + idx)).toISOString(),
      `TAMM-WML-2026-${100000 + idx}`,
      e.gates.g1,
      e.gates.g2,
      e.gates.g3
    );

    const docs = requiredDocsBySector[e.sector] ?? [];
    docs.forEach((docType, dIdx) => {
      if (idx === 3 && dIdx === docs.length - 1) return; // one ESP demonstrates a missing document
      const expiryDate = idx === 3 && dIdx === 0 ? iso(addDays(now, -5)) : iso(addMonths(now, 9));
      insertDoc.run(nanoid(), appId, docType, `${docType.replace(/\s+/g, "_")}.pdf`, expiryDate, "uploaded");
    });

    if (e.useExample) {
      const sectorCriteria = classificationData.sectors[e.sector].criteria;
      for (const c of sectorCriteria) {
        const applicable = c.exampleApplicable === "N/A" ? "N/A" : "Y";
        const value = typeof c.exampleValue === "number" ? c.exampleValue : null;
        insertCriterionEntry.run(nanoid(), appId, c.id, applicable, value, c.exampleEvidenceVerified ?? null);
      }
      if (e.gates.g3 === "Y") {
        const insertHaz = db.prepare(
          `INSERT INTO hazardous_module_entries (id, application_id, requirement_id, met, updated_by) VALUES (?, ?, ?, 'Y', 'system-seed')`
        );
        for (const h of classificationData.sectors[e.sector].hazardousModule) {
          insertHaz.run(nanoid(), appId, h.id);
        }
      }
    }
    // ESPs with useExample=false are seeded with gates/documents only — the reviewer fills in
    // criterion measured values and evidence through the Reviewer Portal, exactly as the real
    // calculator's "How to use" instructions describe.
  });

  console.log("[seed] done.");
}

seed();
