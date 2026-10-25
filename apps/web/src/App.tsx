import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/shared/Dashboard";
import AuditLog from "./pages/shared/AuditLog";
import Queue from "./pages/reviewer/Queue";
import ApplicationDetail from "./pages/reviewer/ApplicationDetail";
import ConfigVersions from "./pages/admin/ConfigVersions";
import ConfigEditor from "./pages/admin/ConfigEditor";
import IntegrationSimulator from "./pages/admin/IntegrationSimulator";
import PqQueue from "./pages/pq/Queue";
import PqDetail from "./pages/pq/PqDetail";
import DeptHeadQueue from "./pages/depthead/Queue";
import LicensingConsole from "./pages/licensing/Console";
import PublicRegister from "./pages/public/Register";
import type { Role } from "./api/client";

function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "reviewer") return <Navigate to="/reviewer/queue" replace />;
  if (user.role === "dept_head") return <Navigate to="/dept-head/queue" replace />;
  if (user.role === "licensing") return <Navigate to="/licensing" replace />;
  if (user.role === "admin") return <Navigate to="/admin/config" replace />;
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/login" replace />} />
        <Route path="/audit" element={user ? <AuditLog /> : <Navigate to="/login" replace />} />
        <Route
          path="/reviewer/queue"
          element={
            <RequireRole roles={["reviewer"]}>
              <Queue />
            </RequireRole>
          }
        />
        <Route
          path="/reviewer/applications/:id"
          element={
            <RequireRole roles={["reviewer", "dept_head", "admin"]}>
              <ApplicationDetail />
            </RequireRole>
          }
        />
        <Route
          path="/pq"
          element={
            <RequireRole roles={["reviewer", "licensing", "admin"]}>
              <PqQueue />
            </RequireRole>
          }
        />
        <Route
          path="/pq/:id"
          element={
            <RequireRole roles={["reviewer", "licensing", "admin"]}>
              <PqDetail />
            </RequireRole>
          }
        />
        <Route
          path="/dept-head/queue"
          element={
            <RequireRole roles={["dept_head", "admin"]}>
              <DeptHeadQueue />
            </RequireRole>
          }
        />
        <Route
          path="/licensing"
          element={
            <RequireRole roles={["licensing", "admin"]}>
              <LicensingConsole />
            </RequireRole>
          }
        />
        <Route path="/register" element={<PublicRegister />} />
        <Route
          path="/admin/config"
          element={
            <RequireRole roles={["admin"]}>
              <ConfigVersions />
            </RequireRole>
          }
        />
        <Route
          path="/admin/config/:id"
          element={
            <RequireRole roles={["admin"]}>
              <ConfigEditor />
            </RequireRole>
          }
        />
        <Route
          path="/admin/integration"
          element={
            <RequireRole roles={["admin"]}>
              <IntegrationSimulator />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
