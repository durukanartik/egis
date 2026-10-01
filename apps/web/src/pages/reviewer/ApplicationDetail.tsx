import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { StatusBadge, TierBadge } from "../../components/Badges";

type Criterion = {
  id: string;
  category: string;
  name: string;
  status: "Active" | "Phase 2";
  maxPts: number;
  kpiDefinition: string;
  unit: string;
  scoringRule: string;
  direction: "H" | "L";
  dataSource: string;
  entry: { applicable: "Y" | "N/A"; value: number | null; evidenceVerified: "Y" | "N" | null } | null;
};

type HazItem = { id: string; requirement: string; verification: string; met: "Y" | "N" | null };

type Detail = {
  application: {
    id: string;
    esp_id: string;
    status: string;
    stage: string;
    submitted_at: string;
    tamm_reference: string;
  };
  esp: {
    id: string;
    legal_name: string;
    sector: string;
    commercial_licence_number: string;
    waste_licence_number: string;
    permitted_waste_types: string;
    licence_status: string;
    licence_expiry_date: string;
    current_tier: string | null;
    previous_published_tier: string | null;
    classification_valid_until: string | null;
  };
  gates: { g0: "Y" | "N"; g1: "Y" | "N"; g2: "Y" | "N"; g3: "Y" | "N" };
  documents: { id: string; doc_type: string; file_name: string; expiry_date: string | null; status: string }[];
  criteria: Criterion[];
  hazardous_module: HazItem[];
  eligibility_runs: { id: string; passed: number; reasons: string[]; executed_at: string; executed_by: string }[];
  ai_screening_runs: { id: string; passed: number; findings: { severity: string; doc_type: string; issue: string }[]; executed_at: string }[];
  score_runs: {
    id: string;
    total_score: number;
    final_classification: string;
    executed_at: string;
    executed_by: string;
    overridden: number;
    override_tier: string | null;
    override_justification: string | null;
    result: {
      total: number;
      finalClassification: string;
      scoreBasedTier: string;
      tierWithRetention: string;
      gateCapTier: string;
      reason: string;
      retained: boolean;
      hazardousModuleResult: string;
      advancedMinimumsAllMet: boolean;
      premiumMinimumsAllMet: boolean;
      categories: {
        category: string;
        categoryWeight: number;
        categoryScore: number;
        categoryPct: number | null;
        advancedMinimumMet: boolean;
        premiumMinimumMet: boolean;
        rows: { id: string; name: string; maxPts: number; applicable: string | null; value: number | null; evidenceVerified: string | null; score: number }[];
      }[];
    };
  }[];
  decisions: { id: string; decision: string; tier: string | null; note: string | null; decided_by: string; decided_at: string; pushed_to_tamm: number }[];
  upgrade_eligibility: { eligible: boolean; reason?: string; nextEligibleDate?: string } | null;
};

