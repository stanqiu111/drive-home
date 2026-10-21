import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from './index.js';

let mf, db;
const a = 'a'.repeat(64), b = 'b'.repeat(64);
const origin = 'http://localhost:5173';
const allowLimiter = { limit: async () => ({ success: true }) };
async function call(path, data, token = a, requestOrigin = origin) {
  const headers = { Origin: requestOrigin };
  if (data !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
  const response = await mf.dispatchFetch(`http://localhost${path}`, {
    method: data === undefined ? 'GET' : 'POST', headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: new URL('./index.js', import.meta.url).pathname,
    compatibilityDate: '2026-10-21', d1Databases: ['DB'], bindings: { ALLOWED_ORIGINS: origin },
    ratelimits: {
      READ_LIMITER: { namespace_id: '20261021', simple: { limit: 300, period: 60 } },
      WRITE_LIMITER: { namespace_id: '20261022', simple: { limit: 120, period: 60 } },
    } }));
  db = await mf.getD1Database('DB');
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  for (const sql of schema.split(/(?<=;)\s*\n\n/).filter((s) => s.trim())) await db.prepare(sql).run();
});
after(async () => { await mf?.dispose(); });

test('D1 leaderboard lifecycle and ownership', async () => {
  assert.equal((await call('/health')).status, 200);
  const first = await call('/session', {});
  assert.equal(first.status, 200);
  assert.equal(first.body.name, null);
  assert.equal((await call('/session', {})).body.id, first.body.id);
  assert.notEqual((await call('/session', {}, b)).body.id, first.body.id);
  const score = { map: 'snowvalley', car: 'legacy', time_ms: 60000, crashes: 0 };
  assert.equal((await call('/scores', score)).body.error, 'name_required');
  assert.equal((await call('/name', { name: ' Driver ' })).body.name, 'Driver');
  assert.equal((await call('/name', { name: 'Changed' })).body.error, 'name_locked');
  assert.equal((await call('/name', { name: 'driver' }, b)).body.error, 'name_taken');
  assert.equal((await call('/scores', { ...score, name: 'Spoofed' })).status, 200);
  assert.equal((await call('/scores', score)).status, 429);
  const top = await call('/scores?map=snowvalley');
  assert.deepEqual(top.body, [{ name: 'Driver', car: 'legacy', time_ms: 60000 }]);
  await db.prepare('UPDATE players SET last_score=0').run();
  assert.equal((await call('/scores', { ...score, time_ms: 70000 })).status, 200);
  assert.equal((await call('/scores?map=snowvalley')).body[0].time_ms, 60000);
  await db.prepare('UPDATE players SET last_score=0').run();
  await call('/scores', { ...score, time_ms: 50000 });
  assert.equal((await call('/scores?map=snowvalley')).body[0].time_ms, 50000);
  assert.equal((await db.prepare('SELECT count(*) n FROM scores').first()).n, 1);
  assert.equal((await call('/scores')).body.rows.length, 1);
  assert.equal((await call('/scores', score, 'c'.repeat(64))).status, 401);
});

test('progress merges atomically and remains private', async () => {
  const [one, two] = await Promise.all([
    call('/progress', { stats: { trips: 7, cans: 2, maps: ['home'] }, achievements: ['first_trip'] }),
    call('/progress', { stats: { trips: 2, cans: 12, maps: ['burger'] }, achievements: ['juiced'] }),
  ]);
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  const saved = (await call('/session', {})).body;
  assert.equal(saved.stats.trips, 7); assert.equal(saved.stats.cans, 12);
  assert.deepEqual(saved.stats.maps.sort(), ['burger', 'home']);
  assert.deepEqual(saved.achievements.sort(), ['first_trip', 'juiced']);
  const other = (await call('/session', {}, b)).body;
  assert.deepEqual(other.stats, {});
});

test('rejects malformed input, oversized bodies and untrusted origins', async () => {
  assert.equal((await call('/scores?map=bad')).status, 400);
  assert.equal((await call('/scores?map=home&limit=0')).status, 400);
  assert.equal((await call('/scores', { map: 'home', car: 'legacy', time_ms: -1, crashes: 0 })).status, 400);
  assert.equal((await call('/progress', null)).status, 400);
  assert.equal((await call('/progress', { stats: { trips: -1 } })).status, 400);
  assert.equal((await call('/session', { blob: 'x'.repeat(13000) })).status, 413);
  assert.equal((await call('/health', undefined, a, 'https://untrusted.example')).status, 403);
  assert.equal((await call('/health')).headers.get('Access-Control-Allow-Origin'), origin);
});

test('legacy migration cannot be claimed by UUID or after its window closes', async () => {
  assert.equal((await call('/claim', { id: 'anything' }, 'c'.repeat(64))).status, 410);
});

