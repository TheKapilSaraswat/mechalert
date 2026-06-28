import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem('mm_token')) { setLoading(false); return }
    api('/me').then(data => {
      data.tier = data.tier || (data.is_premium ? 'pro' : 'free');
      setUser(data);
    }).catch(err => {
      console.warn('[Auth] /me failed, clearing session:', err.message);
      localStorage.removeItem('mm_token');
    }).finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    setError(null);
    const data = await api('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }), skipAuthRedirect: true,
    });
    localStorage.setItem('mm_token', data.token);
    data.user.tier = data.user.tier || (data.user.is_premium ? 'pro' : 'free');
    setUser(data.user);
  };

  const register = async (email, password) => {
    setError(null);
    const data = await api('/auth/register', {
      method: 'POST', body: JSON.stringify({ email, password }), skipAuthRedirect: true,
    });
    localStorage.setItem('mm_token', data.token);
    data.user.tier = data.user.tier || (data.user.is_premium ? 'pro' : 'free');
    setUser(data.user);
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    localStorage.removeItem('mm_token');
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, error, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
