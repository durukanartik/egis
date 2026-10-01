import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/client";

type Esp = { id: string; legal_name: string; sector: string; licence_status: string };

export default function IntegrationSimulator() {
  const [esps, setEsps] = useState<Esp[]>([]);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ esps: Esp[] }>("/esps").then((r) => {
      setEsps(r.esps);
      if (r.esps[0]) setSelected(r.esps[0].id);
    });
  }, []);

  async function simulate() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api<{ application_id: string; tamm_reference: string }>("/integration/tamm/applications", {
        method: "POST",
        body: JSON.stringify({ esp_id: selected }),
      });
      setResult(`New application ${res.application_id} created (TAMM reference ${res.tamm_reference}). It now appears in the reviewer queue.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Simulation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Integration Gateway — TAMM Push Simulator</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          In production, ESP applications arrive exclusively through TAMM's Technical Modification sub-service push API
          (Section 2.2, Stage 1; Section 21.2) — there is no ESP-facing portal in this architecture (Section 2.5, C3).
          This panel simulates that inbound TAMM webhook for demonstration purposes only.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 p-5 max-w-xl">
        <label className="block text-sm font-medium text-slate-700 mb-1">Environmental Service Provider</label>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-4">
          {esps.map((e) => (
            <option key={e.id} value={e.id}>
              {e.legal_name} ({e.sector}, licence {e.licence_status})
            </option>
          ))}
        </select>
        <button onClick={simulate} disabled={busy || !selected} className="px-4 py-2 bg-brand-blue-600 text-white text-sm rounded hover:bg-brand-blue-700 disabled:opacity-50">
          {busy ? "Submitting…" : "Simulate TAMM submission"}
        </button>
        {result && <p className="text-sm text-emerald-700 mt-3">{result}</p>}
        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
      </div>
    </div>
  );
}
