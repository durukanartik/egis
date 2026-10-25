# EAD ESP Prequalification, Licensing & Classification Platform — MVP

A demonstrable, end-to-end MVP implementing the architecture described in *EAD/ESP Platform
Architecture* (NGtech), currently tracking **System Architecture Document v7.1 (14 Oct 2026)** —
the Environment Agency – Abu Dhabi's platform for prequalifying, licensing and classifying
Environmental Service Providers (ESPs).

This is the MVP described in the architecture document's Section 18 ("MVP Scope vs Production
Roadmap"): a fully working end-to-end workflow on sample data, built on the same architectural
foundation the production system will use, so that production hardening is a matter of scale-out,
real integrations and governance rather than re-platforming.

## Changelog

- **v7.1** — Reworked for the revised SAD: prequalification now runs before licensing (Section
  9.1), a fourth tier (**Below Basic**) and a **decoupled classification status** (Not classified /
  Active / Under review / Suspended / Revoked — Section 8.1/8.2), annual reassessment replacing the
  6-month cycle, a configurable **Dept Head approval** policy for Premium/Below Basic/tier-change
  decisions (Section 8.2), a **consequence ladder** and **blocks** (calibration mode by default —
  Section 8.1), and a **Public Register** (Section 11.2). New roles: `dept_head`, `licensing`. See
  "The classification model" and "Demo walkthrough" below for the current workflow.
- **v2.0 (initial MVP)** — Three-tier classification (Basic/Advanced/Premium), single-reviewer
  decision model, Reviewer Portal + Admin/Config Console.

## What this is (and isn't)

- **Is**: a working demonstrator of the full regulatory workflow — TAMM submission → gates →
  eligibility gating → AI-assisted document screening → per-criterion data entry → configurable
  scoring & classification → reviewer decision → push back to TAMM — backed by a real, auditable,
  configuration-governed scoring engine, running against realistic sample data.
- **The scoring engine is not a placeholder.** It is a line-for-line reimplementation of the
  EAD-issued *ESP Classification & Rating System – Scoring Calculator* (Output 3, R02, 30 Sept
  2026, delivered as an Excel workbook) — the same category weights, KPI thresholds, category
  minimums, tier cutoffs, retention buffer and gates as the spreadsheet, not an approximation of
  it. `apps/api/src/data/classification.json` is parsed directly from that workbook, and
  `apps/api/src/lib/scoring.ts` is verified to reproduce the workbook's own illustrative example
  figures exactly for all three sectors (see "Verified against the source spreadsheet" below).
- **Isn't**: connected to the real TAMM, AD Connect/Bolisaty or IWMS systems (Section 2.5, Out of
  Scope — those integrations and the DGE change-request process are owned by EAD IT). Per the
  calculator's own "How to use" instructions, criterion measured values are entered and
  evidence-verified by the reviewer directly, not auto-pulled from a mock integration feed.
- **Isn't** a production deployment target. The architecture is container-based and
  infrastructure-agnostic so it can be deployed onto whatever platform EAD IT provisions
  on-premises — see `docker-compose.yml`.

## The classification model

Three sector-specific matrices — **Transportation**, **Trading**, **Treatment** (the latter covers
Treatment & Recycling together) — each scored on a 100-point scale across four weighted
categories: Regulatory & Organisational Capability, Technical Capability, Environmental & HSE
Performance, and Digital Capability. Highlights:

- **68 criteria total** (24 Transportation, 22 Trading, 22 Treatment), each with a KPI definition,
  unit, scoring rule, higher-/lower-is-better direction, and up to three threshold bands — some
  listed as "Phase 2" (not yet scored, pending a confirmed EAD data source).
- **Differentiated, non-compensating category minimums**: core categories (Technical,
  Environmental & HSE) require ≥50% for Advanced and ≥75% for Premium; supporting categories
  (Regulatory, Digital) require ≥30% / ≥50%. A high total score cannot buy its way past a weak
  category.
- **N/A re-scaling**: a criterion marked not applicable to a given ESP has its points redistributed
  proportionally among the rest of its category, rather than lost.
