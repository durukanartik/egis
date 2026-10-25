import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { StatusBadge } from "../../components/Badges";
import { useAuth } from "../../auth/AuthContext";

type Version = {
  id: string;
  version_number: number;
  status: string;
  created_by: string;
  created_at: string;
  submitted_by: string | null;
  approved_by: string | null;
  published_at: string | null;
  notes: string | null;
};

export default function ConfigVersions() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  function load() {
    api<{ versions: Version[] }>("/config/versions").then((r) => setVersions(r.versions));
  }

  useEffect(load, []);

  async function createDraft() {
    const published = versions.find((v) => v.status === "published");
    if (!published) return;
    setCreating(true);
    try {
      const full = await api<{ version: any }>(`/config/versions/${published.id}`);
      const res = await api<{ id: string }>("/config/versions", {
        method: "POST",
        body: JSON.stringify({
          criteria: full.version.criteria,
          hazardous_module: full.version.hazardous_module,
          classification_parameters: full.version.classification_parameters,
          lifecycle_rules: full.version.lifecycle_rules,
          notes: `Draft branched from v${published.version_number} by ${user?.username}`,
        }),
      });
      navigate(`/admin/config/${res.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Configuration Versions</h1>
          <p className="text-sm text-slate-500">
            Draft → Simulate → Submit for approval → Approve (separate approver) → Publish (Section 8.3).
          </p>
        </div>
        <button onClick={createDraft} disabled={creating} className="px-3 py-1.5 bg-brand-blue-600 text-white text-sm rounded hover:bg-brand-blue-700 disabled:opacity-50">
          {creating ? "Creating…" : "New draft from published"}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Version</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Created by</th>
              <th className="text-left px-4 py-2">Submitted by</th>
              <th className="text-left px-4 py-2">Approved by</th>
              <th className="text-left px-4 py-2">Published</th>
              <th className="text-left px-4 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link to={`/admin/config/${v.id}`} className="font-medium text-brand-blue-600 hover:underline">
                    v{v.version_number}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={v.status} />
                </td>
                <td className="px-4 py-2 text-slate-600">{v.created_by}</td>
                <td className="px-4 py-2 text-slate-600">{v.submitted_by ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600">{v.approved_by ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600">{v.published_at ? new Date(v.published_at).toLocaleString() : "—"}</td>
                <td className="px-4 py-2 text-slate-500 max-w-xs truncate">{v.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
