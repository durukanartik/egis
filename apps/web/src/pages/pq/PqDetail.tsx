import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { StatusBadge } from "../../components/Badges";

type PqCriterion = {
  id: string;
  theme: string;
  requirement: string;
  entry: { outcome: string; note: string | null } | null;
};

type Detail = {
  pq_assessment: {
    id: string;
    esp_id: string;
    status: string;
    tamm_reference: string;
    pq_activity_category: string;
    pq_reason: string;
    pq_overall_result: string | null;
    pq_conditional_open_items: string[];
    pq_decision_note: string | null;
    pq_decided_by: string | null;
    pq_decided_at: string | null;
    submitted_at: string;
  };
  esp: {
    legal_name: string;
    sector: string;
    commercial_licence_number: string;
    licence_status: string;
    waste_licence_number: string | null;
  };
  criteria: PqCriterion[];
  active_block: { id: string; reason: string; source: string; effective_date: string } | null;
};

const OUTCOMES = ["Eligible", "Conditional", "Not eligible", "Manual review"];

export default function PqDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api<Detail>(`/pq/${id}`).then(setDetail);
  }, [id]);

  useEffect(() => load(), [load]);

  if (!detail) return <div className="text-slate-400">Loading…</div>;

  const { pq_assessment, esp, criteria, active_block } = detail;
  const decided = pq_assessment.status === "decided";

  return (
    <div className="space-y-6">
      <div>
        <Link to="/pq" className="text-sm text-brand-blue-600 hover:underline">
          ← Back to PQ queue
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 p-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{esp.legal_name}</h1>
          <p className="text-sm text-slate-500">
            {esp.sector} · CN {esp.commercial_licence_number} · {pq_assessment.pq_activity_category.replace(/_/g, " ")} ·{" "}
            {pq_assessment.pq_reason.replace(/_/g, " ")} · TAMM {pq_assessment.tamm_reference}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <StatusBadge status={pq_assessment.status} />
          {pq_assessment.pq_overall_result && <StatusBadge status={pq_assessment.pq_overall_result} />}
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded px-4 py-2">{error}</div>}

      {active_block && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-100 text-rose-800 text-sm rounded-xl px-4 py-3">
          Active block: {active_block.reason} ({active_block.source}, since {new Date(active_block.effective_date).toLocaleDateString()}) — an
          Authorisation cannot be issued while this is active.
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 p-5">
        <h2 className="font-semibold text-slate-900 mb-1">PQ Criteria</h2>
        <p className="text-xs text-slate-500 mb-3">
          One outcome per criterion rolls up into the overall result (Section 7.1). A Conditional overall result carries a list
          of open items that must close before the Authorisation is issued.
        </p>
        <div className="space-y-2">
          {criteria.map((c) => (
            <CriterionRow key={c.id} criterion={c} pqId={pq_assessment.id} disabled={decided} onSaved={load} />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 p-5">
        <h2 className="font-semibold text-slate-900 mb-1">Decision</h2>
        {decided ? (
          <div className="text-sm bg-slate-50 rounded p-3">
            <StatusBadge status={pq_assessment.pq_overall_result ?? ""} />
            <p className="text-slate-600 mt-1">{pq_assessment.pq_decision_note}</p>
            {pq_assessment.pq_conditional_open_items.length > 0 && (
              <ul className="list-disc ml-5 text-amber-700 mt-1">
                {pq_assessment.pq_conditional_open_items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-400 mt-1">
              {pq_assessment.pq_decided_by} · {pq_assessment.pq_decided_at && new Date(pq_assessment.pq_decided_at).toLocaleString()}
            </p>
          </div>
        ) : (
          <DecisionForm pqId={pq_assessment.id} busy={busy} setBusy={setBusy} setError={setError} onSaved={load} />
        )}
      </div>
    </div>
  );
}

function CriterionRow({
  criterion,
  pqId,
  disabled,
  onSaved,
}: {
  criterion: PqCriterion;
  pqId: string;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [outcome, setOutcome] = useState(criterion.entry?.outcome ?? "Manual review");
  const [note, setNote] = useState(criterion.entry?.note ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api(`/pq/${pqId}/criteria/${criterion.id}`, { method: "PUT", body: JSON.stringify({ outcome, note: note || null }) });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-100 rounded p-3">
      <div className="text-sm font-medium text-slate-800">
        {criterion.id} — {criterion.theme}
      </div>
      <p className="text-xs text-slate-500 mt-0.5 mb-2">{criterion.requirement}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          disabled={disabled}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 text-xs disabled:bg-slate-50"
        >
          {OUTCOMES.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <input
          disabled={disabled}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="flex-1 min-w-[12rem] border border-slate-300 rounded px-2 py-1 text-xs disabled:bg-slate-50"
        />
        {!disabled && (
          <button onClick={save} disabled={saving} className="text-xs text-white bg-brand-blue-600 rounded px-3 py-1 hover:bg-brand-blue-700 disabled:opacity-50">
            Save
          </button>
        )}
      </div>
    </div>
  );
}

function DecisionForm({
  pqId,
  busy,
  setBusy,
  setError,
  onSaved,
}: {
  pqId: string;
  busy: string | null;
  setBusy: (b: string | null) => void;
  setError: (e: string | null) => void;
  onSaved: () => void;
}) {
  const [result, setResult] = useState("Eligible");
  const [note, setNote] = useState("");
  const [openItems, setOpenItems] = useState("");

  async function submit() {
    setBusy("decide");
    setError(null);
    try {
      await api(`/pq/${pqId}/decide`, {
        method: "POST",
        body: JSON.stringify({
          result,
          note,
          conditional_open_items: result === "Conditional" ? openItems.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
        }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <select value={result} onChange={(e) => setResult(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-sm">
          {OUTCOMES.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      {result === "Conditional" && (
        <textarea
          value={openItems}
          onChange={(e) => setOpenItems(e.target.value)}
          placeholder="Open items that must close before issuance (one per line)…"
          className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
          rows={2}
        />
      )}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note…" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" rows={2} />
      <button
        onClick={submit}
        disabled={busy === "decide"}
        className="px-3 py-1.5 bg-brand-blue-600 text-white text-sm rounded hover:bg-brand-blue-700 disabled:opacity-50 transition"
      >
        {busy === "decide" ? "Working…" : "Record PQ decision"}
      </button>
    </div>
  );
}
