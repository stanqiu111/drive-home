// Online leaderboard: each player's best time per map (the `leaderboard` view).
// Posting needs the player's anonymous account; the database stamps every score
// with that account's one fixed name.
import { onlineEnabled, onlineRequest } from './online.js';

export const leaderboardEnabled = onlineEnabled;

export async function topScores(map, limit = 10) {
  if (!onlineEnabled) return [];
  return onlineRequest(`/scores?map=${encodeURIComponent(map)}&limit=${limit}`);
}

export async function submitScore({ map, car, timeMs, crashes }) {
  return onlineRequest('/scores', { map, car, time_ms: Math.round(timeMs), crashes });
}

// Every player's best time on every map (small table), for ranks on the menu.
export async function allBestTimes() {
  if (!onlineEnabled) return [];
  const rows = [];
  let cursor = '';
  do {
    const page = await onlineRequest(`/scores?after=${encodeURIComponent(cursor)}`);
    rows.push(...page.rows);
    cursor = page.next;
  } while (cursor);
  return rows;
}
