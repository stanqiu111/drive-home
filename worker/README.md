# Drive Home leaderboard

The Vite game stays on Vercel. A small Cloudflare Worker validates requests and stores player names, progress and best times in D1. No Supabase SDK or database credential is shipped to the browser. The owner approved production cutover on October 21, 2026. The API is `https://drive-home-leaderboard.drive-home.workers.dev`.

## Local development

```sh
npm ci
npm run online:init:local
npm run online:dev
# In another terminal:
VITE_LEADERBOARD_API=http://127.0.0.1:8787 npm run dev
npm run test:online
```

Local D1 is separate from the remote database. The API allows the production origin and localhost port 5173; add exact preview origins to `ALLOWED_ORIGINS` when needed. Never use a wildcard to allow every preview site.

## Data and identity

- The browser creates and saves a cryptographically random 256-bit bearer token. D1 stores only its SHA-256 hash. Tokens stay in localStorage, as did the old anonymous session; clearing browser storage loses the player's identity. Progress remains local if the API fails.
- Names are trimmed, normalized and unique ignoring case, and cannot be changed. The server gets the score's name from the authenticated player, ignoring any name or player ID submitted by the client.
- Only the best time per player per built-in map is stored. A transaction-level trigger enforces a ten-second posting interval, including slower submissions. Custom routes stay local.
- Progress merges use SQL maxima and set unions, so overlapping saves cannot replace stronger progress. Payloads are limited to 12 KB; stat counters, map lists and achievements are validated.
- Native Worker rate limiters allow 300 reads and 120 writes per IP per minute, rejecting excess requests before body parsing or D1 queries. These counters are approximate and local to each Cloudflare location; they are not a global spending cap. Missing bindings fail closed. A separate D1 counter permits 20 new accounts per hashed IP per hour, stops incrementing after the limit, and removes expired windows during accepted signups. Read endpoints reveal scores only. These controls limit basic spam; browser-reported race results are still not cheat-proof.

## Existing-player migration

Private snapshots and generated SQL belong in ignored `backups/`. Do not commit them. Export all rows from `player_progress` as `{players:[{id,name,stats,achievements}],scores:[]}` and all `scores` separately as `[{player_id,name,map,car,time_ms,crashes}]`. Keep UUIDs to preserve ownership. The two historical scores without an account are preserved under a separate historical player identity.

```sh
node tools/import-d1.mjs backups/supabase-snapshot-2026-10-21.json backups/supabase-scores-2026-10-21.json backups/d1-import.sql
npx wrangler d1 execute drive-home --remote --config worker/wrangler.jsonc --file worker/schema.sql
npx wrangler d1 execute drive-home --remote --config worker/wrangler.jsonc --file backups/d1-import.sql
```

The importer can be rerun before cutover. It preserves claimed D1 player progress and keeps better existing scores. Do not run imports while the new API serves active players: imports reset posting timestamps.

For a limited transition window, configure these Worker secrets:

- `MIGRATION_SUPABASE_URL`: the old active project's URL (mfscaxxnzscccbzfaofz).
- `MIGRATION_SUPABASE_KEY`: its publishable/anon key, never a service-role key.
- `MIGRATION_DEADLINE`: an ISO date/time, for example `2026-11-21T00:00:00Z`.

Existing browsers send their old session to `/claim` once. The Worker verifies it with the old authentication service, refreshes an expired session if possible, and attaches the new token to the imported UUID. A name or UUID alone cannot claim an account. Already claimed browsers no longer contact Supabase. New players never contact it. The old session remains on the device for rollback.

**The old Supabase project must remain available during this claim window.** Once it closes, remove the three migration secrets. Old scores and names remain in D1, and local achievements still transfer, but an unclaimed old account cannot be recovered automatically. A paused old service can delay identity migration; it does not block new players or already migrated players.

## Production cutover procedure

1. Recheck the live Supabase data and take a fresh private snapshot. At cutover, disable old score/progress writes, take a final snapshot, and import it so old open tabs cannot create scores that are missed. Leave Supabase Auth available only for claims.
2. Deploy this Worker with D1 binding `DB`, native `READ_LIMITER` and `WRITE_LIMITER` bindings, and the exact allowed game origin. Set the migration secrets through Wrangler's protected input, never command arguments or Git. Verify `/health` and imported leaderboard results.
3. Set Vercel's `VITE_LEADERBOARD_API` to the resulting `https://drive-home-leaderboard.<account>.workers.dev` URL. Remove the two old `VITE_SUPABASE_*` variables. Build-time configuration needs a fresh Vercel deployment.
4. Publish the reviewed branch only with the owner's approval. Verify an existing browser's identity migration, new-player naming, score submission, ranks and offline progress on the real game.
5. Disconnect the unrelated unused `supabase-amber-pebble` Vercel store; replacing code alone does not remove that integration's provisioning failure. Keep the original active data until cutover and recovery have been checked. Retire the old project after the agreed claim window.

Before deploying: `npm run test:online`, `npm run build`, and `npx wrangler deploy --dry-run --config worker/wrangler.jsonc`. A dry run validates packaging, not remote behavior.

Rollback: restore the previous Vercel deployment/environment and keep both databases. New D1-only players/scores would need exporting before a rollback; Worker code rollback does not roll back database contents.

## Operations

Billing verified on October 21, 2026: Vercel reports active Hobby with no trial, and the Cloudflare Workers plans dashboard shows Free as the current plan ($0). Keep both plans free. Vercel serves static files only; the leaderboard API runs on Cloudflare. Excess usage can interrupt availability instead of creating usage overage charges on these plans. Request throttles reduce abuse, but the account plans provide the billing protection.

Workers Free permits 100,000 requests per day. D1 Free permits 5 million rows read and 100,000 rows written per day, with 5 GB total storage. D1 queries fail when its free daily quota is exhausted, until reset. Vercel Hobby has its own free usage limits, including 100 GB transfer and 1 million edge requests. Do not enable paid plans, trials, Marketplace services, or paid firewall rules without the owner's approval. No optional Vercel WAF rate-limiting rule was enabled; automatic DDoS protection remains available.

Monitor Workers and D1 usage in the dashboard. No keep-alive cron is configured. Use D1's export/Time Travel tools for recovery; no server needs maintaining. Private backups, local environment files and agent configuration are excluded from both Git and Vercel CLI uploads.

Official references: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [native rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Cloudflare agent setup](https://developers.cloudflare.com/agent-setup/prompt.md).

## Release record — October 21, 2026

The original tables were made read-only by revoking INSERT/UPDATE/DELETE from anon and authenticated; the exact former grants are backed up privately in `backups/restore-supabase-writes.sql`. The final snapshot has 370 player rows and three raw scores. D1 preserves 371 identities (one additional historical identity) and the two visible best-score entries. The unrelated Vercel store was disconnected and its injected variables removed. Vercel uses only `VITE_LEADERBOARD_API` for the game. The transfer deadline is `2026-11-21T00:00:00Z`. The live API passed a real expired-session refresh/claim and naming, progress, score and CORS checks; temporary QA rows were removed.
