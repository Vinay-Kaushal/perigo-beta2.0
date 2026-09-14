"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { api, ApiError, setUnauthorizedHandler } from "./api";
import type { User } from "./types";

interface Session {
  user: User;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
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
    async (redirect = true) => {
      setUser(null);
      // Drop every cached response so the next account never sees the last one's data.
      mutate(() => true, undefined, { revalidate: false });
      // A stale cookie would make the middleware bounce /login -> /dashboard forever; have the API clear it.
      await api.post("/auth/logout").catch(() => {});
      if (redirect && !window.location.pathname.startsWith("/login")) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?next=${next}`;
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
      } else {
        console.warn("Couldn't load the session", err);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOutLocally(true));
    refreshUser();
  }, [refreshUser, signOutLocally]);

  // The API has already set the httpOnly session cookie; we only keep the user.
  const adoptSession = useCallback((session: Session) => setUser(session.user), []);

  const login = useCallback(
    async (email: string, password: string) => adoptSession(await api.post<Session>("/auth/login", { email, password })),
    [adoptSession]
  );

  const loginWithGoogle = useCallback(
    async (idToken: string) => adoptSession(await api.post<Session>("/auth/google", { idToken })),
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
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, register, logout, logoutEverywhere, refreshUser, adoptSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
