import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { StatusBadge, TierBadge } from "../../components/Badges";

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
    classification_valid_until: string | null;
  };
  documents: { id: string; doc_type: string; file_name: string; expiry_date: string | null; status: string }[];
  eligibility_runs: { id: string; passed: number; reasons: string[]; executed_at: string; executed_by: string }[];
  ai_screening_runs: { id: string; passed: number; findings: { severity: string; doc_type: string; issue: string }[]; executed_at: string }[];
  score_runs: {
    id: string;
    raw_score: number;
    tier: string;
    executed_at: string;
    executed_by: string;
    overridden: number;
    override_tier: string | null;
    override_justification: string | null;
    breakdown: {
      code: string;
      name: string;
      value: number | null;
      criterion_tier: string | null;
      normalized_weight: number;
      contribution: number;
      applicable: boolean;
      evaluable: boolean;
      reason_excluded?: string;
    }[];
  }[];
  decisions: { id: string; decision: string; tier: string | null; note: string | null; decided_by: string; decided_at: string; pushed_to_tamm: number }[];
  upgrade_eligibility: { eligible: boolean; reason?: string; nextEligibleDate?: string } | null;
};

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bolisaty, setBolisaty] = useState<Record<string, unknown> | null>(null);
  const [iwms, setIwms] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api<Detail>(`/applications/${id}`).then((d) => {
      setDetail(d);
      api<{ data: Record<string, unknown> }>(`/integration/bolisaty/${d.esp.id}`).then((r) => setBolisaty(r.data)).catch(() => {});
      api<{ data: Record<string, unknown> }>(`/integration/iwms/${d.esp.id}`).then((r) => setIwms(r.data)).catch(() => {});
    });
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

  const { application, esp, documents, eligibility_runs, ai_screening_runs, score_runs, decisions, upgrade_eligibility } = detail;
  const latestScore = score_runs[0];
  const latestDecision = decisions[0];

  return (
    <div className="space-y-6">
      <div>
        <Link to="/reviewer/queue" className="text-sm text-sky-700 hover:underline">
          ← Back to queue
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 flex flex-wrap items-start justify-between gap-4">
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

      {/* Documents */}
      <Section title="Documents" subtitle="Manual expiry-date entry at MVP (Section 6: Document Management — no TAMM My Locker reuse).">
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
        subtitle="Licence-status gating: active, non-expired, non-suspended (Section 8.1)."
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
        subtitle="Deterministic rule-based check — advisory only; the reviewer's decision is the legal record (Section 12)."
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

      {/* Integrated data */}
      <Section title="Integrated Data (read-only)" subtitle="Snapshot via the Integration Gateway: AD Connect/Bolisaty and IWMS (Section 9).">
        <div className="grid md:grid-cols-2 gap-4">
          <DataPanel title="Bolisaty (via AD Connect)" data={bolisaty} />
          <DataPanel title="IWMS" data={iwms} />
        </div>
      </Section>

      {/* Scoring */}
      <Section
        title="Scoring & Classification"
        subtitle="Pure function over (Application, ConfigVersion, IntegratedData) — reproducible from its ConfigVersion (Section 8)."
        action={
          <ActionButton busy={busy === "score"} onClick={() => runAction("score", () => api(`/applications/${application.id}/score/run`, { method: "POST" }))}>
            Run scoring
          </ActionButton>
        }
      >
        {!latestScore && <Empty text="No score run yet." />}
        {latestScore && (
          <div>
            <div className="flex items-center gap-3 mb-2">
              <TierBadge tier={latestScore.overridden ? latestScore.override_tier : latestScore.tier} />
              <span className="text-sm text-slate-600">raw score {latestScore.raw_score}</span>
              {latestScore.overridden ? (
                <span className="text-xs text-amber-700">
                  Overridden from {latestScore.tier} — {latestScore.override_justification}
                </span>
              ) : null}
            </div>
            <table className="w-full text-xs mb-3">
              <thead className="text-slate-500 uppercase">
                <tr>
                  <th className="text-left py-1">Criterion</th>
                  <th className="text-left py-1">Value</th>
                  <th className="text-left py-1">Criterion tier</th>
                  <th className="text-left py-1">Weight</th>
                  <th className="text-left py-1">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {latestScore.breakdown.map((b) => (
                  <tr key={b.code} className="border-t border-slate-100">
                    <td className="py-1">
                      <div className="font-medium">{b.name}</div>
                      <div className="text-slate-400">{b.code}</div>
                    </td>
                    <td className="py-1">{b.evaluable ? b.value : <span className="text-slate-400 italic">{b.reason_excluded}</span>}</td>
                    <td className="py-1">{b.criterion_tier ?? "—"}</td>
                    <td className="py-1">{(b.normalized_weight * 100).toFixed(0)}%</td>
                    <td className="py-1">{b.contribution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!latestScore.overridden && (
              <OverrideForm appId={application.id} scoreRunId={latestScore.id} onSaved={load} />
            )}
          </div>
        )}
      </Section>

      {/* Upgrade eligibility */}
      {upgrade_eligibility && (
        <Section title="Classification Upgrade Cycle" subtitle="Systematic 6-month cycle; ad-hoc re-evaluation requests cannot be accommodated (Section 8.1, Rule C5).">
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
      <Section title="Decision" subtitle="Single-reviewer decision model — the reviewer's decision remains the legal record (Section 12, R10).">
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
          <DecisionForm appId={application.id} suggestedTier={latestScore ? (latestScore.overridden ? latestScore.override_tier! : latestScore.tier) : undefined} onSaved={load} />
        )}
      </Section>
    </div>
  );
}

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
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
      className="px-3 py-1.5 bg-slate-900 text-white text-sm rounded hover:bg-slate-800 disabled:opacity-50 transition"
    >
      {busy ? "Working…" : children}
    </button>
  );
}

function DataPanel({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  return (
    <div className="border border-slate-100 rounded p-3">
      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">{title}</h3>
      {!data && <p className="text-xs text-slate-400">No snapshot.</p>}
      {data && (
        <dl className="text-xs space-y-1">
          {Object.entries(data).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-slate-500">{k}</dt>
              <dd className={v === null ? "text-slate-300 italic" : "text-slate-800 font-medium"}>
                {v === null ? "Not Available" : Array.isArray(v) ? v.join(", ") : String(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
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
        <button onClick={save} disabled={saving} className="text-xs text-sky-700 hover:underline disabled:opacity-50">
          Save
        </button>
      </td>
    </tr>
  );
}

function OverrideForm({ appId, scoreRunId, onSaved }: { appId: string; scoreRunId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [tier, setTier] = useState("A");
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
        Override score (requires justification)
      </button>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded p-3 mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium">New tier</label>
        <select value={tier} onChange={(e) => setTier(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs">
          {["A", "B", "C", "D"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <textarea
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        placeholder="Justification for overriding the computed tier…"
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
  const [tier, setTier] = useState(suggestedTier ?? "A");
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
            {["A", "B", "C", "D"].map((t) => (
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
