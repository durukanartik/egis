import { useEffect, useState } from "react";
import { StatusBadge, TierBadge } from "../../components/Badges";

type RegisterRow = {
  legal_name: string;
  activity_category: string;
  licence_number: string;
  tier: string | null;
  valid_until: string | null;
  status: string;
};

export default function PublicRegister() {
  const [rows, setRows] = useState<RegisterRow[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/public/register")
      .then((r) => r.json())
      .then((d) => setRows(d.register));
  }, []);

  const filtered = (rows ?? []).filter((r) => r.legal_name.toLowerCase().includes(q.toLowerCase()) || r.licence_number.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Public ESP Register</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Anonymous register, per ESP: name, licence number, activity category, tier and status (Section 11.2). No category
          or criterion scores are published. No sign-in is required to view this page.
        </p>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or licence number…"
        className="w-full max-w-md border border-slate-300 rounded px-3 py-2 text-sm"
      />

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Legal name</th>
              <th className="text-left px-4 py-2">Licence number</th>
              <th className="text-left px-4 py-2">Activity category</th>
              <th className="text-left px-4 py-2">Tier</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Valid until</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {rows !== null && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No matching ESPs.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.licence_number} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{r.legal_name}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{r.licence_number}</td>
                <td className="px-4 py-2 text-slate-600">{r.activity_category}</td>
                <td className="px-4 py-2">
                  <TierBadge tier={r.tier} />
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-2 text-slate-500">{r.valid_until ? new Date(r.valid_until).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
