"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, type ApiError } from "@/lib/api";
import type { LoginResponse, MeUser } from "@/lib/types";

const TOKEN_KEY = "gr_token";

interface AuthContextValue {
  token: string | null;
  user: MeUser | null;
  loading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async (raw: string | null) => {
    if (!raw) {
      setToken(null);
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiFetch<MeUser>("/auth/me", { token: raw });
      setToken(raw);
      setUser(me);
    } catch (err) {
      if ((err as ApiError).status === 401) {
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ignore */
        }
        setToken(null);
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    void hydrate(raw);
  }, [hydrate]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<LoginResponse>("/auth/login", { method: "POST", body: { email, password } });
    try {
      localStorage.setItem(TOKEN_KEY, res.token);
    } catch {
      /* ignore */
    }
    setToken(res.token);
    setUser({ ...res.user, mustChangePassword: res.mustChangePassword });
  }, []);

  const loginWithToken = useCallback(async (raw: string) => {
    if (!raw) return;
    try {
      localStorage.setItem(TOKEN_KEY, raw);
    } catch {
      /* ignore */
    }
    setToken(raw);
    setLoading(true);
    try {
      const me = await apiFetch<MeUser>("/auth/me", { token: raw });
      setUser(me);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const me = await apiFetch<MeUser>("/auth/me", { token });
      setUser(me);
    } catch {
      /* leave current session */
    }
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      loading,
      isAdmin: user?.roles?.includes("ADMIN") ?? user?.isRootAdmin ?? false,
      login,
      loginWithToken,
      logout,
      refresh
    }),
    [token, user, loading, login, loginWithToken, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useToken(): string | null {
  return useAuth().token;
}

export function useRequireAuth(): AuthContextValue {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!auth.loading && !auth.token) router.replace("/login");
  }, [auth.loading, auth.token, router]);
  return auth;
}