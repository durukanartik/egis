import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { StatusBadge } from "../../components/Badges";
import { useAuth } from "../../auth/AuthContext";

type Thresholds = { t1: number; pts1: number; t2: number | null; pts2: number | null; t3: number | null; pts3: number | null; belowPts: number };

type Criterion = {
  id: string;
  sector: "Transportation" | "Trading" | "Treatment";
  category: string;
  name: string;
  status: "Active" | "Phase 2";
  maxPts: number;
  kpiDefinition: string;
  unit: string;
  scoringRule: string;
  direction: "H" | "L";
  thresholds: Thresholds;
  dataSource: string;
  evidenceRequired: string;
};

type HazItem = { id: string; requirement: string; verification: string };

type ClassificationParameters = {
  advancedMinTotal: number;
  premiumMinTotal: number;
  retentionBufferPoints: number;
  gateCapG1: string;
  gateCapG2: string;
  gateCapG3: string;
  categoryMinimums: Record<string, { advanced: number; premium: number }>;
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
  hazardous_module: Record<string, HazItem[]>;
  classification_parameters: ClassificationParameters;
  lifecycle_rules: LifecycleRules;
  notes: string | null;
  created_by: string;
  approved_by: string | null;
};

type SimResult = {
  esp_id: string;
  esp_name: string;
  sector: string;
  candidate: { total: number; tier: string };
  published: { total: number; tier: string } | null;
  tier_changed: boolean | null;
};

const SECTORS: Array<Criterion["sector"]> = ["Transportation", "Trading", "Treatment"];
const CATEGORIES = [
  "Regulatory & Organisational Capability",
  "Technical Capability",
  "Environmental & HSE Performance",
  "Digital Capability",
];