- **Four tiers**: Below Basic / Basic (≥40 pts) / Advanced (≥60 pts + category minimums) / Premium
  (≥85 pts + category minimums), with a configurable retention buffer (default 3 points) so a
  previously published tier isn't lost to a marginal one-cycle dip.
- **Status is decoupled from tier** (Section 8.1/8.2): Not classified / Active / Under review /
  Suspended / Revoked. A Suspended ESP still carries its underlying computed tier — suspension caps
  the tier, it doesn't void the classification.
- **Gates**: G0 (valid Authorisation + active account — eligibility; unmet ⇒ Not classified), G1
  (critical violation/fatality → capped at Basic), G2 (suspension in the last 12 months → capped at
  Advanced, and shows Suspended status while the suspension lasts), G3 (holds a hazardous waste
  permit → must pass the 5-point Hazardous Waste Module or be capped at Basic).
- **Dept Head approval** (Section 8.2, Assumption A7): a reviewer's decision takes effect
  immediately by default; Premium, Below Basic and any change from the ESP's previously published
  tier are held for Dept Head sign-off before the esp is updated — configurable per ConfigVersion.
- **Prequalification runs first** (Section 9.1): assessed per ESP per activity category at entity
  pre-registration, against its own PQ-1..PQ-10 criteria, before any Authorisation (WML or
  Environmental Permit) is issued. Classification starts once the Authorisation is issued.
- All of the above — criteria, category minimums, tier thresholds, retention buffer, gate caps,
  approval policy, monitoring frequency, process periods and the consequence ladder — are versioned
  ConfigVersion data, editable through the same Draft → Simulate → Approve → Publish governance
  workflow as the rest of the platform.

## Architecture mapping

