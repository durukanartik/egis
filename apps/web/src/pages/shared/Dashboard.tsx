import { useEffect, useState } from "react";
import { api } from "../../api/client";

type DashboardData = {
  totals: { total_esps: number; total_applications: number };
  by_status: { status: string; count: number }[];
  by_tier: { tier: string; count: number }[];
  by_sector: { sector: string; count: number }[];
  by_licence_status: { licence_status: string; count: number }[];
  score_runs_completed: number;
  decisions_recorded: number;
  pending_config_approvals: { c: number };
};

const BAR_COLOR = "#0ea5e9";

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api<DashboardData>("/reporting/dashboard").then(setData);
  }, []);

  if (!data) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Operational Dashboard</h1>

      <div className="grid sm:grid-cols-4 gap-4">
        <StatTile label="Total ESPs" value={data.totals.total_esps} />
        <StatTile label="Total Applications" value={data.totals.total_applications} />
        <StatTile label="Score Runs Completed" value={data.score_runs_completed} hint="Target ≤ 60s end-to-end per run (Section 14)" />
        <StatTile label="Decisions Recorded" value={data.decisions_recorded} />
        <StatTile label="Pending Config Approvals" value={data.pending_config_approvals.c} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <ChartCard title="Applications by status" rows={data.by_status.map((r) => ({ label: r.status.replace(/_/g, " "), value: r.count }))} />
        <ChartCard title="ESPs by current tier" rows={data.by_tier.map((r) => ({ label: `Tier ${r.tier}`, value: r.count }))} />
        <ChartCard title="ESPs by sector" rows={data.by_sector.map((r) => ({ label: r.sector, value: r.count }))} />
        <ChartCard
          title="ESPs by licence status"
          rows={data.by_licence_status.map((r) => ({ label: r.licence_status, value: r.count }))}
        />
      </div>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

function ChartCard({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">{title}</h2>
      {rows.length === 0 && <p className="text-xs text-slate-400">No data yet.</p>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 text-xs">
            <div className="w-32 text-slate-600 truncate capitalize">{r.label}</div>
            <div className="flex-1 bg-slate-100 rounded h-3 overflow-hidden">
              <div className="h-3 rounded" style={{ width: `${(r.value / max) * 100}%`, backgroundColor: BAR_COLOR }} />
            </div>
            <div className="w-6 text-right text-slate-700 font-medium">{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
