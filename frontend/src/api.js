export const API = import.meta.env.VITE_API_URL || '/api';

export async function api(path, options = {}) {
  const token = localStorage.getItem('mm_token');
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401 && !options.skipAuthRedirect) {
    localStorage.removeItem('mm_token');
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}
