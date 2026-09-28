// Who is logged in, available to every component. The browser keeps the session cookie
// (HttpOnly, so JavaScript can't even see it); this context only keeps the user's
// public details, fetched from /auth/me when the app starts.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setUnauthenticatedHandler } from '../api/client';
import { api } from '../api/endpoints';
import type { User } from '../api/types';

type AuthState = {
  user: User | null;
  loading: boolean; // true until we know whether the cookie is still valid
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  // On first load, ask the API whether our cookie still belongs to a live session.
  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null)) // 401 = not logged in; network error = treat as logged out
      .finally(() => setLoading(false));
  }, []);

  // If any request later answers 401 (session expired, logged out elsewhere), drop the
  // user; the protected routes then send them to the login page.
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setUser((current) => {
        if (current) setSessionExpired(true);
        return null;
      });
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setUser(await api.login(email, password));
    setSessionExpired(false);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    setUser(await api.register(email, password));
    setSessionExpired(false);
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined); // even if the call fails, forget the user locally
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, sessionExpired, login, register, logout }),
    [user, loading, sessionExpired, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
