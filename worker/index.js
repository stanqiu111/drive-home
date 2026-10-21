const MAPS = ['home', 'windermere', 'sherwood', 'burger', 'beachclub', 'noodle', 'snowvalley', 'refinery'];
const COUNTERS = ['trips', 'cans', 'boxes', 'smashed', 'food'];
const ACHIEVEMENTS = ['first_trip', 'juiced', 'mystery', 'bumper', 'foodie'];
const TOKEN = /^[a-f0-9]{64}$/;
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, 'json_required');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'body_required');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 12000) { await reader.cancel(); fail(413, 'body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'invalid_json'); }
}

function cleanProgress(value) {
  if (!value || typeof value !== 'object' || !value.stats || typeof value.stats !== 'object') fail(400, 'invalid_progress');
  const stats = {};
  for (const key of COUNTERS) {
    const n = value.stats[key] ?? 0;
    if (!Number.isSafeInteger(n) || n < 0 || n > 1e9) fail(400, 'invalid_progress');
    stats[key] = n;
  }
  const maps = value.stats.maps ?? [];
  if (!Array.isArray(maps) || maps.length > 64 || maps.some((m) => typeof m !== 'string' || m.length > 100)) fail(400, 'invalid_progress');
  stats.maps = [...new Set(maps)];
  const achievements = value.achievements ?? [];
  if (!Array.isArray(achievements) || achievements.length > 50 || achievements.some((a) => !ACHIEVEMENTS.includes(a))) fail(400, 'invalid_progress');
  return { stats, achievements: [...new Set(achievements)] };
}

async function rateLimit(db, key, max, seconds) {
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / seconds);
  const row = await db.prepare(`INSERT INTO request_limits(key, count, expires) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`).bind(`${key}:${window}`, (window + 1) * seconds).first();
  if (row.count > max) fail(429, 'too_many_requests');
  // Indexed primary keys bound each window; remove expired entries on writes.
  await db.prepare('DELETE FROM request_limits WHERE expires < ?').bind(now).run();
}

async function player(db, tokenHash) {
  const row = await db.prepare('SELECT * FROM players WHERE token_hash = ?').bind(tokenHash).first();
  if (!row) fail(401, 'unknown_player');
  return row;
}

function playerJSON(row) {
  return { id: row.id, name: row.name, stats: JSON.parse(row.stats), achievements: JSON.parse(row.achievements) };
}

// Only used during the migration window. The old service verifies ownership;
// a user-supplied name or UUID is never accepted as proof of identity.
async function claimLegacy(env, credentials, tokenHash) {
  const deadline = Date.parse(env.MIGRATION_DEADLINE);
  if (!env.MIGRATION_SUPABASE_URL || !env.MIGRATION_SUPABASE_KEY || !Number.isFinite(deadline) || Date.now() >= deadline) fail(410, 'migration_closed');
  const base = env.MIGRATION_SUPABASE_URL;
  const headers = { apikey: env.MIGRATION_SUPABASE_KEY };
  let access = credentials?.access_token;
  if (typeof access !== 'string' || access.length > 5000) fail(400, 'invalid_legacy_session');
  let response = await fetch(`${base}/auth/v1/user`, { headers: { ...headers, Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(4000) });
  if ([401, 403].includes(response.status) && typeof credentials.refresh_token === 'string' && credentials.refresh_token.length < 2000) {
    const refreshed = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: credentials.refresh_token }),
      signal: AbortSignal.timeout(4000),
    });
    if (refreshed.status >= 500 || refreshed.status === 429) fail(503, 'legacy_service_unavailable');
    if (!refreshed.ok) fail(401, 'legacy_session_expired');
    access = (await refreshed.json()).access_token;
    response = await fetch(`${base}/auth/v1/user`, { headers: { ...headers, Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(4000) });
  }
  if (response.status >= 500 || response.status === 429) fail(503, 'legacy_service_unavailable');
  if (!response.ok) fail(401, 'legacy_session_expired');
  const user = await response.json();
  const result = await env.DB.prepare('UPDATE players SET token_hash = ? WHERE id = ? AND token_hash IS NULL RETURNING id').bind(tokenHash, user.id).first();
  if (!result) fail(409, 'legacy_player_unavailable');
}

