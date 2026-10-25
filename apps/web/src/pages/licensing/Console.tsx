import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "../../api/client";

type PqRow = {
  id: string;
  esp_id: string;
  legal_name: string;
  sector: string;
  licence_status: string;
  pq_overall_result: string | null;
};

type EspRow = {
  id: string;
  legal_name: string;
  sector: string;
  licence_status: string;
  waste_licence_number: string | null;
};

type Block = { id: string; reason: string; source: string; effective_date: string; lift_date: string | null };

export default function LicensingConsole() {
  const [ready, setReady] = useState<PqRow[]>([]);
  const [esps, setEsps] = useState<EspRow[]>([]);
  const [selectedEspId, setSelectedEspId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newBlockReason, setNewBlockReason] = useState("");

  const loadReady = useCallback(() => {
    api<{ pq_assessments: PqRow[] }>(`/pq?status=decided`).then((r) => setReady(r.pq_assessments.filter((p) => p.pq_overall_result === "Eligible" && p.licence_status === "pending")));
  }, []);

  const loadEsps = useCallback(() => {
    api<{ esps: EspRow[] }>(`/esps`).then((r) => setEsps(r.esps));
  }, []);

  useEffect(() => {
    loadReady();
    loadEsps();
  }, [loadReady, loadEsps]);

  const loadBlocks = useCallback((espId: string) => {
    api<{ blocks: Block[] }>(`/esps/${espId}/blocks`).then((r) => setBlocks(r.blocks));
  }, []);

  useEffect(() => {
    if (selectedEspId) loadBlocks(selectedEspId);
  }, [selectedEspId, loadBlocks]);

  async function issue(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/pq/${id}/issue-authorisation`, { method: "POST" });
      loadReady();
      loadEsps();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Issuance failed");
    } finally {
      setBusy(null);
    }
  }

  async function raiseBlock() {
    if (!selectedEspId || newBlockReason.trim().length < 5) return;
    setBusy("block");
    setError(null);
    try {
      await api(`/esps/${selectedEspId}/blocks`, { method: "POST", body: JSON.stringify({ reason: newBlockReason }) });
      setNewBlockReason("");
      loadBlocks(selectedEspId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to raise block");
    } finally {
      setBusy(null);
    }
  }

  async function liftBlock(blockId: string) {
    if (!selectedEspId) return;
    setBusy(blockId);
    try {
      await api(`/esps/${selectedEspId}/blocks/${blockId}/lift`, { method: "POST" });
      loadBlocks(selectedEspId);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Licensing Console</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Issue the Authorisation (WML or Environmental Permit) once PQ is decided Eligible and no active block exists
          (Section 7.1) — classification starts once the Authorisation is issued (Section 8.1), and manage blocks.
        </p>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded px-4 py-2">{error}</div>}

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 p-5">
        <h2 className="font-semibold text-slate-900 mb-1">Ready to issue</h2>
        <p className="text-xs text-slate-500 mb-3">PQ decided Eligible, no Authorisation issued yet.</p>
        {ready.length === 0 && <p className="text-sm text-slate-400">Nothing is ready for issuance right now.</p>}
        <div className="space-y-2">
          {ready.map((r) => (
            <div key={r.id} className="flex items-center justify-between border border-slate-100 rounded px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-slate-800">{r.legal_name}</span>
                <span className="text-slate-400 ml-2">{r.sector}</span>
              </div>
              <button
                onClick={() => issue(r.id)}
                disabled={busy === r.id}
                className="px-3 py-1.5 bg-brand-blue-600 text-white text-xs rounded hover:bg-brand-blue-700 disabled:opacity-50 transition"
              >
                {busy === r.id ? "Issuing…" : "Issue Authorisation"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-brand-grey-100 p-5">
        <h2 className="font-semibold text-slate-900 mb-1">Manage blocks</h2>
        <p className="text-xs text-slate-500 mb-3">
          A block (rule-raised or manual) prevents a new Authorisation from being issued while active (Section 7.1).
        </p>
        <select
          value={selectedEspId ?? ""}
          onChange={(e) => setSelectedEspId(e.target.value || null)}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm mb-3 w-full max-w-md"
        >
          <option value="">Select an ESP…</option>
          {esps.map((e) => (
            <option key={e.id} value={e.id}>
              {e.legal_name} ({e.sector}) — {e.licence_status}
            </option>
          ))}
        </select>

        {selectedEspId && (
          <div className="space-y-3">
            <div className="space-y-2">
              {blocks.length === 0 && <p className="text-sm text-slate-400">No blocks recorded for this ESP.</p>}
              {blocks.map((b) => (
                <div key={b.id} className="flex items-center justify-between border border-slate-100 rounded px-3 py-2 text-sm">
                  <div>
                    <div className="text-slate-700">{b.reason}</div>
                    <div className="text-xs text-slate-400">
                      {b.source} · raised {new Date(b.effective_date).toLocaleDateString()}
                      {b.lift_date && ` · lifted ${new Date(b.lift_date).toLocaleDateString()}`}
                    </div>
                  </div>
                  {!b.lift_date ? (
                    <button
                      onClick={() => liftBlock(b.id)}
                      disabled={busy === b.id}
                      className="text-xs text-brand-blue-600 hover:underline disabled:opacity-50"
                    >
                      Lift
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">Lifted</span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newBlockReason}
                onChange={(e) => setNewBlockReason(e.target.value)}
                placeholder="Reason for a new manual block…"
                className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
              <button
                onClick={raiseBlock}
                disabled={busy === "block" || newBlockReason.trim().length < 5}
                className="px-3 py-1.5 bg-rose-600 text-white text-sm rounded hover:bg-rose-700 disabled:opacity-50 transition"
              >
                Raise block
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
