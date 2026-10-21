// Browser-scoped identity: only a hash of this random token is stored by D1.
const API = (import.meta.env.VITE_LEADERBOARD_API || '').replace(/\/$/, '');
const TOKEN_KEY = 'driveHome.onlineToken';
const CLAIMED_KEY = 'driveHome.migratedPlayer';
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
  // Existing Supabase sessions stay on the device for rollback. No SDK is needed.
  // Only inspect the project's exact old storage key, never another app's session.
  const legacyKey = 'sb-mfscaxxnzscccbzfaofz-auth-token';
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem(legacyKey) || 'null'); } catch { /* malformed old save */ }
  if (legacy?.access_token && localStorage.getItem(CLAIMED_KEY) !== getToken()) {
    try {
      const row = await onlineRequest('/claim', { access_token: legacy.access_token, refresh_token: legacy.refresh_token });
      localStorage.setItem(CLAIMED_KEY, getToken());
      return row;
    } catch (e) {
      // Local achievements survive even when an old identity can no longer be
      // verified. Keep transient service failures retryable on the next visit.
      if (!['migration_closed', 'legacy_session_expired', 'legacy_player_unavailable'].includes(e.code)) throw e;
    }
  }
  return onlineRequest('/session', {});
}
