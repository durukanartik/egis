import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

const DEMO_ACCOUNTS = [
  { username: "reviewer1", role: "Reviewer", note: "Review queue, scoring, decisions" },
  { username: "admin1", role: "Admin (editor)", note: "Drafts configuration changes" },
  { username: "admin2", role: "Admin (approver)", note: "Approves & publishes configuration" },
  { username: "auditor1", role: "Auditor", note: "Read-only audit trail & dashboards" },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("reviewer1");
  const [password, setPassword] = useState("Password123!");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="p-8">
          <h1 className="text-xl font-bold text-slate-900">EAD ESP Platform</h1>
          <p className="text-sm text-slate-500 mt-1 mb-6">
            Prequalification, Licensing &amp; Classification — Internal Staff Portal (MVP)
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
              <input
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white rounded py-2 text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-50"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="text-xs text-slate-400 mt-6">
            EAD staff only — ESP identity is delegated entirely to TAMM / UAE Pass (Section 6, 11).
          </p>
        </div>
        <div className="bg-slate-50 p-8 border-l border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Demo accounts (password: Password123!)</h2>
          <ul className="space-y-3">
            {DEMO_ACCOUNTS.map((a) => (
              <li
                key={a.username}
                className="text-sm bg-white border border-slate-200 rounded p-3 cursor-pointer hover:border-sky-400 transition"
                onClick={() => setUsername(a.username)}
              >
                <div className="font-mono font-semibold text-slate-800">{a.username}</div>
                <div className="text-slate-500">
                  {a.role} — {a.note}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
