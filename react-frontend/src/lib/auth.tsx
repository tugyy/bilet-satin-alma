import React, { createContext, useContext, useEffect, useState } from 'react';
import { logout as apiLogout, fetchProfile } from './api';

export type User = Record<string, unknown> | null;

type AuthContextShape = {
  user: User;
  setUser: (u: User) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextShape | undefined>(undefined);

const USER_KEY = 'auth_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User>(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
      else localStorage.removeItem(USER_KEY);
    } catch { /* empty */ }
  }, [user]);

  // On mount, if there is a token but no user in state, try to fetch profile
  useEffect(() => {
    let mounted = true;
    const hasToken = localStorage.getItem('auth_token');
    if (hasToken && !user) {
      (async () => {
        try {
          const res = await fetchProfile();
          if (!mounted) return;
          if (res && typeof res === 'object' && 'user' in (res as Record<string, unknown>)) {
            const maybe = (res as Record<string, unknown>)['user'];
            setUserState(maybe as User);
          }
        } catch {
          // ignore - token may be invalid
        }
      })();
    }
    return () => { mounted = false; };
  }, [user]);

  const setUser = (u: User) => {
    setUserState(u);
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch {
      // ignore network errors on logout
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthProvider;
