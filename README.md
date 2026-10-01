# EAD ESP Prequalification, Licensing & Classification Platform — MVP

A demonstrable, end-to-end MVP implementing the architecture described in *EAD/ESP Platform
Architecture v2.0* (NGtech, Sept 2026) — the Environment Agency – Abu Dhabi's platform for
prequalifying, licensing and classifying Environmental Service Providers (ESPs).

This is the MVP described in the architecture document's Section 18 ("MVP Scope vs Production
Roadmap"): a fully working end-to-end workflow on sample data, built on the same architectural
foundation the production system will use, so that production hardening is a matter of scale-out,
real integrations and governance rather than re-platforming.

## What this is (and isn't)

- **Is**: a working demonstrator of the full regulatory workflow — TAMM submission → eligibility
  gating → AI-assisted document screening → configurable scoring & classification → reviewer
  decision → push back to TAMM — backed by a real, auditable, configuration-governed scoring
  engine, running against realistic sample data.
- **Isn't**: connected to the real TAMM, AD Connect/Bolisaty or IWMS systems (Section 2.5, Out of
  Scope — those integrations and the DGE change-request process are owned by EAD IT). The
  Integration Gateway in this codebase exposes mock adapters seeded with sample data shaped
  exactly like the EAD Data & Integration Requirements catalogue (Section 7.2 / 21.5), including
  the fields EAD has marked "Not Available" — those scoring criteria exist in configuration but
  are held inactive, exactly as Section 7.2 specifies.
- **Isn't** a production deployment target. Section 15 specifies EAD's own on-premises data
  centre; this repo is architecturally container-based and infrastructure-agnostic (per Section 3)
  so it can be deployed there unchanged — see `docker-compose.yml`.

## Architecture mapping

| Doc section | What it specifies | Where it is in this repo |
|---|---|---|
| §5–6 Logical Architecture / Microservices Catalogue | 8 bounded-context services behind an API Gateway | `apps/api/src/routes/*` + `apps/api/src/lib/*` (modularised within one Node service for MVP; each module owns its own logic exactly as the catalogue describes, ready to be split into separate deployables) |
| §7 Data Architecture | PostgreSQL OLTP, logical data model, data classification | `apps/api/src/db.ts` (SQLite for the MVP demonstrator — schema mirrors the logical entities; swap for managed Postgres in production per §7) |
| §8 Configurable Rules, Scoring Engine, Lifecycle Rules | Pure scoring function, Draft→Simulate→Approve→Publish governance, 6-month upgrade cycle, 30-day review window, suspension cascade | `apps/api/src/lib/scoring.ts`, `apps/api/src/lib/lifecycle.ts`, `apps/api/src/routes/config.ts` |
| §9 Integration Architecture | Integration Gateway abstracting TAMM/AD Connect/IWMS | `apps/api/src/routes/integration.ts` (mock adapters + seeded snapshots) |
| §11 Frontend Architecture | EAD Reviewer Portal + Admin/Config Console, EAD-staff-only auth | `apps/web/src/pages/reviewer/*`, `apps/web/src/pages/admin/*` |
| §12 AI-Enabled Functionality | H1: rule-based document completeness screening | `apps/api/src/lib/aiScreening.ts` |
| §13 Security, Privacy and Compliance | RBAC, segregation of duties, audit trail | `apps/api/src/middleware/auth.ts`, enforced per-route; segregation of duties in `config.ts` approve handler |
| §13.2 RBAC Matrix | Reviewer / Admin / Auditor capabilities | Enforced via `requireRole()` across all routes |
| §14 Observability | Operational dashboards | `apps/api/src/routes/reporting.ts`, `apps/web/src/pages/shared/Dashboard.tsx` |
| §3 Audit by default | Immutable append-only audit trail | `apps/api/src/db.ts: recordAudit()`, called from every mutating route; `apps/web/src/pages/shared/AuditLog.tsx` |

## Running locally

Requires Node.js 22+.

```bash
# Backend (seeds sample data on first run — 8 ESPs across all 5 sectors)
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
| `reviewer1` | Reviewer | Review queue, eligibility, AI screening, scoring, decisions |
| `admin1` | Admin | Drafts configuration changes (criteria, weights, lifecycle rules) |
| `admin2` | Admin | Approves & publishes configuration — segregation of duties from `admin1` is enforced server-side |
| `auditor1` | Auditor | Read-only audit trail and dashboards |

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

1. **Sign in as `admin1`** → *TAMM Simulator* → pick an ESP → *Simulate TAMM submission*. This
   mimics TAMM's Technical Modification sub-service pushing a new application (§2.2, Stage 1;
   §21.2's sample contract) — there is no ESP-facing UI in this architecture (§2.5, C3), so this
   panel exists purely to drive the demo.
2. **Sign in as `reviewer1`** → *Review Queue* → open an ESP → run, in order: *Run eligibility
   check* (licence-status gating, §8.1) → *Run screening* (H1 AI document completeness, §12) →
   *Run scoring* (versioned scoring engine, §8) → record a *Decision* → *Push result to TAMM*.
   Try the suspended or expired-licence ESPs to see eligibility and scoring correctly refuse to run
   (licence-status gating and the suspension cascade in action).
3. **Sign in as `admin1`** → *Config Versions* → *New draft from published* → adjust a criterion's
   weight → *Simulate against sample applications* (dry-run diff against the live config, no writes)
   → *Submit for approval*.
4. **Sign in as `admin2`** → open the same draft → *Approve* (this fails if attempted as `admin1`,
   proving segregation of duties) → *Publish*. All subsequent scoring runs use the new
   ConfigVersion; historical ScoreRuns keep referencing the version they were computed under.
5. **Sign in as `auditor1`** (or any role) → *Audit Log* / *Dashboard* to see the full immutable
   trail of everything above.

## What's deliberately out of scope here (per §2.5 of the architecture doc)

- The ESP-facing UI (owned by EAD/Egis's own UI team, built to TAMM design standards).
- TAMM's, Bolisaty's or IWMS's internal systems — only their data contracts are modelled.
- Payment/AD Pay (explicitly excluded from the service, §2.5/C4).
- UAE Pass / individual identity (delegated entirely to TAMM).
- The formal DPIA and Abu Dhabi ISS/ADDA security assessment (owned by EAD IT).
- Production infrastructure, network and DR provisioning (owned by EAD IT; this MVP is built to be
  onboarded into EAD's existing DR/SLA framework per §15, not to replace it).
