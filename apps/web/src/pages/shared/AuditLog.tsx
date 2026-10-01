import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";

type Entry = {
  id: string;
  actor_username: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
};

export default function AuditLog() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entityType, setEntityType] = useState("");

  useEffect(() => {
    api<{ entries: Entry[] }>(`/audit?limit=300${entityType ? `&entity_type=${entityType}` : ""}`).then((r) => setEntries(r.entries));
  }, [entityType]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Immutable Audit Log</h1>
          <p className="text-sm text-slate-500">
            Append-only record of every state change, score, decision and configuration update (Section 3, 13).
            {user?.role === "reviewer" && " Your access is limited to your own actions (RBAC Matrix, Section 13.2)."}
          </p>
        </div>
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 text-sm">
          <option value="">All entities</option>
          <option value="application">Application</option>
          <option value="score_run">Score run</option>
          <option value="document">Document</option>
          <option value="esp">ESP</option>
          <option value="config_version">Config version</option>
          <option value="decision">Decision</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase">
            <tr>
              <th className="text-left px-4 py-2">Time</th>
              <th className="text-left px-4 py-2">Actor</th>
              <th className="text-left px-4 py-2">Action</th>
              <th className="text-left px-4 py-2">Entity</th>
              <th className="text-left px-4 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                <td className="px-4 py-2">
                  {e.actor_username} <span className="text-slate-400">({e.actor_role})</span>
                </td>
                <td className="px-4 py-2 font-mono text-brand-blue-600">{e.action}</td>
                <td className="px-4 py-2 text-slate-600">
                  {e.entity_type}
                  {e.entity_id && <span className="text-slate-400"> #{e.entity_id.slice(0, 8)}</span>}
                </td>
                <td className="px-4 py-2 text-slate-500 max-w-md truncate" title={JSON.stringify({ before: e.before, after: e.after })}>
                  {e.after ? JSON.stringify(e.after) : ""}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  No audit entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
