import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { StatusBadge, TierBadge } from "../../components/Badges";

type AppRow = {
  id: string;
  legal_name: string;
  sector: string;
  status: string;
  licence_status: string;
  current_tier: string | null;
  submitted_at: string;
  tamm_reference: string;
};

const STATUS_FILTERS = ["", "submitted", "under_review", "eligibility_failed", "scoring", "decided"];

export default function Queue() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<{ applications: AppRow[] }>(`/applications${status ? `?status=${status}` : ""}`)
      .then((r) => setApps(r.applications))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-slate-900">Review Queue</h1>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s || "all"}
              onClick={() => setStatus(s)}
              className={`px-3 py-1 rounded text-xs font-medium border ${
                status === s ? "bg-brand-blue-600 text-white border-brand-blue-600" : "bg-white text-slate-600 border-slate-300"
              }`}
            >
              {s ? s.replace(/_/g, " ") : "All"}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-slate-500 mb-4">
        Applications pushed from TAMM's Technical Modification sub-service (Section 2.2, Stage 1). There is no direct
        ESP-facing interface in this platform — every application here arrived via TAMM's existing push API.
      </p>

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">ESP</th>
              <th className="text-left px-4 py-2">Sector</th>
              <th className="text-left px-4 py-2">TAMM Reference</th>
              <th className="text-left px-4 py-2">Licence</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Current Tier</th>
              <th className="text-left px-4 py-2">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && apps.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No applications in this filter.
                </td>
              </tr>
            )}
            {apps.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link to={`/reviewer/applications/${a.id}`} className="font-medium text-brand-blue-600 hover:underline">
                    {a.legal_name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-600">{a.sector}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{a.tamm_reference}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={a.licence_status} />
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={a.status} />
                </td>
                <td className="px-4 py-2">
                  <TierBadge tier={a.current_tier} />
                </td>
                <td className="px-4 py-2 text-slate-500">{new Date(a.submitted_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
