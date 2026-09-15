"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { api, ApiError, setUnauthorizedHandler, ssoRequiredLoginUrl } from "./api";
import type { User } from "./types";

interface Session {
  user: User;
}

/** The password (or Google) step succeeded but the account has 2FA: finish with `verifyMfa`. */
export interface MfaChallenge {
  mfaToken: string;
}

type LoginResponse = Session | { mfaRequired: true; mfaToken: string };

export type SecondFactor = { code: string } | { recoveryCode: string };

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** Resolves to a challenge when a second factor is needed, otherwise null (signed in). */
  login: (email: string, password: string) => Promise<MfaChallenge | null>;
  loginWithGoogle: (idToken: string) => Promise<MfaChallenge | null>;
  verifyMfa: (mfaToken: string, factor: SecondFactor) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutEverywhere: () => Promise<void>;
  refreshUser: () => Promise<void>;
  adoptSession: (session: Session) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { mutate } = useSWRConfig();

  const signOutLocally = useCallback(
    async (redirect = true, reason?: ApiError) => {
      setUser(null);
      // Drop every cached response so the next account never sees the last one's data.
      mutate(() => true, undefined, { revalidate: false });
      // A stale cookie would make the middleware bounce /login -> /dashboard forever; have the API clear it.
      await api.post("/auth/logout").catch(() => {});
      if (redirect && !window.location.pathname.startsWith("/login")) {
        const here = window.location.pathname + window.location.search;
        window.location.href = reason?.code === "SSO_REQUIRED" ? ssoRequiredLoginUrl(reason, here) : `/login?next=${encodeURIComponent(here)}`;
      }
    },
    [mutate]
  );

  const refreshUser = useCallback(async () => {
    try {
      setUser(await api.get<User>("/auth/me"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // No session, or a revoked one — make sure no stale cookie lingers.
        await api.post("/auth/logout").catch(() => {});
        // The org now enforces SSO for this account: explain why, rather than a silent sign-out.
        if (err.code === "SSO_REQUIRED" && !window.location.pathname.startsWith("/login")) {
          window.location.href = ssoRequiredLoginUrl(err, window.location.pathname + window.location.search);
        }
      } else {
        console.warn("Couldn't load the session", err);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler((error) => void signOutLocally(true, error));
    refreshUser();
  }, [refreshUser, signOutLocally]);

  // The API has already set the httpOnly session cookie; we only keep the user.
  const adoptSession = useCallback((session: Session) => setUser(session.user), []);

  const settle = useCallback(
    (res: LoginResponse): MfaChallenge | null => {
      if ("mfaRequired" in res) return { mfaToken: res.mfaToken };
      adoptSession(res);
      return null;
    },
    [adoptSession]
  );

  const login = useCallback(
    async (email: string, password: string) => settle(await api.post<LoginResponse>("/auth/login", { email, password })),
    [settle]
  );

  const loginWithGoogle = useCallback(
    async (idToken: string) => settle(await api.post<LoginResponse>("/auth/google", { idToken })),
    [settle]
  );

  const verifyMfa = useCallback(
    async (mfaToken: string, factor: SecondFactor) => adoptSession(await api.post<Session>("/auth/mfa/verify", { mfaToken, ...factor })),
    [adoptSession]
  );

  const register = useCallback(
    async (email: string, password: string, name: string) =>
      adoptSession(await api.post<Session>("/auth/register", { email, password, name })),
    [adoptSession]
  );

  const logout = useCallback(async () => {
    await signOutLocally(false);
    window.location.href = "/login";
  }, [signOutLocally]);

  const logoutEverywhere = useCallback(async () => {
    await api.post("/auth/logout-all");
    await signOutLocally(false);
    window.location.href = "/login";
  }, [signOutLocally]);

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, verifyMfa, register, logout, logoutEverywhere, refreshUser, adoptSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
