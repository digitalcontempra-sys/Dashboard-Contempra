import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { AccessLevel, SessionUser } from "../shared/types";
import { api, ApiError } from "./api";

type AuthValue = {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);
const ME = ["auth", "me"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ME,
    queryFn: async () => {
      try {
        return await api<SessionUser>("/api/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const login = useCallback(
    async (username: string, password: string) => {
      const user = await api<SessionUser>("/api/auth/login", { method: "POST", json: { username, password } });
      qc.setQueryData(ME, user);
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    qc.clear();
    qc.setQueryData(ME, null);
  }, [qc]);

  return (
    <AuthContext.Provider value={{ user: me.data ?? null, loading: me.isPending, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

export const homeFor = (u: SessionUser) => (u.accessLevel === "staff" ? "/my-cards" : "/dashboard");

export function RequireLevel({ levels, children }: { levels?: AccessLevel[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (levels && !levels.includes(user.accessLevel)) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}

export function FullScreenSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading">
      <div className="size-8 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  );
}
