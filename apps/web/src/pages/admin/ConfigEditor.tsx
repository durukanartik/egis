import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { StatusBadge } from "../../components/Badges";
import { useAuth } from "../../auth/AuthContext";

type Criterion = {
  code: string;
  sector: string;
  name: string;
  data_source: string;
  formula: string;
  weight: number;
  active: boolean;
  thresholds: { T1: number; T2: number; T3: number };
};

type LifecycleRules = {
  licence_status_gating: boolean;
  suspension_cascade: boolean;
  classification_validity_months: number;
  upgrade_cycle_months: number;
  review_window_days: number;
  gps_scope: string;
};

type VersionFull = {
  id: string;
  version_number: number;
  status: string;
  criteria: Criterion[];
  lifecycle_rules: LifecycleRules;
  tier_thresholds: { A: number; B: number; C: number };
  notes: string | null;
  created_by: string;
  approved_by: string | null;
};

type SimResult = {
  esp_id: string;
  esp_name: string;
  sector: string;
  candidate: { raw_score: number; tier: string };
  published: { raw_score: number; tier: string } | null;
  tier_changed: boolean | null;
};

export default function ConfigEditor() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [version, setVersion] = useState<VersionFull | null>(null);
  const [sim, setSim] = useState<SimResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [approvalNote, setApprovalNote] = useState("Reviewed criteria changes and sample simulation — approved.");

  const load = useCallback(() => {
    if (!id) return;
    api<{ version: VersionFull }>(`/config/versions/${id}`).then((r) => {
      setVersion(r.version);
      setNotes(r.version.notes ?? "");
    });
  }, [id]);

  useEffect(() => load(), [load]);

  const editable = version?.status === "draft";

  function updateCriterion(idx: number, patch: Partial<Criterion>) {
    if (!version) return;
    const criteria = version.criteria.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setVersion({ ...version, criteria });
  }

  function updateLifecycle(patch: Partial<LifecycleRules>) {
    if (!version) return;
    setVersion({ ...version, lifecycle_rules: { ...version.lifecycle_rules, ...patch } });
  }

  function updateTierThreshold(key: "A" | "B" | "C", value: number) {
    if (!version) return;
    setVersion({ ...version, tier_thresholds: { ...version.tier_thresholds, [key]: value } });
  }

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
      setSim(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!version) return;
    await act("save", () =>
      api(`/config/versions/${version.id}`, {
        method: "PUT",
        body: JSON.stringify({ criteria: version.criteria, lifecycle_rules: version.lifecycle_rules, tier_thresholds: version.tier_thresholds, notes }),
      })
    );
  }

  async function simulate() {
    if (!version) return;
    setBusy("simulate");
    setError(null);
    try {
      await saveDraft();
      const res = await api<{ results: SimResult[] }>(`/config/versions/${version.id}/simulate`, { method: "POST", body: JSON.stringify({}) });
      setSim(res.results);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Simulation failed");
    } finally {
      setBusy(null);
    }
  }

  if (!version) return <div className="text-slate-400">Loading…</div>;

  const isOwnDraft = version.created_by === user?.username;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/config" className="text-sm text-sky-700 hover:underline">
          ← Back to config versions
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ConfigVersion v{version.version_number}</h1>
          <p className="text-sm text-slate-500">Created by {version.created_by}</p>
        </div>
        <StatusBadge status={version.status} />
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded px-4 py-2">{error}</div>}

      <Section title="Scoring Criteria" subtitle="Weights renormalized at run-time among applicable, active criteria for each ESP's sector (Section 8).">
        <table className="w-full text-xs">
          <thead className="text-slate-500 uppercase">
            <tr>
              <th className="text-left py-1">Code / Sector</th>
              <th className="text-left py-1">Data source</th>
              <th className="text-left py-1">Weight</th>
              <th className="text-left py-1">T1 / T2 / T3</th>
              <th className="text-left py-1">Active</th>
            </tr>
          </thead>
          <tbody>
            {version.criteria.map((c, idx) => (
              <tr key={c.code} className="border-t border-slate-100">
                <td className="py-1.5 pr-2">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-slate-400 font-mono">
                    {c.code} · {c.sector}
                  </div>
                </td>
                <td className="py-1.5 pr-2 text-slate-500 max-w-[14rem]">{c.data_source}</td>
                <td className="py-1.5 pr-2">
                  <input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    disabled={!editable}
                    value={c.weight}
                    onChange={(e) => updateCriterion(idx, { weight: Number(e.target.value) })}
                    className="w-16 border border-slate-300 rounded px-1 py-0.5 disabled:bg-slate-50"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <div className="flex gap-1">
                    {(["T1", "T2", "T3"] as const).map((t) => (
                      <input
                        key={t}
                        type="number"
                        step="0.05"
                        disabled={!editable}
                        value={c.thresholds[t]}
                        onChange={(e) => updateCriterion(idx, { thresholds: { ...c.thresholds, [t]: Number(e.target.value) } })}
                        className="w-14 border border-slate-300 rounded px-1 py-0.5 disabled:bg-slate-50"
                      />
                    ))}
                  </div>
                </td>
                <td className="py-1.5">
                  <input type="checkbox" disabled={!editable} checked={c.active} onChange={(e) => updateCriterion(idx, { active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Lifecycle Rules" subtitle="Confirmed 17 September 2026 (Section 8.1).">
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <Field label="Classification validity (months)">
            <input
              type="number"
              disabled={!editable}
              value={version.lifecycle_rules.classification_validity_months}
              onChange={(e) => updateLifecycle({ classification_validity_months: Number(e.target.value) })}
              className="w-full border border-slate-300 rounded px-2 py-1 disabled:bg-slate-50"
            />
          </Field>
          <Field label="Upgrade cycle (months)">
            <input
              type="number"
              disabled={!editable}
              value={version.lifecycle_rules.upgrade_cycle_months}
              onChange={(e) => updateLifecycle({ upgrade_cycle_months: Number(e.target.value) })}
              className="w-full border border-slate-300 rounded px-2 py-1 disabled:bg-slate-50"
            />
          </Field>
          <Field label="Review window (days)">
            <input
              type="number"
              disabled={!editable}
              value={version.lifecycle_rules.review_window_days}
              onChange={(e) => updateLifecycle({ review_window_days: Number(e.target.value) })}
              className="w-full border border-slate-300 rounded px-2 py-1 disabled:bg-slate-50"
            />
          </Field>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          GPS scope: {version.lifecycle_rules.gps_scope.replace(/_/g, " ")} — real-time movement data is excluded from all scoring criteria (Rule R5).
        </p>
      </Section>

      <Section title="Overall Tier Thresholds" subtitle="Aggregate weighted score cutoffs mapping to Tier A/B/C/D.">
        <div className="grid grid-cols-3 gap-4 text-sm max-w-md">
          {(["A", "B", "C"] as const).map((k) => (
            <Field key={k} label={`Tier ${k} ≥`}>
              <input
                type="number"
                step="0.05"
                disabled={!editable}
                value={version.tier_thresholds[k]}
                onChange={(e) => updateTierThreshold(k, Number(e.target.value))}
                className="w-full border border-slate-300 rounded px-2 py-1 disabled:bg-slate-50"
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Notes">
        <textarea
          disabled={!editable}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full border border-slate-300 rounded px-2 py-1 text-sm disabled:bg-slate-50"
          rows={2}
        />
      </Section>

      <Section title="Governance Workflow" subtitle="Draft → Simulate → Submit for approval → Approve (separate approver) → Publish.">
        <div className="flex flex-wrap gap-2 mb-4">
          {editable && (
            <>
              <WfButton busy={busy === "save"} onClick={saveDraft}>
                Save draft
              </WfButton>
              <WfButton busy={busy === "simulate"} onClick={simulate}>
                Simulate against sample applications
              </WfButton>
              <WfButton busy={busy === "submit"} onClick={() => act("submit", () => api(`/config/versions/${version.id}/submit-for-approval`, { method: "POST" }))}>
                Submit for approval
              </WfButton>
            </>
          )}
          {version.status === "pending_approval" && (
            <div className="w-full space-y-2">
              {isOwnDraft && (
                <p className="text-xs text-amber-700">
                  Segregation of duties: you authored this draft, so a different Admin must approve it.
                </p>
              )}
              <textarea
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                rows={2}
              />
              <div className="flex gap-2">
                <WfButton
                  busy={busy === "approve"}
                  disabled={isOwnDraft}
                  onClick={() => act("approve", () => api(`/config/versions/${version.id}/approve`, { method: "POST", body: JSON.stringify({ note: approvalNote }) }))}
                >
                  Approve
                </WfButton>
                <button
                  onClick={() => act("reject", () => api(`/config/versions/${version.id}/reject`, { method: "POST", body: JSON.stringify({ note: approvalNote }) }))}
                  className="px-3 py-1.5 bg-rose-100 text-rose-700 text-sm rounded hover:bg-rose-200"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
          {version.status === "approved" && (
            <WfButton busy={busy === "publish"} onClick={() => act("publish", () => api(`/config/versions/${version.id}/publish`, { method: "POST" }))}>
              Publish ConfigVersion
            </WfButton>
          )}
        </div>

        {sim && (
          <div>
            <h3 className="text-sm font-semibold mb-2">Simulation results (sample ESPs)</h3>
            <table className="w-full text-xs">
              <thead className="text-slate-500 uppercase">
                <tr>
                  <th className="text-left py-1">ESP</th>
                  <th className="text-left py-1">Sector</th>
                  <th className="text-left py-1">Published score / tier</th>
                  <th className="text-left py-1">Candidate score / tier</th>
                  <th className="text-left py-1">Change</th>
                </tr>
              </thead>
              <tbody>
                {sim.map((r) => (
                  <tr key={r.esp_id} className={`border-t border-slate-100 ${r.tier_changed ? "bg-amber-50" : ""}`}>
                    <td className="py-1">{r.esp_name}</td>
                    <td className="py-1">{r.sector}</td>
                    <td className="py-1">{r.published ? `${r.published.raw_score} / ${r.published.tier}` : "—"}</td>
                    <td className="py-1">
                      {r.candidate.raw_score} / {r.candidate.tier}
                    </td>
                    <td className="py-1">{r.tier_changed ? "Tier changes" : "No change"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5 mb-3">{subtitle}</p>}
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function WfButton({ children, onClick, busy, disabled }: { children: React.ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="px-3 py-1.5 bg-slate-900 text-white text-sm rounded hover:bg-slate-800 disabled:opacity-40 transition"
    >
      {busy ? "Working…" : children}
    </button>
  );
}