| Doc section | What it specifies | Where it is in this repo |
|---|---|---|
| §5–6 Logical Architecture / Microservices Catalogue | 8 bounded-context services behind an API Gateway | `apps/api/src/routes/*` + `apps/api/src/lib/*` (modularised within one Node service for MVP; each module owns its own logic exactly as the catalogue describes, ready to be split into separate deployables) |
| §7 Data Architecture | PostgreSQL OLTP, logical data model, data classification | `apps/api/src/db.ts` (SQLite for the MVP demonstrator — schema mirrors the logical entities; swap for managed Postgres in production per §7) |
| §8 Configurable Rules, Scoring Engine, Lifecycle Rules | Four-tier scoring function with decoupled status, Dept Head approval policy, Draft→Simulate→Approve→Publish governance, annual reassessment cycle, 30-day review window, suspension cascade | `apps/api/src/lib/scoring.ts` (reimplements the EAD ESP Classification & Rating Calculator R02, extended for v7.1's four-tier/status model), `apps/api/src/lib/lifecycle.ts`, `apps/api/src/routes/applications.ts` (Dept Head gate), `apps/api/src/routes/config.ts`, `apps/api/src/data/classification.json` |
| §9.1 Prequalification & Licensing Integration | PQ assessed per activity category before any Authorisation; blocks gate issuance | `apps/api/src/routes/pq.ts`, `apps/api/src/routes/esps.ts` (blocks); PQ reuses the Application entity at `stage='prequalification'` rather than a parallel table |
| §9 Integration Architecture | Integration Gateway abstracting TAMM/AD Connect/IWMS | `apps/api/src/routes/integration.ts` (TAMM push simulator, Appendix 21.2 contract shape; criterion data sources are reference text per the calculator's own reviewer-entry workflow) |
| §11 Frontend Architecture | EAD Reviewer Portal + Admin/Config Console + PQ/Dept Head/Licensing consoles, EAD-staff-only auth | `apps/web/src/pages/reviewer/*`, `apps/web/src/pages/admin/*`, `apps/web/src/pages/pq/*`, `apps/web/src/pages/depthead/*`, `apps/web/src/pages/licensing/*` |
| §11.2 Public Register | Anonymous per-ESP register — name, licence number, activity category, tier, validity and status, no scores | `apps/api/src/routes/public.ts` (no auth), `apps/web/src/pages/public/Register.tsx` |
| §12 AI-Enabled Functionality | H1: rule-based document completeness screening | `apps/api/src/lib/aiScreening.ts` |
| §13 Security, Privacy and Compliance | RBAC, segregation of duties, audit trail | `apps/api/src/middleware/auth.ts`, enforced per-route; segregation of duties in `config.ts` approve handler |
| §13.2 RBAC Matrix | Reviewer / Dept Head / Licensing / Admin / Auditor capabilities | Enforced via `requireRole()` across all routes |
| §14 Observability | Operational dashboards | `apps/api/src/routes/reporting.ts`, `apps/web/src/pages/shared/Dashboard.tsx` |
| §3 Audit by default | Immutable append-only audit trail | `apps/api/src/db.ts: recordAudit()`, called from every mutating route; `apps/web/src/pages/shared/AuditLog.tsx` |

## Running locally

Requires Node.js 22+.

```bash
# Backend (seeds sample data on first run — 8 ESPs across all 3 sectors, incl. 2 at the PQ stage)
cd apps/api
npm install
npm run dev        # http://localhost:4000

# Frontend (separate terminal)
cd apps/web
npm install
npm run dev         # http://localhost:5173, proxies /api to :4000
```

Open `http://localhost:5173` and sign in with one of the seeded demo accounts shown on the login
screen (password `Password123!` for all):

| Username | Role | Purpose |
|---|---|---|
| `reviewer1` | Reviewer | PQ queue, review queue, eligibility, AI screening, scoring, decisions |
| `depthead1` | Dept Head | Approves/rejects decisions the approval policy holds back (Premium, Below Basic, tier change) |
| `licensing1` | Licensing | Issues Authorisations once PQ is Eligible; raises/lifts blocks |
| `admin1` | Admin | Drafts configuration changes (criteria, weights, lifecycle rules, approval policy) |
| `admin2` | Admin | Approves & publishes configuration — segregation of duties from `admin1` is enforced server-side |
| `auditor1` | Auditor | Read-only audit trail and dashboards |

All authenticated roles can also view the **Public Register** (`/register`, Section 11.2) — the
only page in the app that needs no sign-in.

To reset to fresh seed data, stop the API and delete `apps/api/data/`.

## Running with Docker

```bash
docker compose up --build
```

- Frontend: `http://localhost:8080`
- API: `http://localhost:4000`

`docker-compose.yml` is one way to run the container images this MVP produces; it is not a
statement about production topology. Section 15 requires deployment onto whatever
Kubernetes/VMware/bare-VM platform EAD IT provisions on-premises — these are the same container
images, unmodified.

## Demo walkthrough

The three "golden" ESPs (Al Dhafra Waste Transport, Emirates Circular Trading, Khalifa Port
Recycling Facility) are pre-seeded with the calculator's own illustrative example data — opening
any of them and running scoring reproduces the workbook's own numbers exactly, so they're the
fastest way to show the engine is correct. Capital Clean, Bani Yas and Yas Industrial are seeded
with gates and documents only, so you can demonstrate the reviewer filling in criterion data from
scratch. Two further ESPs (Barakah Logistics & Trading, Mussafah Transport Solutions) are seeded at
the **prequalification** stage — no Authorisation issued yet — to demonstrate the new PQ → Licensing
journey end to end.

**Classification (unchanged from v2.0's golden-path demo):**

1. **Sign in as `admin1`** → *TAMM Simulator* → pick an ESP → *Simulate TAMM submission*. This
   mimics TAMM's Technical Modification sub-service pushing a new application — there is no
   ESP-facing UI in this architecture, so this panel exists purely to drive the demo.
2. **Sign in as `reviewer1`** → *Review Queue* → open **Al Dhafra Waste Transport LLC**
   (Transportation) → run, in order: *Run eligibility check* (Gate G0) → *Run screening* (H1 AI
   document completeness) → *Run scoring*. You should see **total 64/100, ADVANCED** — identical to
   the spreadsheet's own example. Expand a category to see the full criterion-level breakdown, the
   category minimums met/not-met, the score-based tier, the retention-buffer tier, and the gate
   cap. Then record a *Decision* and *Push result to TAMM*.
3. Open **Khalifa Port Recycling Facility** (Treatment, gate G3 = Y) to see the **Hazardous Waste
   Module** section and a **Premium** result (86/100). Open **Capital Clean Transport Services** to
   see a gate-capped scenario (G2 = Y, suspended in the last 12 months caps it at Advanced) with no
   criterion data yet entered — fill in a few criteria yourself to see scores update.

**Prequalification → Licensing (new in v7.1):**

4. Still as `reviewer1` → *PQ Queue* → open **Barakah Logistics & Trading Co.** (already decided
   Eligible) to see the PQ-1..PQ-10 criteria and decision. Open **Mussafah Transport Solutions LLC**
   (still Under review) → set its remaining criteria to *Eligible* → *Record PQ decision* (Eligible).
5. **Sign in as `licensing1`** → *Licensing Console* → both ESPs now show under "Ready to issue" →
   *Issue Authorisation* for one of them. This activates its WML, and opens a classification
   application for it — back in `reviewer1`'s Review Queue. Try *Manage blocks*: raise a block on an
   ESP, confirm issuance is refused while it's active, then lift it.

**Dept Head approval (new in v7.1):**

6. As `reviewer1`, on any classification application, record a *Decision* with tier **Premium** or
   **Below Basic** (or any tier different from the ESP's previously published one). The application
   moves to *awaiting Dept Head* instead of taking effect immediately, and *Push result to TAMM* is
   blocked. **Sign in as `depthead1`** → *Approval Queue* → open it → *Approve* (or *Reject*, which
   sends it back to the reviewer). Only on approval does the esp's tier actually update.

**Configuration governance (unchanged, now with more parameters):**

7. **Sign in as `admin1`** → *Config Versions* → open **v1** to see the full 68-criterion catalogue
   across all three sector tabs, the category minimums, tier thresholds, retention buffer, gate
   caps, approval policy, monitoring frequency, process periods and the consequence ladder — all
   exactly as published by EAD. *New draft from published* → adjust a threshold → *Simulate against
   sample ESPs* (dry-run diff against the live config, no writes) → *Submit for approval*.
8. **Sign in as `admin2`** → open the same draft → *Approve* (this fails if attempted as `admin1`,
   proving segregation of duties) → *Publish*. All subsequent scoring runs use the new
   ConfigVersion; historical ScoreRuns keep referencing the version they were computed under.
9. **Sign in as `auditor1`** (or any role) → *Audit Log* / *Dashboard* to see the full immutable
   trail of everything above. Visit `/register` (no sign-in needed) for the Public Register.

## Verified against the source spreadsheet

`apps/api/src/lib/scoring.ts` was checked against the calculator workbook's own illustrative
example row for all three sectors before being wired into the app — same category weights, same
category scores, same total, same final tier, same reason text, same hazardous-module result:

| Sector | Total | Final classification |
|---|---|---|
| Transportation | 64 / 100 | Advanced |
| Trading | 79 / 100 | Advanced |
| Treatment | 86 / 100 | Premium (hazardous module: PASS) |

These are exactly the figures the seeded "golden" ESPs reproduce live in the app.

## What's deliberately out of scope here (per §2.5 of the architecture doc)

- The ESP-facing UI (owned by EAD/Egis's own UI team, built to TAMM design standards).
- TAMM's, Bolisaty's or IWMS's internal systems — only their data contracts are modelled.
- Payment/AD Pay (explicitly excluded from the service, §2.5/C4).
- UAE Pass / individual identity (delegated entirely to TAMM).
- The formal DPIA and Abu Dhabi ISS/ADDA security assessment (owned by EAD IT).
- Production infrastructure, network and DR provisioning (owned by EAD IT; this MVP is built to be
  onboarded into EAD's existing DR/SLA framework per §15, not to replace it).
