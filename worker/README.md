# Drive Home leaderboard

The Vite game stays on Vercel. A small Cloudflare Worker validates requests and stores player names, progress and best times in D1. No database credential is shipped to the browser. The API is `https://drive-home-leaderboard.drive-home.workers.dev`.

## Local development

Use Node.js 22.12+ for the game and backend tools.

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

- The browser creates and saves a cryptographically random 256-bit bearer token. D1 stores only its SHA-256 hash. Tokens stay in localStorage; clearing browser storage loses the player's identity. Progress remains local if the API fails.
- Names are trimmed, normalized and unique ignoring case, and cannot be changed. The server gets the score's name from the authenticated player, ignoring any name or player ID submitted by the client.
- Only the best time per player per built-in map is stored. A transaction-level trigger enforces a ten-second posting interval, including slower submissions. Custom routes stay local.
- Progress merges use SQL maxima and set unions, so overlapping saves cannot replace stronger progress. Payloads are limited to 12 KB; stat counters, map lists and achievements are validated.
- Native Worker rate limiters allow 300 reads and 120 writes per IP per minute, rejecting excess requests before body parsing or D1 queries. These counters are approximate and local to each Cloudflare location; they are not a global spending cap. Missing bindings fail closed. A separate D1 counter permits 20 new accounts per hashed IP per hour, stops incrementing after the limit, and removes expired windows during accepted signups. Read endpoints reveal scores only. These controls limit basic spam; browser-reported race results are still not cheat-proof.
- `POST /claim` belonged to the closed Supabase account transfer. Any request with a well-formed token gets `410 migration_closed`, so game pages from before November 2, 2026 still fall through to `/session`; it reads no body, contacts no other service and changes nothing.

## Deploying

The Worker deploys separately from the game; merging into `main` deploys only the game on Vercel. Follow [the shipping workflow](../docs/SHIPPING.md) and get the owner's approval first.

```sh
npm run test:online
npm run build
npx wrangler deploy --dry-run --config worker/wrangler.jsonc
npx wrangler deploy --config worker/wrangler.jsonc
```

A dry run validates packaging, not remote behavior. After deploying, check `/health`, `/scores`, a rejected origin and the changed behavior on the live game. The Worker needs D1 binding `DB`, native `READ_LIMITER` and `WRITE_LIMITER` bindings and the exact allowed game origins in `ALLOWED_ORIGINS`; it uses no secrets.

## Recovery

- Worker code: `npx wrangler rollback --config worker/wrangler.jsonc` restores the previous version. It does not change database contents.
- Database: D1 Time Travel restores to a point in time (`npx wrangler d1 time-travel info drive-home --config worker/wrangler.jsonc` shows the current bookmark; record it before any data change). For a full copy, `npx wrangler d1 export drive-home --remote --config worker/wrangler.jsonc --output backups/<name>.sql`. Before deleting data, export it and check the copy restores by loading it into a throwaway local database (`wrangler d1 execute --local --persist-to <temp dir> --file ...`) and comparing counts.
- Private exports, snapshots and generated SQL belong in ignored `backups/`. Never commit them.

## Operations

Billing verified on October 21, 2026: Vercel reports active Hobby with no trial, and the Cloudflare Workers plans dashboard shows Free as the current plan ($0). Keep both plans free. Vercel serves static files only; the leaderboard API runs on Cloudflare. Excess usage can interrupt availability instead of creating usage overage charges on these plans. Request throttles reduce abuse, but the account plans provide the billing protection.

Workers Free permits 100,000 requests per day. D1 Free permits 5 million rows read and 100,000 rows written per day, with 5 GB total storage. D1 queries fail when its free daily quota is exhausted, until reset. Vercel Hobby has its own free usage limits, including 100 GB transfer and 1 million edge requests. Do not enable paid plans, trials, Marketplace services, or paid firewall rules without the owner's approval. No optional Vercel WAF rate-limiting rule was enabled; automatic DDoS protection remains available.

Monitor Workers and D1 usage in the dashboard. Neither service pauses when idle, so no keep-alive is needed. Private backups, local environment files and agent configuration are excluded from both Git and Vercel CLI uploads.

Official references: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [native rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Cloudflare agent setup](https://developers.cloudflare.com/agent-setup/prompt.md).

## History

- **Until October 21, 2026** the game used Supabase (anonymous sign-in, Postgres tables and a leaderboard view).
- **October 21, 2026:** cutover to this Worker and D1, approved by the owner. The old tables were made read-only and their final snapshot imported: 370 player rows and three raw scores became 371 D1 identities (one historical identity for scores without an account) and two best-score entries. Old browsers could transfer their identity by sending their Supabase session to `/claim`, which the Worker verified with Supabase's authentication service. Vercel kept only `VITE_LEADERBOARD_API`, and the unused `supabase-amber-pebble` Vercel store was disconnected.
- **November 2, 2026:** Supabase retired, with the owner's approval. Supabase had paused the old project for inactivity, so transfers could no longer succeed. The transfer was closed early (the three `MIGRATION_*` Worker secrets were removed) and the 370 never-transferred accounts, all test users including "TestBot" and "lololololol", were deleted with their two scores, leaving 13 players and one score. A full export was taken first (`backups/d1-before-supabase-retirement-2026-11-02.sql`, restore checked locally) and the Time Travel bookmark before the change was `00000015-00000000-00005117-815a52fe3939c5fc63f871e45c03f816`. The transfer code and the importer were removed afterwards; `/claim` stays as the closed stub above.
