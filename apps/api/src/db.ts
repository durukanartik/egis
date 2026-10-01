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

CREATE TABLE IF NOT EXISTS esps (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  commercial_licence_number TEXT NOT NULL,
  waste_licence_number TEXT NOT NULL,
  sector TEXT NOT NULL CHECK (sector IN ('Collection','Transportation','Trading','Treatment','Recycling')),
  permitted_waste_types TEXT NOT NULL,
  licence_status TEXT NOT NULL CHECK (licence_status IN ('active','suspended','expired','revoked')),
  licence_issue_date TEXT NOT NULL,
  licence_expiry_date TEXT NOT NULL,
  last_classification_at TEXT,
  classification_valid_until TEXT,
  current_tier TEXT,
  last_upgrade_request_at TEXT
);

CREATE TABLE IF NOT EXISTS integrated_data_snapshots (
  id TEXT PRIMARY KEY,
  esp_id TEXT NOT NULL REFERENCES esps(id),
  source TEXT NOT NULL CHECK (source IN ('bolisaty','iwms')),
  captured_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  esp_id TEXT NOT NULL REFERENCES esps(id),
  source TEXT NOT NULL DEFAULT 'TAMM_TECHNICAL_MODIFICATION',
  stage TEXT NOT NULL DEFAULT 'prequalification' CHECK (stage IN ('prequalification','licence_gating','classification')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','eligibility_failed','scoring','decided','voided')),
  declaration_accepted INTEGER NOT NULL DEFAULT 1,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  tamm_reference TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS config_versions (
  id TEXT PRIMARY KEY,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','published','superseded','rejected')),
  criteria_json TEXT NOT NULL,
  lifecycle_rules_json TEXT NOT NULL,
  tier_thresholds_json TEXT NOT NULL,
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
  criteria_breakdown_json TEXT NOT NULL,
  raw_score REAL NOT NULL,
  tier TEXT NOT NULL,
  integrated_data_snapshot_json TEXT NOT NULL,
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

  type EspSeed = {
    name: string;
    sector: "Collection" | "Transportation" | "Trading" | "Treatment" | "Recycling";
    waste: string;
    licenceStatus: "active" | "suspended" | "expired" | "revoked";
    bolisaty: Record<string, unknown>;
    iwms: Record<string, unknown>;
  };

  const esps: EspSeed[] = [
    {
      name: "Al Dhafra Waste Transport LLC",
      sector: "Transportation",
      waste: "General, Construction & Demolition",
      licenceStatus: "active",
      bolisaty: {
        vehicle_count: 42,
        compliant_vehicles: 40,
        vehicle_types: ["Compactor", "Flatbed"],
        avg_vehicle_age_years: 3.2,
        fuel_types: ["Diesel", "CNG"],
        euro_emission_standard: null,
        vehicle_inspection_history: null,
        gps_equipped_active: true,
        active_contracts: 18,
        complaints: null,
        customer_rating: null,
        illegal_dumping_cases: null,
      },
      iwms: {
        employee_count: 96,
        emiratisation_pct: null,
        icv_score: null,
      },
    },
    {
      name: "Capital Clean Transport Services",
      sector: "Transportation",
      waste: "Hazardous, General",
      licenceStatus: "active",
      bolisaty: {
        vehicle_count: 25,
        compliant_vehicles: 18,
        vehicle_types: ["Tanker", "Compactor"],
        avg_vehicle_age_years: 6.8,
        fuel_types: ["Diesel"],
        euro_emission_standard: null,
        vehicle_inspection_history: null,
        gps_equipped_active: true,
        active_contracts: 9,
        complaints: null,
        customer_rating: null,
        illegal_dumping_cases: null,
      },
      iwms: {
        employee_count: 54,
        emiratisation_pct: null,
        icv_score: null,
      },
    },
    {
      name: "Bani Yas Fleet Logistics",
      sector: "Transportation",
      waste: "General",
      licenceStatus: "suspended",
      bolisaty: {
        vehicle_count: 15,
        compliant_vehicles: 15,
        vehicle_types: ["Compactor"],
        avg_vehicle_age_years: 2.1,
        fuel_types: ["Diesel"],
        euro_emission_standard: null,
        vehicle_inspection_history: null,
        gps_equipped_active: false,
        active_contracts: 4,
        complaints: null,
        customer_rating: null,
        illegal_dumping_cases: null,
      },
      iwms: {
        employee_count: 31,
        emiratisation_pct: null,
        icv_score: null,
      },
    },
    {
      name: "Mussafah Recovery & Treatment Co.",
      sector: "Treatment",
      waste: "Industrial, Organic",
      licenceStatus: "active",
      bolisaty: {
        active_contracts: 11,
        complaints: null,
        customer_rating: null,
      },
      iwms: {
        facility_design_capacity: null,
        received_qty_tonnes_month: 3400,
        treated_qty_tonnes_month: 3250,
        recovered_output_qty_tonnes_month: null,
        weighbridge_data_available: true,
        employee_count: 140,
        emiratisation_pct: null,
        icv_score: null,
      },
    },
    {
      name: "Khalifa Port Recycling Facility",
      sector: "Recycling",
      waste: "Plastics, Metals, Paper",
      licenceStatus: "active",
      bolisaty: {
        active_contracts: 22,
        complaints: null,
        customer_rating: null,
      },
      iwms: {
        facility_design_capacity: null,
        received_qty_tonnes_month: 2100,
        treated_qty_tonnes_month: 2050,
        recovered_output_qty_tonnes_month: null,
        weighbridge_data_available: true,
        employee_count: 88,
        emiratisation_pct: null,
        icv_score: null,
      },
    },
    {
      name: "Emirates Circular Trading FZE",
      sector: "Trading",
      waste: "Scrap Metal, E-waste",
      licenceStatus: "active",
      bolisaty: {
        active_contracts: 30,
        complaints: null,
        customer_rating: null,
      },
      iwms: {
        employee_count: 22,
        emiratisation_pct: null,
        icv_score: null,
      },
    },
    {
      name: "Al Shahama Collection Services",
      sector: "Collection",
      waste: "Municipal Solid Waste",
      licenceStatus: "active",
      bolisaty: {
        vehicle_count: 60,
        compliant_vehicles: 57,
        vehicle_types: ["Compactor", "Skip Loader"],
        avg_vehicle_age_years: 4.5,
        fuel_types: ["Diesel", "CNG"],
        euro_emission_standard: null,
        vehicle_inspection_history: null,
        gps_equipped_active: true,
        active_contracts: 14,
        complaints: null,
        customer_rating: null,
        illegal_dumping_cases: null,
      },
      iwms: {
        employee_count: 180,
        emiratisation_pct: null,
        icv_score: null,
      },
    },
    {
      name: "Yas Industrial Waste Treatment",
      sector: "Treatment",
      waste: "Industrial, Chemical",
      licenceStatus: "expired",
      bolisaty: {
        active_contracts: 6,
        complaints: null,
        customer_rating: null,
      },
      iwms: {
        facility_design_capacity: null,
        received_qty_tonnes_month: 900,
        treated_qty_tonnes_month: 820,
        recovered_output_qty_tonnes_month: null,
        weighbridge_data_available: true,
        employee_count: 47,
        emiratisation_pct: null,
        icv_score: null,
      },
    },
  ];

  const insertEsp = db.prepare(
    `INSERT INTO esps (id, legal_name, commercial_licence_number, waste_licence_number, sector, permitted_waste_types, licence_status, licence_issue_date, licence_expiry_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSnapshot = db.prepare(
    `INSERT INTO integrated_data_snapshots (id, esp_id, source, captured_at, payload_json) VALUES (?, ?, ?, ?, ?)`
  );
  const insertApplication = db.prepare(
    `INSERT INTO applications (id, esp_id, source, stage, status, declaration_accepted, submitted_at, tamm_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertDoc = db.prepare(
    `INSERT INTO documents (id, application_id, doc_type, file_name, expiry_date, status) VALUES (?, ?, ?, ?, ?, ?)`
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
    Recycling: ["Facility Operating Permit", "Environmental Compliance Certificate", "Insurance Certificate"],
    Collection: ["Vehicle Registration Schedule", "Insurance Certificate", "Waste Carrier Permit"],
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
      iso(expiry)
    );
    insertSnapshot.run(nanoid(), espId, "bolisaty", now.toISOString(), JSON.stringify(e.bolisaty));
    insertSnapshot.run(nanoid(), espId, "iwms", now.toISOString(), JSON.stringify(e.iwms));

    const appId = nanoid();
    insertApplication.run(
      appId,
      espId,
      "TAMM_TECHNICAL_MODIFICATION",
      "classification",
      "submitted",
      1,
      addDays(now, -(3 + idx)).toISOString(),
      `TAMM-WML-2026-${100000 + idx}`
    );

    const docs = requiredDocsBySector[e.sector] ?? [];
    docs.forEach((docType, dIdx) => {
      // Leave one doc missing on the 2nd ESP, and expire one on the "Capital Clean" ESP, to make the demo realistic
      if (idx === 1 && dIdx === docs.length - 1) return; // missing doc
      const expiryDate = idx === 1 && dIdx === 0 ? iso(addDays(now, -5)) : iso(addMonths(now, 9));
      insertDoc.run(nanoid(), appId, docType, `${docType.replace(/\s+/g, "_")}.pdf`, expiryDate, "uploaded");
    });
  });

  // Initial published ConfigVersion (v1)
  const criteria = [
    {
      code: "TRN.FLEET_COMPLIANCE",
      sector: "Transportation",
      name: "Vehicle compliance ratio",
      data_source: "bolisaty.vehicles",
      formula: "compliant_vehicles / total_vehicles",
      weight: 0.35,
      active: true,
      thresholds: { T1: 0.95, T2: 0.85, T3: 0.7 },
    },
    {
      code: "TRN.FLEET_AGE",
      sector: "Transportation",
      name: "Fleet age performance (lower is better)",
      data_source: "bolisaty.vehicles",
      formula: "1 - (avg_vehicle_age_years / 15)",
      weight: 0.15,
      active: true,
      thresholds: { T1: 0.85, T2: 0.7, T3: 0.55 },
    },
    {
      code: "TRT.RECOVERY_RATE",
      sector: "Treatment,Recycling",
      name: "Waste diversion / recovery rate",
      data_source: "iwms.treatment_facility (pending EAD confirmation — currently Not Available)",
      formula: "recovered_output_qty / received_qty",
      weight: 0.4,
      active: false,
      thresholds: { T1: 0.8, T2: 0.6, T3: 0.35 },
    },
    {
      code: "TRT.THROUGHPUT_UTILISATION",
      sector: "Treatment,Recycling",
      name: "Treatment throughput ratio",
      data_source: "iwms.treatment_facility",
      formula: "treated_qty / received_qty",
      weight: 0.35,
      active: true,
      thresholds: { T1: 0.97, T2: 0.9, T3: 0.75 },
    },
    {
      code: "COMPLIANCE.VIOLATION_FREE",
      sector: "All",
      name: "Compliance / violation-free ratio",
      data_source: "ead_licensing.compliance (sample, no open violations assumed at MVP)",
      formula: "1 - (open_violations / 1)",
      weight: 0.3,
      active: true,
      thresholds: { T1: 1.0, T2: 0.9, T3: 0.75 },
    },
    {
      code: "MARKET.ACTIVE_CONTRACTS",
      sector: "All",
      name: "Active contract base (market activity)",
      data_source: "bolisaty.active_contracts",
      formula: "min(active_contracts / 20, 1)",
      weight: 0.2,
      active: true,
      thresholds: { T1: 0.8, T2: 0.5, T3: 0.25 },
    },
    {
      code: "WORKFORCE.EMIRATISATION",
      sector: "All",
      name: "Emiratisation rate",
      data_source: "iwms.workforce (pending EAD confirmation — currently Not Available)",
      formula: "emiratisation_pct",
      weight: 0.1,
      active: false,
      thresholds: { T1: 0.1, T2: 0.05, T3: 0.02 },
    },
    {
      code: "ECONOMIC.ICV_SCORE",
      sector: "All",
      name: "In-Country Value score",
      data_source: "to_be_identified (pending EAD confirmation — currently Not Available)",
      formula: "icv_score / 100",
      weight: 0.1,
      active: false,
      thresholds: { T1: 0.8, T2: 0.6, T3: 0.4 },
    },
  ];

  const lifecycleRules = {
    licence_status_gating: true,
    suspension_cascade: true,
    classification_validity_months: 12,
    upgrade_cycle_months: 6,
    review_window_days: 30,
    gps_scope: "equipped_active_status_only",
  };

  const tierThresholds = { A: 0.85, B: 0.7, C: 0.5 }; // below C => D

  const cfgId = nanoid();
  db.prepare(
    `INSERT INTO config_versions (id, version_number, status, criteria_json, lifecycle_rules_json, tier_thresholds_json, notes, created_by, submitted_by, submitted_at, approved_by, approved_at, approval_note, published_at)
     VALUES (?, 1, 'published', ?, ?, ?, ?, 'system-seed', 'system-seed', datetime('now'), 'system-seed', datetime('now'), 'Initial baseline ConfigVersion seeded at MVP stand-up.', datetime('now'))`
  ).run(
    cfgId,
    JSON.stringify(criteria),
    JSON.stringify(lifecycleRules),
    JSON.stringify(tierThresholds),
    "Baseline scoring configuration derived from the EAD Data & Integration Requirements catalogue (Section 7.2) and the confirmed lifecycle rules (Section 8.1)."
  );

  recordAudit({
    actorUsername: "system-seed",
    actorRole: "admin",
    action: "config_version.publish",
    entityType: "config_version",
    entityId: cfgId,
    after: { version_number: 1, status: "published" },
  });

  console.log("[seed] done.");
}

seed();
