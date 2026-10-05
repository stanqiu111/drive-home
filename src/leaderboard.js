// Online leaderboard backed by a free Supabase project (see supabase/schema.sql).
// Talks to Supabase's REST API directly; the anon key is meant to be public, and
// row-level security only allows reading scores and adding new ones.
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const leaderboardEnabled = Boolean(URL && KEY);

// Publishable (sb_publishable_…) keys go in the apikey header only; they aren't JWTs.
const headers = () => ({ apikey: KEY, 'Content-Type': 'application/json' });

export async function topScores(map, limit = 10) {
  if (!leaderboardEnabled) return [];
  const q = new URLSearchParams({ select: 'name,car,time_ms', map: `eq.${map}`, order: 'time_ms.asc', limit: String(limit) });
  const res = await fetch(`${URL}/rest/v1/scores?${q}`, { headers: headers() });
  if (!res.ok) throw new Error(`leaderboard ${res.status}`);
  return res.json();
}

export async function submitScore({ map, car, name, timeMs, crashes }) {
  if (!leaderboardEnabled) return;
  const res = await fetch(`${URL}/rest/v1/scores`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ map, car, name: name.trim().slice(0, 16), time_ms: Math.round(timeMs), crashes }),
  });
  if (!res.ok) throw new Error(`leaderboard ${res.status}`);
}