test('legacy claim verifies ownership, preserves records and is safe to retry', async () => {
  const id = 'old-player';
  await db.prepare('INSERT INTO players(id,name,name_key,stats) VALUES (?,?,?,?)').bind(id, 'Original', 'original', '{"trips":9}').run();
  await db.prepare('INSERT INTO scores(player_id,map,car,time_ms,crashes) VALUES (?,?,?,?,?)').bind(id, 'home', 'legacy', 80000, 0).run();
  const env = { DB: db, READ_LIMITER: allowLimiter, WRITE_LIMITER: allowLimiter, ALLOWED_ORIGINS: origin, MIGRATION_SUPABASE_URL: 'https://old.example', MIGRATION_SUPABASE_KEY: 'test-public-key', MIGRATION_DEADLINE: '2099-01-01T00:00:00Z' };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://old.example/auth/v1/user');
    assert.equal(init.headers.Authorization, 'Bearer valid-old-session');
    return Response.json({ id });
  };
  try {
    const request = () => new Request('http://localhost/claim', { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${'d'.repeat(64)}`,
    }, body: JSON.stringify({ access_token: 'valid-old-session', id: 'someone-else' }) });
    const claimed = await worker.fetch(request(), env);
    assert.equal(claimed.status, 200);
    const result = await claimed.json();
    assert.equal(result.id, id); assert.equal(result.name, 'Original'); assert.equal(result.stats.trips, 9);
    assert.equal((await worker.fetch(request(), env)).status, 200);
    assert.equal(calls, 1);
    assert.equal((await db.prepare('SELECT count(*) n FROM scores WHERE player_id=?').bind(id).first()).n, 1);
    assert.equal((await db.prepare('SELECT count(*) n FROM players WHERE token_hash=?').bind('d'.repeat(64)).first()).n, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('new browser identities are rate limited', async () => {
  let limited = false;
  for (let i = 1; i <= 21; i++) {
    const response = await call('/session', {}, i.toString(16).padStart(64, '0'));
    if (response.status === 429) limited = true;
  }
  assert.equal(limited, true);
});

test('expired legacy sessions refresh on 403; an outage does not discard identity', async () => {
  const env = { DB: db, READ_LIMITER: allowLimiter, WRITE_LIMITER: allowLimiter, ALLOWED_ORIGINS: origin, MIGRATION_SUPABASE_URL: 'https://old.example', MIGRATION_SUPABASE_KEY: 'public-test', MIGRATION_DEADLINE: '2099-01-01T00:00:00Z' };
  await db.prepare('INSERT INTO players(id) VALUES (?)').bind('expired-player').run();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    if (calls === 1) return Response.json({ code: 'bad_jwt' }, { status: 403 });
    if (calls === 2) {
      assert.equal(url, 'https://old.example/auth/v1/token?grant_type=refresh_token');
      assert.equal(JSON.parse(init.body).refresh_token, 'refresh-proof');
      return Response.json({ access_token: 'fresh-proof' });
    }
    assert.equal(init.headers.Authorization, 'Bearer fresh-proof');
    return Response.json({ id: 'expired-player' });
  };
  const request = (token) => new Request('http://localhost/claim', { method: 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${token.repeat(64)}`,
  }, body: JSON.stringify({ access_token: 'expired-proof', refresh_token: 'refresh-proof' }) });
  try {
    assert.equal((await worker.fetch(request('e'), env)).status, 200);
    assert.equal(calls, 3);
    globalThis.fetch = async () => Response.json({}, { status: 503 });
    const unavailable = await worker.fetch(request('f'), env);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error, 'legacy_service_unavailable');
  } finally { globalThis.fetch = originalFetch; }
});

test('read and write floods are rejected without database queries', async () => {
  let queries = 0;
  const deny = { limit: async () => ({ success: false }) };
  const env = { DB: { prepare() { queries++; throw new Error('Database must not be reached'); } }, ALLOWED_ORIGINS: origin,
    READ_LIMITER: deny, WRITE_LIMITER: deny };
  for (const [path, method] of [['/scores', 'GET'], ['/health', 'GET'], ['/session', 'POST'], ['/scores', 'POST'], ['/progress', 'POST']]) {
    const response = await worker.fetch(new Request(`https://example.com${path}`, { method, headers: { Origin: origin } }), env);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  }
  assert.equal(queries, 0);
  delete env.READ_LIMITER;
  assert.equal((await worker.fetch(new Request('https://example.com/scores'), env)).status, 503);
  assert.equal(queries, 0);
});

test('rejected account creation stops consuming database writes', async () => {
  const before = await db.prepare("SELECT count FROM request_limits WHERE key LIKE 'signup:%'").first();
  assert.equal((await call('/session', {}, '9'.repeat(64))).status, 429);
  const after = await db.prepare("SELECT count FROM request_limits WHERE key LIKE 'signup:%'").first();
  assert.equal(before.count, 20);
  assert.equal(after.count, 20);
});
