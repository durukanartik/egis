import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";

type AppRow = {
  id: string;
  legal_name: string;
  sector: string;
  status: string;
  current_tier: string | null;
  submitted_at: string;
  tamm_reference: string;
};

export default function DeptHeadQueue() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ applications: AppRow[] }>(`/applications?status=awaiting_dept_head`)
      .then((r) => setApps(r.applications))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-xl font-bold text-slate-900 mb-1">Dept Head Approval Queue</h1>
      <p className="text-sm text-slate-500 mb-4">
        A Premium or Below Basic outcome, or any change from an ESP's previously published tier, is held here before it takes
        effect (Section 8.2, approval policy). Open an application below to review the score breakdown and approve or reject.
      </p>

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">ESP</th>
              <th className="text-left px-4 py-2">Sector</th>
              <th className="text-left px-4 py-2">Previous tier</th>
              <th className="text-left px-4 py-2">TAMM Reference</th>
              <th className="text-left px-4 py-2">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && apps.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Nothing is waiting on Dept Head approval right now.
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
                <td className="px-4 py-2 text-slate-600">{a.current_tier ?? "—"}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{a.tamm_reference}</td>
                <td className="px-4 py-2 text-slate-500">{new Date(a.submitted_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
