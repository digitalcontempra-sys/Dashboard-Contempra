import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SessionUser } from "../../shared/types";
import { api } from "../api";
import { ME_QUERY, useAuth } from "../auth";
import { BrandLogo } from "../components/BrandLogo";

/** Shown instead of the app while an account still has a temporary password. */
export function ChangePassword() {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError("Passwords do not match");
    setBusy(true);
    try {
      const user = await api<SessionUser>("/api/auth/change-password", {
        method: "POST",
        json: { currentPassword: current, newPassword: next },
      });
      qc.setQueryData(ME_QUERY, user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, auto: string) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-text-2">
        {label}
      </label>
      <input id={id} type="password" className="field" value={value} onChange={(e) => set(e.target.value)} autoComplete={auto} required />
    </div>
  );

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="glass-strong w-full max-w-sm rounded-[var(--radius-panel)] p-6">
        <BrandLogo className="mx-auto mb-4 h-auto w-40" />
        <h1 className="text-center text-xl font-bold">Choose your password</h1>
        <p className="mt-1 mb-5 text-center text-sm text-text-2">
          Your account has a temporary password. Choose your own to continue (at least 8 characters).
        </p>
        <div className="flex flex-col gap-3">
          {field("pw-current", "Current password", current, setCurrent, "current-password")}
          {field("pw-new", "New password", next, setNext, "new-password")}
          {field("pw-confirm", "Confirm new password", confirm, setConfirm, "new-password")}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary mt-5 w-full" disabled={busy}>
          Save password
        </button>
        <button type="button" className="btn mt-2 w-full text-text-2" onClick={() => void logout()}>
          Sign out
        </button>
      </form>
    </div>
  );
}
