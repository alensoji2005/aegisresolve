import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { type AuthUser, onUserChange, post, refreshSession, setAccessToken } from './api';

interface AuthCtx {
  user: AuthUser | null;
  ready: boolean;
  login(username: string, password: string): Promise<{ mfaToken: string; otpauthUrl?: string }>;
  verify(mfaToken: string, code: string): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onUserChange(setUser);
    refreshSession().finally(() => setReady(true));
  }, []);

  const value: AuthCtx = {
    user,
    ready,
    login: (username, password) => post('/auth/login', { username, password }),
    async verify(mfaToken, code) {
      const r = await post<{ accessToken: string; user: AuthUser }>('/auth/mfa/verify', { mfaToken, code });
      setAccessToken(r.accessToken);
      setUser(r.user);
    },
    async logout() {
      await post('/auth/logout').catch(() => undefined);
      setAccessToken(null);
      setUser(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
