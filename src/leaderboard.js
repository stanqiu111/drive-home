// Online leaderboard: each player's best time per map (the `leaderboard` view).
// Posting needs the player's anonymous account; the database stamps every score
// with that account's one fixed name.
import { supabase } from './supabase.js';

export const leaderboardEnabled = Boolean(supabase);

export async function topScores(map, limit = 10) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('leaderboard').select('name, car, time_ms').eq('map', map).order('time_ms').limit(limit);
  if (error) throw error;
  return data;
}

export async function submitScore({ map, car, name, timeMs, crashes }) {
  const { error } = await supabase.from('scores').insert({ map, car, name, time_ms: Math.round(timeMs), crashes });
  if (error) throw error;
}

// Every player's best time on every map (small table), for ranks on the menu.
export async function allBestTimes() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('leaderboard').select('map, name, time_ms').limit(5000);
  if (error) throw error;
  return data;
}