async function route(request, env) {
  const url = new URL(request.url);
  const db = env.DB;
  if (request.method === 'GET' && url.pathname === '/health') {
    await db.prepare('SELECT id FROM players LIMIT 1').first();
    return json({ ok: true });
  }
  if (request.method === 'GET' && url.pathname === '/scores') {
    const map = url.searchParams.get('map');
    if (map !== null && !MAPS.includes(map)) fail(400, 'invalid_map');
    const limit = Number(url.searchParams.get('limit') ?? 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, 'invalid_limit');
    // Menu ranks load all results without a silent 5,000-row cutoff.
    const after = url.searchParams.get('after') ?? '';
    if (after.length > 150) fail(400, 'invalid_cursor');
    const result = map
      ? await db.prepare(`SELECT p.name, s.car, s.time_ms FROM scores s JOIN players p ON p.id=s.player_id
          WHERE s.map=? ORDER BY s.time_ms, s.player_id LIMIT ?`).bind(map, limit).all()
      : await db.prepare(`SELECT s.map, p.name, s.time_ms, s.player_id || ':' || s.map AS cursor FROM scores s JOIN players p ON p.id=s.player_id
          WHERE s.player_id || ':' || s.map > ? ORDER BY s.player_id, s.map LIMIT 1000`).bind(after).all();
    return json(map ? result.results : { rows: result.results, next: result.results.length === 1000 ? result.results.at(-1).cursor : null });
  }
  if (!['POST', 'PUT'].includes(request.method)) fail(404, 'not_found');
  if (!['/session', '/claim', '/name', '/progress', '/scores'].includes(url.pathname)) fail(404, 'not_found');
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!TOKEN.test(token ?? '')) fail(401, 'invalid_token');
  const tokenHash = await hash(token);
  const ip = await hash(request.headers.get('CF-Connecting-IP') ?? 'local');
  await rateLimit(db, `write:${ip}`, 120, 60);
  const data = await body(request);
  if (url.pathname === '/session') {
    let row = await db.prepare('SELECT * FROM players WHERE token_hash = ?').bind(tokenHash).first();
    if (!row) {
      await rateLimit(db, `signup:${ip}`, 20, 3600);
      await db.prepare('INSERT INTO players(id, token_hash) VALUES (?, ?) ON CONFLICT(token_hash) DO NOTHING').bind(crypto.randomUUID(), tokenHash).run();
      row = await player(db, tokenHash);
    }
    return json(playerJSON(row));
  }
  if (url.pathname === '/claim') {
    const existing = await db.prepare('SELECT * FROM players WHERE token_hash = ?').bind(tokenHash).first();
    if (existing) return json(playerJSON(existing));
    await claimLegacy(env, data, tokenHash);
    return json(playerJSON(await player(db, tokenHash)));
  }
  const row = await player(db, tokenHash);
  if (url.pathname === '/name') {
    if (row.name) fail(409, 'name_locked');
    const name = typeof data?.name === 'string' ? data.name.trim().normalize('NFKC') : '';
    if (!name || [...name].length > 16 || /[\p{Cc}\p{Cf}]/u.test(name)) fail(400, 'invalid_name');
    try {
      const saved = await db.prepare('UPDATE players SET name=?, name_key=? WHERE id=? AND name IS NULL RETURNING name').bind(name, name.toLowerCase(), row.id).first();
      if (!saved) fail(409, 'name_locked');
    } catch (e) {
      if (e.message.includes('UNIQUE')) fail(409, 'name_taken');
      throw e;
    }
    return json({ name });
  }
  if (url.pathname === '/progress') {
    const clean = cleanProgress(data);
    // Merge inside SQLite to avoid overwriting progress from overlapping saves.
    const counters = COUNTERS.map((k) => `'${k}', max(coalesce(json_extract(stats,'$.${k}'),0), json_extract(?1,'$.${k}'))`).join(',');
    const saved = await db.prepare(`UPDATE players SET stats=json_object(${counters}, 'maps', json((
      SELECT json_group_array(value) FROM (SELECT value FROM json_each(players.stats,'$.maps') UNION SELECT value FROM json_each(?1,'$.maps') LIMIT 64)
    ))), achievements=(SELECT json_group_array(value) FROM (
      SELECT value FROM json_each(players.achievements) UNION SELECT value FROM json_each(?2)
    )) WHERE id=?3 RETURNING *`).bind(JSON.stringify(clean.stats), JSON.stringify(clean.achievements), row.id).first();
    return json(playerJSON(saved));
  }
  if (!data || !MAPS.includes(data.map) || typeof data.car !== 'string' || !/^[a-z0-9_-]{1,20}$/i.test(data.car)
    || !Number.isInteger(data.time_ms) || data.time_ms < 5000 || data.time_ms > 3600000
    || !Number.isInteger(data.crashes) || data.crashes < 0 || data.crashes > 999) fail(400, 'invalid_score');
  try {
    await db.prepare(`INSERT INTO scores(player_id,map,car,time_ms,crashes) VALUES (?,?,?,?,?)
      ON CONFLICT(player_id,map) DO UPDATE SET car=excluded.car,time_ms=excluded.time_ms,crashes=excluded.crashes
      WHERE excluded.time_ms < scores.time_ms`).bind(row.id, data.map, data.car, data.time_ms, data.crashes).run();
  } catch (e) {
    if (e.message.includes('score_rate_limit')) fail(429, 'wait_before_posting');
    if (e.message.includes('name_required')) fail(409, 'name_required');
    throw e;
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',');
    if (origin && !allowed.includes(origin)) return json({ error: 'origin_not_allowed' }, 403);
    let response;
    if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
    else {
      try { response = await route(request, env); }
      catch (e) {
        if (!e.status) console.error(JSON.stringify({ event: 'request_failed', path: new URL(request.url).pathname }));
        response = json({ error: e.code ?? 'service_unavailable' }, e.status ?? 503);
      }
    }
    if (origin) response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  },
};
