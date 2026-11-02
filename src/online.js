// Browser-scoped identity: only a hash of this random token is stored by D1.
const API = (import.meta.env.VITE_LEADERBOARD_API || '').replace(/\/$/, '');
const TOKEN_KEY = 'driveHome.onlineToken';
// Leftovers of the retired Supabase sign-in (transfer closed 2026-11-02): its session and the transfer marker.
const RETIRED_KEYS = ['sb-mfscaxxnzscccbzfaofz-auth-token', 'driveHome.migratedPlayer'];
export const onlineEnabled = Boolean(API);
let token;

function getToken() {
  if (!token) {
    token = localStorage.getItem(TOKEN_KEY);
    if (!/^[a-f0-9]{64}$/.test(token ?? '')) {
      token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
      // Fail before creating a server account if the identity cannot be saved.
      localStorage.setItem(TOKEN_KEY, token);
    }
  }
  return token;
}

export async function onlineRequest(path, data) {
  if (!API) throw new Error('Online saves are not configured');
  const headers = {};
  if (data !== undefined) {
    headers.Authorization = `Bearer ${getToken()}`;
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${API}${path}`, {
    method: data === undefined ? 'GET' : 'POST', headers,
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Online service unavailable'), { code: result.error, status: response.status });
  return result;
}

export async function connectPlayer() {
  // Only this game's exact old keys, never another app's data.
  try { for (const key of RETIRED_KEYS) localStorage.removeItem(key); } catch { /* storage unavailable */ }
  return onlineRequest('/session', {});
}
