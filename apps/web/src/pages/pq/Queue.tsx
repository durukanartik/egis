import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { StatusBadge } from "../../components/Badges";

type PqRow = {
  id: string;
  legal_name: string;
  sector: string;
  commercial_licence_number: string;
  licence_status: string;
  status: string;
  pq_activity_category: string;
  pq_reason: string;
  pq_overall_result: string | null;
  submitted_at: string;
  tamm_reference: string;
};

const STATUS_FILTERS = ["", "submitted", "under_review", "decided"];

export default function PqQueue() {
  const [rows, setRows] = useState<PqRow[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<{ pq_assessments: PqRow[] }>(`/pq${status ? `?status=${status}` : ""}`)
      .then((r) => setRows(r.pq_assessments))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-slate-900">Prequalification Queue</h1>
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
        Assessed per ESP per activity category, at entity pre-registration, before any Authorisation (WML / Environmental
        Permit) is issued — independent of classification (Section 9.1). Pushed from TAMM's Technical Modification
        sub-service (Appendix 21.2).
      </p>

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">ESP</th>
              <th className="text-left px-4 py-2">Sector</th>
              <th className="text-left px-4 py-2">Activity category</th>
              <th className="text-left px-4 py-2">Reason</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">PQ result</th>
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
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No PQ assessments in this filter.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link to={`/pq/${r.id}`} className="font-medium text-brand-blue-600 hover:underline">
                    {r.legal_name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-600">{r.sector}</td>
                <td className="px-4 py-2 text-slate-600">{r.pq_activity_category.replace(/_/g, " ")}</td>
                <td className="px-4 py-2 text-slate-500 text-xs">{r.pq_reason.replace(/_/g, " ")}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-2">{r.pq_overall_result ? <StatusBadge status={r.pq_overall_result} /> : <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-2 text-slate-500">{new Date(r.submitted_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
