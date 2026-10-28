import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { authApi, type AuthCredentials, type AuthUser } from '../api';
import { isStatus } from '../lib/domain';

type Session = { status: 'loading' | 'ready' | 'error'; user: AuthUser | null; error: unknown };
interface AuthContextValue extends Session {
  refresh: () => Promise<void>;
  login: (credentials: AuthCredentials) => Promise<void>;
  register: (credentials: AuthCredentials) => Promise<void>;
  logout: () => Promise<void>;
  expire: () => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'loading', user: null, error: null });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setSession({ status: 'loading', user: null, error: null });
    try {
      const { user } = await authApi.me();
      if (current === generation.current) setSession({ status: 'ready', user, error: null });
    } catch (error) {
      if (current === generation.current) setSession({ status: isStatus(error, 401) ? 'ready' : 'error', user: null, error: isStatus(error, 401) ? null : error });
    }
  }, []);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  async function authenticate(mode: 'login' | 'register', body: AuthCredentials) {
    const { user } = await authApi[mode](body);
    generation.current++;
    setSession({ status: 'ready', user, error: null });
  }
  async function logout() {
    // Preserve the authenticated UI until the server confirms revocation and cookie clearing.
    await authApi.logout();
    generation.current++;
    setSession({ status: 'ready', user: null, error: null });
  }
  const expire = useCallback(() => {
    generation.current++;
    setSession({ status: 'ready', user: null, error: null });
  }, []);
  return <AuthContext.Provider value={{ ...session, refresh, expire, logout, login: body => authenticate('login', body), register: body => authenticate('register', body) }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Не удалось загрузить авторизацию.');
  return value;
}
