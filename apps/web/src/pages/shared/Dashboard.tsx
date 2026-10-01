import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, LabelList } from "recharts";
import { api } from "../../api/client";
import { CATEGORICAL, LICENCE_STATUS_COLOR, TIER_ORDINAL, CHART_INK } from "../../lib/chartColors";

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

const STATUS_ORDER = ["submitted", "under_review", "eligibility_failed", "scoring", "decided", "voided"];
const TIER_ORDER = ["Basic", "Advanced", "Premium"];
const SECTOR_ORDER = ["Transportation", "Trading", "Treatment"];
const LICENCE_ORDER = ["active", "expired", "suspended", "revoked"];

function orderAndFill<T extends { count: number }>(rows: T[], order: string[], key: keyof T): T[] {
  const map = new Map(rows.map((r) => [r[key] as unknown as string, r]));
  return order.filter((k) => map.has(k)).map((k) => map.get(k)!);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api<DashboardData>("/reporting/dashboard").then(setData);
  }, []);

  if (!data) return <div className="text-brand-grey-500">Loading…</div>;

  const statusRows = orderAndFill(data.by_status, STATUS_ORDER, "status").map((r, i) => ({
    label: capitalize(r.status.replace(/_/g, " ")),
    value: r.count,
    color: CATEGORICAL[i % CATEGORICAL.length],
  }));
  const tierRows = orderAndFill(data.by_tier, TIER_ORDER, "tier").map((r) => ({
    label: r.tier,
    value: r.count,
    color: TIER_ORDINAL[r.tier] ?? CATEGORICAL[0],
  }));
  const sectorRows = orderAndFill(data.by_sector, SECTOR_ORDER, "sector").map((r, i) => ({
    label: r.sector,
    value: r.count,
    color: CATEGORICAL[i % CATEGORICAL.length],
  }));
  const licenceRows = orderAndFill(data.by_licence_status, LICENCE_ORDER, "licence_status").map((r) => ({
    label: capitalize(r.licence_status),
    value: r.count,
    color: LICENCE_STATUS_COLOR[r.licence_status] ?? CATEGORICAL[0],
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Operational Dashboard</h1>
        <p className="text-sm text-brand-grey-600 mt-0.5">Live counts across the platform. Hover any bar for the exact figure.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Total ESPs" value={data.totals.total_esps} accent="blue" />
        <StatTile label="Total Applications" value={data.totals.total_applications} accent="green" />
        <StatTile label="Score Runs Completed" value={data.score_runs_completed} hint="Target ≤ 60s end-to-end per run" accent="grey" />
        <StatTile label="Decisions Recorded" value={data.decisions_recorded} accent="grey" />
      </div>

      {data.pending_config_approvals.c > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 text-amber-800 text-sm rounded-xl px-4 py-3">
          <span className="font-semibold">{data.pending_config_approvals.c}</span> configuration version
          {data.pending_config_approvals.c === 1 ? "" : "s"} pending approval.
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="Applications by status" subtitle="Where every submission currently sits in the review pipeline." rows={statusRows} />
        <ChartCard title="ESPs by current tier" subtitle="Published classification outcomes, Basic → Premium." rows={tierRows} />
        <ChartCard title="ESPs by sector" subtitle="Registered Environmental Service Providers per matrix." rows={sectorRows} />
        <ChartCard title="ESPs by licence status" subtitle="Underlying Waste Management Licence status (gate G0)." rows={licenceRows} />
      </div>
    </div>
  );
}

const ACCENT_CLASSES: Record<string, string> = {
  blue: "border-l-brand-blue-600",
  green: "border-l-brand-green-600",
  grey: "border-l-brand-grey-500",
};

function StatTile({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent: "blue" | "green" | "grey" }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-brand-grey-100 border-l-4 ${ACCENT_CLASSES[accent]} p-4`}>
      <div className="text-xs text-brand-grey-600 uppercase tracking-wide font-medium">{label}</div>
      <div className="text-3xl font-bold text-slate-900 mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-brand-grey-500 mt-1">{hint}</div>}
    </div>
  );
}

type Row = { label: string; value: number; color: string };

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="bg-white rounded-lg shadow-lg border border-brand-grey-100 px-3 py-2 text-xs">
      <div className="font-semibold text-slate-800 capitalize">{row.label}</div>
      <div className="text-brand-grey-600">
        count: <span className="font-semibold text-slate-800">{row.value}</span>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, rows }: { title: string; subtitle?: string; rows: Row[] }) {
  const height = Math.max(120, rows.length * 44 + 20);
  return (
    <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 p-5">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {subtitle && <p className="text-xs text-brand-grey-500 mt-0.5 mb-2">{subtitle}</p>}
      {rows.length === 0 && <p className="text-xs text-brand-grey-400 py-6">No data yet.</p>}
      {rows.length > 0 && (
        <div style={{ width: "100%", height }}>
          <ResponsiveContainer>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 4 }} barCategoryGap="28%">
              <CartesianGrid horizontal={false} stroke={CHART_INK.grid} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: CHART_INK.mutedText }} axisLine={{ stroke: CHART_INK.grid }} tickLine={false} />
              <YAxis
                type="category"
                dataKey="label"
                width={110}
                tick={{ fontSize: 12, fill: CHART_INK.secondaryText }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip cursor={{ fill: "rgba(0,0,0,0.03)" }} content={<ChartTooltip />} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22} animationDuration={500}>
                {rows.map((r) => (
                  <Cell key={r.label} fill={r.color} />
                ))}
                <LabelList dataKey="value" position="right" style={{ fill: CHART_INK.secondaryText, fontSize: 12, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
