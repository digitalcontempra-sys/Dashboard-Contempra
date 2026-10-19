import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { FullScreenSpinner, homeFor, RequireLevel, useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { AdminUsers } from "./pages/AdminUsers";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { MyCards } from "./pages/MyCards";
import { NeedsReview } from "./pages/NeedsReview";
import { NonBilled } from "./pages/NonBilled";
import { Providers } from "./providers";

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenSpinner />;
  return <Navigate to={user ? homeFor(user) : "/login"} replace />;
}

const MANAGERS = ["admin", "manager"] as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Home />} />
      <Route
        element={
          <RequireLevel>
            <Layout />
          </RequireLevel>
        }
      >
        <Route path="/my-cards" element={<MyCards />} />
        <Route
          path="/dashboard"
          element={
            <RequireLevel levels={[...MANAGERS]}>
              <Dashboard />
            </RequireLevel>
          }
        />
        <Route
          path="/non-billed"
          element={
            <RequireLevel levels={[...MANAGERS]}>
              <NonBilled />
            </RequireLevel>
          }
        />
        <Route
          path="/needs-review"
          element={
            <RequireLevel levels={[...MANAGERS]}>
              <NeedsReview />
            </RequireLevel>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireLevel levels={["admin"]}>
              <AdminUsers />
            </RequireLevel>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Providers>
        <AppRoutes />
      </Providers>
    </BrowserRouter>
  );
}
