// Build a private D1 import from a read-only Supabase snapshot. Never commit
// snapshots or generated SQL; backups/ is ignored by Git.
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [snapshotPath, scoresPath, output] = process.argv.slice(2);
if (!snapshotPath || !scoresPath || !output) throw new Error('Usage: node tools/import-d1.mjs <players-snapshot.json> <scores.json> <output.sql>');
const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
const scores = JSON.parse(await readFile(scoresPath, 'utf8'));
const quote = (value) => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const lines = [];
const players = new Map(snapshot.players.map((p) => [p.id, p]));
for (const score of scores) {
  if (!score.player_id) {
    score.player_id = `legacy-${createHash('sha256').update(score.name.trim().toLowerCase()).digest('hex')}`;
    players.set(score.player_id, { id: score.player_id, name: score.name, stats: {}, achievements: [], historical: true });
  }
  if (!players.has(score.player_id)) throw new Error('Score refers to a missing player; export the full snapshot first');
}
for (const p of players.values()) {
  // Historical pre-account scores retain their display names, but cannot claim
  // ownership of a current account's unique name.
  const nameKey = p.name && !p.historical ? p.name.trim().normalize('NFKC').toLowerCase() : null;
  lines.push(`INSERT INTO players(id,name,name_key,stats,achievements) VALUES (${[p.id, p.name, nameKey, JSON.stringify(p.stats), JSON.stringify(p.achievements)].map(quote).join(',')}) ON CONFLICT(id) DO UPDATE SET stats=excluded.stats,achievements=excluded.achievements WHERE players.token_hash IS NULL;`);
}
for (const s of scores) {
  for (const field of ['time_ms', 'crashes']) if (!Number.isSafeInteger(s[field])) throw new Error('Invalid score number');
  lines.push(`UPDATE players SET last_score=0 WHERE id=${quote(s.player_id)};`);
  lines.push(`INSERT INTO scores(player_id,map,car,time_ms,crashes) VALUES (${[s.player_id, s.map, s.car].map(quote).join(',')},${s.time_ms},${s.crashes}) ON CONFLICT(player_id,map) DO UPDATE SET car=excluded.car,time_ms=excluded.time_ms,crashes=excluded.crashes WHERE excluded.time_ms < scores.time_ms;`);
}
await writeFile(output, lines.join('\n') + '\n', { mode: 0o600 });
await chmod(output, 0o600);
console.log(`Prepared ${players.size} players (including historical entries) and ${scores.length} scores. Import file stays private.`);
