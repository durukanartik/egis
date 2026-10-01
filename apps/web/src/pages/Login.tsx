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
    <div className="min-h-screen flex items-center justify-center bg-brand-grey-50 px-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-0 bg-white rounded-2xl shadow-xl overflow-hidden border border-brand-grey-100">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-600 text-white font-bold text-sm">EAD</span>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">EAD ESP Platform</h1>
              <p className="text-xs text-brand-grey-600 leading-tight">Prequalification, Licensing &amp; Classification</p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
              <input
                className="w-full border border-brand-grey-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-600 focus:border-transparent"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                className="w-full border border-brand-grey-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-600 focus:border-transparent"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary rounded-lg py-2.5 text-sm font-semibold shadow-sm"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="text-xs text-brand-grey-500 mt-6">
            EAD staff only — ESP identity is delegated entirely to TAMM / UAE Pass.
          </p>
        </div>
        <div className="bg-brand-blue-50/40 p-8 border-l border-brand-grey-100">
          <h2 className="text-sm font-semibold text-brand-blue-800 mb-3">Demo accounts (password: Password123!)</h2>
          <ul className="space-y-2.5">
            {DEMO_ACCOUNTS.map((a) => (
              <li
                key={a.username}
                className={`text-sm bg-white border rounded-lg p-3 cursor-pointer transition ${
                  username === a.username ? "border-brand-blue-600 ring-1 ring-brand-blue-600" : "border-brand-grey-100 hover:border-brand-blue-600/50"
                }`}
                onClick={() => setUsername(a.username)}
              >
                <div className="font-mono font-semibold text-slate-800">{a.username}</div>
                <div className="text-brand-grey-600">
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