export default function ConfigEditor() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [version, setVersion] = useState<VersionFull | null>(null);
  const [sim, setSim] = useState<SimResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [approvalNote, setApprovalNote] = useState("Reviewed criteria changes and sample simulation — approved.");
  const [activeSector, setActiveSector] = useState<Criterion["sector"]>("Transportation");

  const load = useCallback(() => {
    if (!id) return;
    api<{ version: VersionFull }>(`/config/versions/${id}`).then((r) => {
      setVersion(r.version);
      setNotes(r.version.notes ?? "");
    });
  }, [id]);

  useEffect(() => load(), [load]);

  const editable = version?.status === "draft";

  function updateCriterion(criterionId: string, patch: Partial<Criterion>) {
    if (!version) return;
    const criteria = version.criteria.map((c) => (c.id === criterionId ? { ...c, ...patch } : c));
    setVersion({ ...version, criteria });
  }

  function updateThreshold(criterionId: string, patch: Partial<Thresholds>) {
    if (!version) return;
    const criteria = version.criteria.map((c) => (c.id === criterionId ? { ...c, thresholds: { ...c.thresholds, ...patch } } : c));
    setVersion({ ...version, criteria });
  }

  function updateLifecycle(patch: Partial<LifecycleRules>) {
    if (!version) return;
    setVersion({ ...version, lifecycle_rules: { ...version.lifecycle_rules, ...patch } });
  }

  function updateParams(patch: Partial<ClassificationParameters>) {
    if (!version) return;
    setVersion({ ...version, classification_parameters: { ...version.classification_parameters, ...patch } });
  }

  function updateCategoryMinimum(category: string, key: "advanced" | "premium", value: number) {
    if (!version) return;
    setVersion({
      ...version,
      classification_parameters: {
        ...version.classification_parameters,
        categoryMinimums: {
          ...version.classification_parameters.categoryMinimums,
          [category]: { ...version.classification_parameters.categoryMinimums[category], [key]: value },
        },
      },
    });
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
        body: JSON.stringify({
          criteria: version.criteria,
          hazardous_module: version.hazardous_module,
          classification_parameters: version.classification_parameters,
          lifecycle_rules: version.lifecycle_rules,
          notes,
        }),
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
  const sectorCriteria = version.criteria.filter((c) => c.sector === activeSector);
  const sectorTotal = sectorCriteria.filter((c) => c.status === "Active").reduce((s, c) => s + c.maxPts, 0);

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

      <Section
        title="Scoring Criteria"
        subtitle="Reproduced from the EAD ESP Classification & Rating Calculator (R02). Category weight = sum of max points of Active criteria; an inapplicable (N/A) criterion's points are re-scaled among the rest of its category at run-time."
      >
        <div className="flex gap-2 mb-3">
          {SECTORS.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSector(s)}
              className={`px-3 py-1 rounded text-xs font-medium border ${
                activeSector === s ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300"
              }`}
            >
              {s}
            </button>
          ))}
          <span className={`ml-2 text-xs self-center ${sectorTotal === 100 ? "text-emerald-600" : "text-rose-600"}`}>
            Active weight total: {sectorTotal} {sectorTotal === 100 ? "(OK)" : "(should be 100)"}
          </span>
        </div>

        {CATEGORIES.map((cat) => {
          const items = sectorCriteria.filter((c) => c.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat} className="mb-4">
              <h3 className="text-xs font-semibold text-slate-600 uppercase mb-1">{cat}</h3>
              <table className="w-full text-xs mb-2">
                <thead className="text-slate-500 uppercase">
                  <tr>
                    <th className="text-left py-1">Criterion</th>
                    <th className="text-left py-1">Status</th>
                    <th className="text-left py-1">Max pts</th>
                    <th className="text-left py-1">Dir</th>
                    <th className="text-left py-1">T1/pts1 · T2/pts2 · T3/pts3 · below</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100 align-top">
                      <td className="py-1.5 pr-2">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-slate-400 font-mono">{c.id}</div>
                      </td>
                      <td className="py-1.5 pr-2">
                        <select
                          disabled={!editable}
                          value={c.status}
                          onChange={(e) => updateCriterion(c.id, { status: e.target.value as Criterion["status"] })}
                          className="border border-slate-300 rounded px-1 py-0.5 disabled:bg-slate-50"
                        >
                          <option value="Active">Active</option>
                          <option value="Phase 2">Phase 2</option>
                        </select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          type="number"
                          disabled={!editable}
                          value={c.maxPts}
                          onChange={(e) => updateCriterion(c.id, { maxPts: Number(e.target.value) })}
                          className="w-14 border border-slate-300 rounded px-1 py-0.5 disabled:bg-slate-50"
                        />
                      </td>
                      <td className="py-1.5 pr-2">{c.direction}</td>
                      <td className="py-1.5">
                        <div className="flex gap-1 flex-wrap">
                          <ThresholdInput disabled={!editable} value={c.thresholds.t1} onChange={(v) => updateThreshold(c.id, { t1: v })} />
                          <ThresholdInput disabled={!editable} value={c.thresholds.pts1} onChange={(v) => updateThreshold(c.id, { pts1: v })} />
                          <span className="text-slate-300">·</span>
                          <ThresholdInput disabled={!editable} value={c.thresholds.t2} onChange={(v) => updateThreshold(c.id, { t2: v })} />
                          <ThresholdInput disabled={!editable} value={c.thresholds.pts2} onChange={(v) => updateThreshold(c.id, { pts2: v })} />
                          <span className="text-slate-300">·</span>
                          <ThresholdInput disabled={!editable} value={c.thresholds.t3} onChange={(v) => updateThreshold(c.id, { t3: v })} />
                          <ThresholdInput disabled={!editable} value={c.thresholds.pts3} onChange={(v) => updateThreshold(c.id, { pts3: v })} />
                          <span className="text-slate-300">·</span>
                          <ThresholdInput disabled={!editable} value={c.thresholds.belowPts} onChange={(v) => updateThreshold(c.id, { belowPts: v })} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </Section>

      <Section title="Category Minimums" subtitle="Non-compensation rule: a tier requires the total score threshold AND every category at or above its minimum (% of category weight).">
        <table className="w-full text-sm max-w-xl">
          <thead className="text-xs text-slate-500 uppercase">
            <tr>
              <th className="text-left py-1">Category</th>
              <th className="text-left py-1">Advanced min</th>
              <th className="text-left py-1">Premium min</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((cat) => (
              <tr key={cat} className="border-t border-slate-100">
                <td className="py-1.5">{cat}</td>
                <td className="py-1.5">
                  <input
                    type="number"
                    step="0.05"
                    disabled={!editable}
                    value={version.classification_parameters.categoryMinimums[cat]?.advanced ?? 0}
                    onChange={(e) => updateCategoryMinimum(cat, "advanced", Number(e.target.value))}
                    className="w-20 border border-slate-300 rounded px-2 py-1 disabled:bg-slate-50"
                  />
                </td>
                <td className="py-1.5">
                  <input
                    type="number"
                    step="0.05"
                    disabled={!editable}
                    value={version.classification_parameters.categoryMinimums[cat]?.premium ?? 0}
                    onChange={(e) => updateCategoryMinimum(cat, "premium", Number(e.target.value))}
                    className="w-20 border border-slate-300 rounded px-2 py-1 disabled:bg-slate-50"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Tier Thresholds, Retention Buffer & Gate Caps">
        <div className="grid md:grid-cols-3 gap-4 text-sm mb-4">
          <Field label="Advanced — minimum total score">
            <input
              type="number"
              disabled={!editable}
              value={version.classification_parameters.advancedMinTotal}
              onChange={(e) => updateParams({ advancedMinTotal: Number(e.target.value) })}
              className="w-full border border-slate-300 rounded px-2 py-1 disabled:bg-slate-50"
            />
          </Field>
          <Field label="Premium — minimum total score">
            <input
              type="number"
              disabled={!editable}
              value={version.classification_parameters.premiumMinTotal}
              onChange={(e) => updateParams({ premiumMinTotal: Number(e.target.value) })}
              className="w-full border border-slate-300 rounded px-2 py-1 disabled:bg-slate-50"
            />
          </Field>
          <Field label="Retention buffer (points)">
            <input
              type="number"
              disabled={!editable}
              value={version.classification_parameters.retentionBufferPoints}
              onChange={(e) => updateParams({ retentionBufferPoints: Number(e.target.value) })}
              className="w-full border border-slate-300 rounded px-2 py-1 disabled:bg-slate-50"
            />
          </Field>
        </div>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <Field label="Tier cap if G1 (critical violation/fatality)">
            <TierSelect disabled={!editable} value={version.classification_parameters.gateCapG1} onChange={(v) => updateParams({ gateCapG1: v })} />
          </Field>
          <Field label="Tier cap if G2 (suspension in last 12mo)">
            <TierSelect disabled={!editable} value={version.classification_parameters.gateCapG2} onChange={(v) => updateParams({ gateCapG2: v })} />
          </Field>
          <Field label="Tier cap if G3 hazardous module FAIL">
            <TierSelect disabled={!editable} value={version.classification_parameters.gateCapG3} onChange={(v) => updateParams({ gateCapG3: v })} />
          </Field>
        </div>
      </Section>

      <Section title="Lifecycle Rules">
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
                Simulate against sample ESPs
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
            <h3 className="text-sm font-semibold mb-2">Simulation results (ESPs with a submitted application)</h3>
            <table className="w-full text-xs">
              <thead className="text-slate-500 uppercase">
                <tr>
                  <th className="text-left py-1">ESP</th>
                  <th className="text-left py-1">Sector</th>
                  <th className="text-left py-1">Published total / tier</th>
                  <th className="text-left py-1">Candidate total / tier</th>
                  <th className="text-left py-1">Change</th>
                </tr>
              </thead>
              <tbody>
                {sim.map((r) => (
                  <tr key={r.esp_id} className={`border-t border-slate-100 ${r.tier_changed ? "bg-amber-50" : ""}`}>
                    <td className="py-1">{r.esp_name}</td>
                    <td className="py-1">{r.sector}</td>
                    <td className="py-1">{r.published ? `${r.published.total} / ${r.published.tier}` : "—"}</td>
                    <td className="py-1">
                      {r.candidate.total} / {r.candidate.tier}
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

function ThresholdInput({ value, onChange, disabled }: { value: number | null; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <input
      type="number"
      step="any"
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? (null as unknown as number) : Number(e.target.value))}
      className="w-12 border border-slate-300 rounded px-1 py-0.5 disabled:bg-slate-50"
    />
  );
}

function TierSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 disabled:bg-slate-50">
      {["Basic", "Advanced", "Premium"].map((t) => (
        <option key={t}>{t}</option>
      ))}
    </select>
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