const CATEGORY_ORDER = [
  "Regulatory & Organisational Capability",
  "Technical Capability",
  "Environmental & HSE Performance",
  "Digital Capability",
];

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api<Detail>(`/applications/${id}`).then(setDetail);
  }, [id]);

  useEffect(() => load(), [load]);

  async function runAction(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  if (!detail) return <div className="text-slate-400">Loading…</div>;

  const { application, esp, gates, documents, criteria, hazardous_module, eligibility_runs, ai_screening_runs, score_runs, decisions, upgrade_eligibility } =
    detail;
  const latestScore = score_runs[0];
  const latestDecision = decisions[0];

  const byCategory = CATEGORY_ORDER.map((cat) => ({ category: cat, items: criteria.filter((c) => c.category === cat) }));

  return (
    <div className="space-y-6">
      <div>
        <Link to="/reviewer/queue" className="text-sm text-brand-blue-600 hover:underline">
          ← Back to queue
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 p-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{esp.legal_name}</h1>
          <p className="text-sm text-slate-500">
            {esp.sector} · CN {esp.commercial_licence_number} · WML {esp.waste_licence_number} · TAMM {application.tamm_reference}
          </p>
          <p className="text-xs text-slate-400 mt-1">Permitted waste types: {esp.permitted_waste_types}</p>
        </div>
        <div className="flex gap-2 items-center">
          <StatusBadge status={esp.licence_status} />
          <StatusBadge status={application.status} />
          <TierBadge tier={esp.current_tier} />
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded px-4 py-2">{error}</div>}

      {/* Gates */}
      <Section title="Gates" subtitle="ESP INFORMATION & GATES block. G0 is derived automatically from the Waste Management Licence status.">
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <GateRow label="G0 — Valid EAD permit AND active account" value={gates.g0} readOnly derivedNote="derived from licence status" />
          <GateEditRow
            label="G1 — Critical violation or fatality in last 12 months"
            value={gates.g1}
            onSave={(v) => runAction("g1", () => api(`/applications/${application.id}/gates`, { method: "PUT", body: JSON.stringify({ g1: v }) }))}
          />
          <GateEditRow
            label="G2 — Permit/account suspension in last 12 months"
            value={gates.g2}
            onSave={(v) => runAction("g2", () => api(`/applications/${application.id}/gates`, { method: "PUT", body: JSON.stringify({ g2: v }) }))}
          />
          <GateEditRow
            label="G3 — Holds a hazardous waste permit"
            value={gates.g3}
            onSave={(v) => runAction("g3", () => api(`/applications/${application.id}/gates`, { method: "PUT", body: JSON.stringify({ g3: v }) }))}
          />
        </div>
      </Section>

      {/* Documents */}
      <Section title="Documents" subtitle="Manual expiry-date entry at MVP.">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase">
            <tr>
              <th className="text-left py-1">Document</th>
              <th className="text-left py-1">File</th>
              <th className="text-left py-1">Expiry date</th>
              <th className="text-left py-1"></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <DocRow key={d.id} doc={d} appId={application.id} onSaved={load} />
            ))}
            {documents.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-slate-400">
                  No documents captured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      {/* Eligibility */}
      <Section
        title="Eligibility Validation"
        subtitle="Gate G0: valid EAD permit and active account on assessment date."
        action={
          <ActionButton busy={busy === "eligibility"} onClick={() => runAction("eligibility", () => api(`/applications/${application.id}/eligibility/run`, { method: "POST" }))}>
            Run eligibility check
          </ActionButton>
        }
      >
        {eligibility_runs.length === 0 && <Empty text="No eligibility run yet." />}
        {eligibility_runs.map((r) => (
          <div key={r.id} className="text-sm border-b border-slate-100 py-2 last:border-0">
            <span className={r.passed ? "text-emerald-700 font-medium" : "text-rose-700 font-medium"}>
              {r.passed ? "Passed" : "Failed"}
            </span>
            {r.reasons.length > 0 && <ul className="list-disc ml-5 text-rose-600">{r.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
            <span className="text-xs text-slate-400 ml-2">
              {r.executed_by} · {new Date(r.executed_at).toLocaleString()}
            </span>
          </div>
        ))}
      </Section>

      {/* AI Screening */}
      <Section
        title="AI-Assisted Document Completeness Screening (H1)"
        subtitle="Deterministic rule-based check — advisory only; the reviewer's decision is the legal record."
        action={
          <ActionButton busy={busy === "ai"} onClick={() => runAction("ai", () => api(`/applications/${application.id}/ai-screening/run`, { method: "POST" }))}>
            Run screening
          </ActionButton>
        }
      >
        {ai_screening_runs.length === 0 && <Empty text="No screening run yet." />}
        {ai_screening_runs.map((r) => (
          <div key={r.id} className="text-sm border-b border-slate-100 py-2 last:border-0">
            <span className={r.passed ? "text-emerald-700 font-medium" : "text-amber-700 font-medium"}>
              {r.passed ? "No blocking findings" : "Findings require attention"}
            </span>
            <ul className="ml-5 mt-1 space-y-0.5">
              {r.findings.map((f, i) => (
                <li key={i} className={f.severity === "blocker" ? "text-rose-600" : "text-amber-600"}>
                  [{f.severity}] {f.doc_type}: {f.issue}
                </li>
              ))}
            </ul>
            <span className="text-xs text-slate-400">{new Date(r.executed_at).toLocaleString()}</span>
          </div>
        ))}
      </Section>

      {/* Criteria entry, grouped by category */}
      {byCategory.map(({ category, items }) => (
        <Section key={category} title={category} subtitle={`${items.length} active criteria · max ${items.reduce((s, c) => s + c.maxPts, 0)} pts`}>
          <div className="space-y-3">
            {items.map((c) => (
              <CriterionRow key={c.id} criterion={c} appId={application.id} onSaved={load} />
            ))}
          </div>
        </Section>
      ))}

      {/* Hazardous Waste Module */}
      {gates.g3 === "Y" && (
        <Section title="Hazardous Waste Module" subtitle="All five requirements must be met (Y) for a PASS result; completed only because gate G3 = Y.">
          <div className="space-y-2">
            {hazardous_module.map((h) => (
              <HazRow key={h.id} item={h} appId={application.id} onSaved={load} />
            ))}
          </div>
        </Section>
      )}

      {/* Scoring */}
      <Section
        title="Scoring & Classification"
        subtitle="Category-weighted, 100-point scale with differentiated category minimums, gates, and a retention buffer — reproduced from the EAD ESP Classification & Rating Calculator (R02)."
        action={
          <ActionButton busy={busy === "score"} onClick={() => runAction("score", () => api(`/applications/${application.id}/score/run`, { method: "POST" }))}>
            Run scoring
          </ActionButton>
        }
      >
        {!latestScore && <Empty text="No score run yet." />}
        {latestScore && (
          <div>
            <div className="flex items-center gap-3 mb-1">
              <TierBadge tier={latestScore.overridden ? latestScore.override_tier : latestScore.result.finalClassification} />
              <span className="text-sm text-slate-600">total {latestScore.result.total} / 100</span>
              {latestScore.overridden ? (
                <span className="text-xs text-amber-700">
                  Overridden from {latestScore.result.finalClassification} — {latestScore.override_justification}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-slate-500 mb-3">
              {latestScore.result.reason}
              {latestScore.result.hazardousModuleResult !== "N/A" && ` · Hazardous module: ${latestScore.result.hazardousModuleResult}`}
            </p>

            <table className="w-full text-xs mb-3">
              <thead className="text-slate-500 uppercase">
                <tr>
                  <th className="text-left py-1">Category</th>
                  <th className="text-left py-1">Weight</th>
                  <th className="text-left py-1">Score</th>
                  <th className="text-left py-1">%</th>
                  <th className="text-left py-1">Adv. min</th>
                  <th className="text-left py-1">Prem. min</th>
                </tr>
              </thead>
              <tbody>
                {latestScore.result.categories.map((c) => (
                  <tr key={c.category} className="border-t border-slate-100">
                    <td className="py-1">{c.category}</td>
                    <td className="py-1">{c.categoryWeight}</td>
                    <td className="py-1">{c.categoryScore.toFixed(1)}</td>
                    <td className="py-1">{c.categoryPct !== null ? `${(c.categoryPct * 100).toFixed(0)}%` : "—"}</td>
                    <td className="py-1">{c.advancedMinimumMet ? <span className="text-emerald-600">met</span> : <span className="text-rose-600">not met</span>}</td>
                    <td className="py-1">{c.premiumMinimumMet ? <span className="text-emerald-600">met</span> : <span className="text-rose-600">not met</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="text-xs text-slate-500 grid sm:grid-cols-3 gap-2 mb-3">
              <div>Score-based tier: <strong>{latestScore.result.scoreBasedTier}</strong></div>
              <div>With retention buffer: <strong>{latestScore.result.tierWithRetention}</strong>{latestScore.result.retained && " (retained)"}</div>
              <div>Gate cap: <strong>{latestScore.result.gateCapTier}</strong></div>
            </div>

            {!latestScore.overridden && <OverrideForm appId={application.id} scoreRunId={latestScore.id} onSaved={load} />}
          </div>
        )}
      </Section>

      {/* Upgrade eligibility */}
      {upgrade_eligibility && (
        <Section title="Classification Upgrade Cycle" subtitle="Systematic 6-month cycle; ad-hoc re-evaluation requests cannot be accommodated.">
          <p className={`text-sm ${upgrade_eligibility.eligible ? "text-emerald-700" : "text-amber-700"}`}>
            {upgrade_eligibility.eligible ? "Eligible to request re-evaluation now." : upgrade_eligibility.reason}
          </p>
          {upgrade_eligibility.eligible && (
            <ActionButton
              busy={busy === "upgrade"}
              onClick={() => runAction("upgrade", () => api(`/applications/${application.id}/upgrade-request`, { method: "POST" }))}
            >
              Record upgrade request
            </ActionButton>
          )}
        </Section>
      )}

      {/* Decision */}
      <Section title="Decision" subtitle="Single-reviewer decision model — the reviewer's decision remains the legal record.">
        {latestDecision && (
          <div className="text-sm mb-3 bg-slate-50 rounded p-3">
            <StatusBadge status={latestDecision.decision} /> <TierBadge tier={latestDecision.tier} />
            <p className="text-slate-600 mt-1">{latestDecision.note}</p>
            <p className="text-xs text-slate-400 mt-1">
              {latestDecision.decided_by} · {new Date(latestDecision.decided_at).toLocaleString()} ·{" "}
              {latestDecision.pushed_to_tamm ? "Pushed to TAMM" : "Not yet pushed to TAMM"}
            </p>
            {!latestDecision.pushed_to_tamm && (
              <ActionButton busy={busy === "push"} onClick={() => runAction("push", () => api(`/applications/${application.id}/push-to-tamm`, { method: "POST" }))}>
                Push result to TAMM
              </ActionButton>
            )}
          </div>
        )}
        {(!latestDecision || latestDecision.decision !== "approved") && (
          <DecisionForm
            appId={application.id}
            suggestedTier={latestScore ? (latestScore.overridden ? latestScore.override_tier! : latestScore.result.finalClassification) : undefined}
            onSaved={load}
          />
        )}
      </Section>
    </div>
  );
}

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 p-5">
      <div className="flex items-start justify-between mb-3 gap-4">
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-slate-400">{text}</p>;
}

function ActionButton({ children, onClick, busy }: { children: React.ReactNode; onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="px-3 py-1.5 bg-brand-blue-600 text-white text-sm rounded hover:bg-brand-blue-700 disabled:opacity-50 transition"
    >
      {busy ? "Working…" : children}
    </button>
  );
}

function GateRow({ label, value, derivedNote }: { label: string; value: "Y" | "N"; readOnly?: boolean; derivedNote?: string }) {
  return (
    <div className="flex items-center justify-between border border-slate-100 rounded px-3 py-2">
      <div>
        <div className="text-slate-700">{label}</div>
        {derivedNote && <div className="text-xs text-slate-400">{derivedNote}</div>}
      </div>
      <span className={`badge ${value === "Y" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{value}</span>
    </div>
  );
}

function GateEditRow({ label, value, onSave }: { label: string; value: "Y" | "N"; onSave: (v: "Y" | "N") => void }) {
  return (
    <div className="flex items-center justify-between border border-slate-100 rounded px-3 py-2">
      <div className="text-slate-700">{label}</div>
      <select value={value} onChange={(e) => onSave(e.target.value as "Y" | "N")} className="border border-slate-300 rounded px-2 py-1 text-xs">
        <option value="N">N</option>
        <option value="Y">Y</option>
      </select>
    </div>
  );
}

function DocRow({
  doc,
  appId,
  onSaved,
}: {
  doc: { id: string; doc_type: string; file_name: string; expiry_date: string | null; status: string };
  appId: string;
  onSaved: () => void;
}) {
  const [expiry, setExpiry] = useState(doc.expiry_date ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api(`/applications/${appId}/documents/${doc.id}/expiry`, { method: "POST", body: JSON.stringify({ expiry_date: expiry }) });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="py-1.5">{doc.doc_type}</td>
      <td className="py-1.5 text-slate-500">{doc.file_name}</td>
      <td className="py-1.5">
        <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="border border-slate-300 rounded px-2 py-0.5 text-xs" />
      </td>
      <td className="py-1.5">
        <button onClick={save} disabled={saving} className="text-xs text-brand-blue-600 hover:underline disabled:opacity-50">
          Save
        </button>
      </td>
    </tr>
  );
}

function CriterionRow({ criterion, appId, onSaved }: { criterion: Criterion; appId: string; onSaved: () => void }) {
  const [applicable, setApplicable] = useState<"Y" | "N/A">(criterion.entry?.applicable ?? "Y");
  const [value, setValue] = useState<string>(criterion.entry?.value !== null && criterion.entry?.value !== undefined ? String(criterion.entry.value) : "");
  const [evidenceVerified, setEvidenceVerified] = useState<"Y" | "N" | "">(criterion.entry?.evidenceVerified ?? "");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api(`/applications/${appId}/criteria/${criterion.id}`, {
        method: "PUT",
        body: JSON.stringify({
          applicable,
          value: applicable === "N/A" || value === "" ? null : Number(value),
          evidenceVerified: evidenceVerified === "" ? null : evidenceVerified,
        }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-100 rounded p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-800">
            {criterion.id} — {criterion.name} <span className="text-slate-400 font-normal">({criterion.maxPts} pts)</span>
          </div>
          <button onClick={() => setOpen((o) => !o)} className="text-xs text-brand-blue-600 hover:underline mt-0.5">
            {open ? "Hide KPI definition" : "Show KPI definition & scoring rule"}
          </button>
          {open && (
            <div className="text-xs text-slate-500 mt-1 space-y-1 max-w-2xl">
              <p>{criterion.kpiDefinition}</p>
              <p>
                <span className="font-medium">Unit:</span> {criterion.unit} · <span className="font-medium">Scoring:</span> {criterion.scoringRule}
              </p>
              <p>
                <span className="font-medium">Data source:</span> {criterion.dataSource}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <label className="text-xs text-slate-500">
          Applicable
          <select value={applicable} onChange={(e) => setApplicable(e.target.value as "Y" | "N/A")} className="ml-1 border border-slate-300 rounded px-2 py-1 text-xs">
            <option value="Y">Y</option>
            <option value="N/A">N/A</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Measured value ({criterion.unit})
          <input
            type="number"
            step="any"
            disabled={applicable === "N/A"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="ml-1 w-24 border border-slate-300 rounded px-2 py-1 text-xs disabled:bg-slate-50"
          />
        </label>
        <label className="text-xs text-slate-500">
          Evidence verified
          <select
            disabled={applicable === "N/A"}
            value={evidenceVerified}
            onChange={(e) => setEvidenceVerified(e.target.value as "Y" | "N" | "")}
            className="ml-1 border border-slate-300 rounded px-2 py-1 text-xs disabled:bg-slate-50"
          >
            <option value="">—</option>
            <option value="Y">Y</option>
            <option value="N">N</option>
          </select>
        </label>
        <button onClick={save} disabled={saving} className="text-xs text-white bg-brand-blue-600 rounded px-3 py-1 hover:bg-brand-blue-700 disabled:opacity-50">
          Save
        </button>
      </div>
    </div>
  );
}

function HazRow({ item, appId, onSaved }: { item: HazItem; appId: string; onSaved: () => void }) {
  const [met, setMet] = useState<"Y" | "N">(item.met ?? "N");
  const [saving, setSaving] = useState(false);

  async function save(v: "Y" | "N") {
    setMet(v);
    setSaving(true);
    try {
      await api(`/applications/${appId}/hazardous-module/${item.id}`, { method: "PUT", body: JSON.stringify({ met: v }) });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between border border-slate-100 rounded px-3 py-2 text-sm">
      <div>
        <div className="text-slate-700">
          {item.id} — {item.requirement}
        </div>
        <div className="text-xs text-slate-400">{item.verification}</div>
      </div>
      <select value={met} disabled={saving} onChange={(e) => save(e.target.value as "Y" | "N")} className="border border-slate-300 rounded px-2 py-1 text-xs">
        <option value="N">N</option>
        <option value="Y">Y</option>
      </select>
    </div>
  );
}

function OverrideForm({ appId, scoreRunId, onSaved }: { appId: string; scoreRunId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState("Basic");
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await api(`/applications/${appId}/score/${scoreRunId}/override`, { method: "POST", body: JSON.stringify({ tier, justification }) });
      onSaved();
      setOpen(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-amber-700 hover:underline">
        Override classification (requires justification)
      </button>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded p-3 mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium">New tier</label>
        <select value={tier} onChange={(e) => setTier(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs">
          {["Basic", "Advanced", "Premium"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <textarea
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        placeholder="Justification for overriding the computed classification…"
        className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
        rows={2}
      />
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving} className="px-3 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700 disabled:opacity-50">
          Confirm override
        </button>
        <button onClick={() => setOpen(false)} className="px-3 py-1 text-xs text-slate-500">
          Cancel
        </button>
      </div>
    </div>
  );
}

function DecisionForm({ appId, suggestedTier, onSaved }: { appId: string; suggestedTier?: string; onSaved: () => void }) {
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [tier, setTier] = useState(suggestedTier && suggestedTier !== "NOT ELIGIBLE" ? suggestedTier : "Basic");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await api(`/applications/${appId}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, tier: decision === "approved" ? tier : null, note }),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <select value={decision} onChange={(e) => setDecision(e.target.value as "approved" | "rejected")} className="border border-slate-300 rounded px-2 py-1 text-sm">
          <option value="approved">Approve</option>
          <option value="rejected">Reject</option>
        </select>
        {decision === "approved" && (
          <select value={tier} onChange={(e) => setTier(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-sm">
            {["Basic", "Advanced", "Premium"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note…" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" rows={2} />
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <ActionButton busy={saving} onClick={submit}>
        Record decision
      </ActionButton>
    </div>
  );
}
