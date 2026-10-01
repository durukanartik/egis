import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const LINKS: Record<string, { to: string; label: string }[]> = {
  reviewer: [
    { to: "/reviewer/queue", label: "Review Queue" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/audit", label: "Audit Log" },
  ],
  admin: [
    { to: "/admin/config", label: "Config Versions" },
    { to: "/admin/integration", label: "TAMM Simulator" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/audit", label: "Audit Log" },
  ],
  auditor: [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/audit", label: "Audit Log" },
  ],
};

export default function Layout() {
  const { user, logout } = useAuth();
  const links = user ? LINKS[user.role] ?? [] : [];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="font-bold tracking-tight text-lg">EAD ESP Platform</span>
            <span className="text-xs text-slate-400">Prequalification, Licensing &amp; Classification — MVP</span>
          </div>
          {user && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-slate-300">
                {user.display_name} <span className="uppercase text-xs text-slate-500">({user.role})</span>
              </span>
              <button onClick={logout} className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 transition">
                Sign out
              </button>
            </div>
          )}
        </div>
        {user && (
          <nav className="max-w-7xl mx-auto px-4 flex gap-1 border-t border-slate-800">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `px-3 py-2 text-sm font-medium border-b-2 transition ${
                    isActive ? "border-sky-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
      <footer className="text-center text-xs text-slate-400 py-4">
        EAD Prequalification, Licensing &amp; Classification Platform — MVP demonstrator, built on sample data. Not connected to live TAMM, Bolisaty or IWMS systems.
      </footer>
    </div>
  );
}
