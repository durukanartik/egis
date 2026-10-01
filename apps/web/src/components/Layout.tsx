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

function Logomark() {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-green-600 text-white font-bold text-sm shrink-0">
      EAD
    </span>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const links = user ? LINKS[user.role] ?? [] : [];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-brand-blue-800 text-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Logomark />
            <div className="min-w-0">
              <div className="font-bold tracking-tight text-base leading-tight">EAD ESP Platform</div>
              <div className="text-xs text-blue-200/80 leading-tight truncate">Prequalification, Licensing &amp; Classification — MVP</div>
            </div>
          </div>
          {user && (
            <div className="flex items-center gap-3 text-sm shrink-0">
              <div className="text-right hidden sm:block">
                <div className="text-blue-50">{user.display_name}</div>
                <div className="text-[10px] uppercase tracking-wide text-blue-300">{user.role}</div>
              </div>
              <button
                onClick={logout}
                className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 border border-white/10 transition text-xs font-medium"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
        {user && (
          <nav className="max-w-7xl mx-auto px-4 flex gap-1 border-t border-white/10 overflow-x-auto">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `px-3 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                    isActive ? "border-brand-green-600 text-white" : "border-transparent text-blue-200/70 hover:text-white hover:border-white/30"
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
      <footer className="text-center text-xs text-brand-grey-500 py-4 border-t border-brand-grey-100 bg-white">
        EAD Prequalification, Licensing &amp; Classification Platform — MVP demonstrator, built on sample data. Not connected to live TAMM, Bolisaty or IWMS systems.
      </footer>
    </div>
  );
}
