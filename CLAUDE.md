# Drive Home

A 3D browser driving game on real Edmonton roads: beat the rush-hour commute.
Three.js + Vite, plain JavaScript ES modules, no framework.

- Live: https://drive-home-beta.vercel.app (Vercel project `drive-home`)
- Repo: https://github.com/stanqiu111/drive-home (private)

## Working with the owner

- The owner is not a programmer. Do the work end to end, check it yourself (screenshots, test drives), and explain results simply.
- **No paid APIs.** No API keys and no Claude/Anthropic API calls from the game. Free data and free tiers only.
- **Privacy:** never put the owner's real home or start address in code, map data, UI or commits. On purpose, the routes start at a public spot on 91 St SW (Summerside) and the Downtown map ends by the Alberta Legislature.
- Keep the data attribution credits in the menu (OpenStreetMap, City of Edmonton, NRCan).
- "Cam" is a teammate. The E-bike is Cam's; the plain Bicycle belongs to no one.
- The owner cares a lot that each car looks like its real model. After changing a car, render it from several angles and compare.
- Pushing to `main` deploys to production automatically (Vercel is connected to GitHub). Afterwards, confirm with `npx vercel ls drive-home`.

## Commands

```
npm install
npm run dev        # http://localhost:5173
npm run build      # checks road lines, then builds into dist/
npm run check:roads # road-line check on every map (see "Road lines")
npm run preview    # serve the production build
```

- Needs Node `^20.19` or `>=22.12` (Vite 8).
- Online features need `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Get it with `npx vercel login`, `npx vercel link`, then `npx vercel env pull .env.local`. Without it, the game still works and the leaderboard and online progress are hidden.

## Code map (`src/`)

- `main.js`: game loop, menu, HUD, race flow, driving physics, collisions, cameras, leaderboard and achievements UI.
  - `MAPS` = `public/maps/index.json` (written by the builder: km, route polyline, street list, lights, curves, bridge/highway metres, climb, landmarks) merged with `MAP_INFO` (destination label, 2-sentence description, cheer, ending theme). Add new maps to `MAP_INFO` and to `NEW_MAPS` for the "New" badge.
  - The map-select screen groups routes by start point (`GROUPS`), draws north-up route maps as inline SVG, difficulty stars and badges from the index facts, and a detail panel with description, rush-hour race bar and online rank.
  - HUD landmark callouts come from `data.landmarks` in each map file.
  - A dev-only hook, `window.__game`, exposes `S`, `route`, `world`, `startRace`, `finish`, `selectMap`, `selectCar`, `activatePower`, `progress`, `orbit` and `cam` (`{pos, look, fov}` free camera, `null` to release) for automated checks.
- `route.js`: works in route space.
  - `s` = metres along the route; `lat` = sideways offset (+ = right). Convert with `toWorld(s, lat, h)`.
  - Models face -z, and `yaw = atan2(-tx, -tz)`.
- `world.js`: builds a map from its JSON:
  - terrain (carved under the road) and water
  - the road, curbs and sidewalks (broken at side streets), bridges (Walterdale arches on `home`) and lane markings
  - side streets that ramp into junctions; side streets tagged as bridges over level ground become overpasses with ramps and piers
  - buildings: each has a class (`c`: house, rowhouse, apartments, retail, industrial, office, civic, outbuilding, hotel, parking, church, school, bigbox) and `wallStyle()` picks the texture: house siding, stucco with balconies, brick (schools, civic, heritage zones), tilt-up panels for big boxes, ribbed metal for warehouses, glass towers, concrete slab towers, parkades; hip roofs on houses, parapets and rooftop units on flat roofs; `BRANDS` colours known chains
  - store signs (`buildSigns`): real business names on the road-facing wall plus roadside pylon signs for big lots, packed into one texture atlas
  - exit guide signs (`buildExitSigns`) from OSM ramp `destination` tags
  - trees, street lights and the finish banner
- `landmarks.js` + `landmark-list.js` + `landmarks/<id>.js`: hand-made landmark models placed by latitude/longitude on whichever map covers them (Legislature, downtown skyline, Muttart, Hotel Macdonald, High Level Bridge, Rossdale plant, refineries, water tower, Lafarge, container yard, Snow Valley). `landmark-studio.html?id=<id>` renders one model from four angles for checking; `landmarks/_example.js` documents the module contract (`ctx.ground` follows real terrain, `ctx.onRoad` keeps props off streets). `excludeBox: [halfW, halfD, offsetE, offsetS]` in the list clears generic buildings and trees under a site.
- `cars.js`: six team cars, each body lofted from its real dimensions.
  - The cars: Tesla Model X, Honda CR-V, Honda Accord, Lexus IS 300, Subaru Legacy, Kia Carnival.
  - Shape comes from the `side`, `plan` and `cabin` keyframes plus a per-car `section` style.
  - `details()` draws lights and grilles that are projected onto the body.
  - The file also holds the Bicycle, Cam's E-bike and the shared rider.
- `funrides.js`: hand-designed rides built from simple parts: Poutine, Oilers Jersey, Rogers Place and the Rocket.
  - The Rocket is locked until every achievement is done.
  - It has endless nitro, lifts off above 250 km/h and smashes through traffic.
- `traffic.js`: AI cars.
- `signals.js`: real signal positions, light cycle, stop lines and crosswalks.
- `pickups.js`: nitro cans.
- `powers.js`: the ? boxes (shield, turbo, fly, blast). Turbo comes up twice as often.
- `ending.js`: per-map finish cutscene. Only `home` ends with video games; the others are burger, noodles, beach, shopping and BBQ.
- `progress.js`: achievements and per-player stats.
- `leaderboard.js`, `supabase.js`: online features.

## Map data (`tools/build-maps.mjs`)

- Run `node tools/build-maps.mjs [id]`. It writes `public/maps/<id>.json` and `index.json`, which are committed.
- All sources are free and need no keys:
  - routes from the OSRM demo server
  - roads from OpenStreetMap (Geofabrik Alberta extract)
  - buildings from City of Edmonton Rooflines (SODA dataset `jpxi-a9a5`)
  - terrain from NRCan MRDEM-30
- It needs `tools/cache/alberta-latest.osm.pbf` (about 350 MB), from https://download.geofabrik.de/north-america/canada/alberta-latest.osm.pbf. `tools/cache/` is gitignored; the other downloads cache there automatically.
- Maps can have their own `start` (lon/lat) and `from` label; the two downtown maps start on 107 St by the Legislature (a public street). The route's elevation gets a 6.5 m hump where it crosses another road on a bridge over level ground (the DEM shows no structures).
- Building classes come from OSM tags, then City of Edmonton zoning polygons (`fixa-tstc`, cached per map), then OSM land use, then size. Footprints under a landmark's `excludeR` are dropped. Named buildings keep their OSM name (`n`) for signs.
- **Adding a map:** add it to `MAPS` in `tools/build-maps.mjs` and to `MAP_INFO` in `src/main.js`, rebuild, then add its id to BOTH `map in (...)` checks in `supabase/schema.sql` and re-run the SQL; otherwise posting times on that map fails.
- **Adding a landmark:** add an entry to `src/landmark-list.js`, write `src/landmarks/<id>.js`, check it with `landmark-studio.html`, then rebuild the maps so footprints under it are dropped and the route callout is written.

## Road lines (rule: don't break them again)

Lane lines were wrong from the first version on: short double-yellow lines popped up in the middle of one-way roads, yellow ran down wide one-way roads, and lines stepped sideways wherever OpenStreetMap's lane count changes. The cause was the renderer guessing where the centre line goes from road widths that had been smoothed separately from the lane count. To keep it fixed:

- **One source.** Lines, stop-line extents and the lanes traffic may use all come from `src/lane-layout.js`. `buildMarkings()` in `world.js` only turns its plan into meshes, `signals.js` and `route.lanes()` call it, and `tools/check-roads.mjs` checks the same plan. Don't place lane lines or lanes anywhere else.
- **No guessing.** Never decide one-way vs two-way from widths. The builder writes `route.ow` per sample: 1 = one-way carriageway, 0 = two-way road, 2 = unmarked lane at the ends (parking lots), plus `lanes`, `ctr` (centre turn lane), `right`, `left`, `laneFormat: 2` and `src` (the raw OSM layout, run-length encoded).
- **Clean as one unit.** In `tools/build-maps.mjs`, `cleanLaneLayout()` cleans the whole layout together. It only smooths away one-way/two-way flips under 30 m, merges lane-count changes under 80 m into a neighbour of the same kind, and keeps roundabouts. Then `laneEdges()` makes the edges. Never smooth or filter `lanes`, `ow`, `right` or `left` on its own. On one-way roads the right edge follows the through lanes, so turn bays open on the median side; two-way roads are centred on the route line.
- **No caps, no blocks.** Don't cap lane counts when drawing lines; `route.lanes()` caps at 4 only for traffic and pickups. Take sideways offsets at every route sample, never once per block.
- **The check.** `npm run build` runs `npm run check:roads` first and stops on any failure, so Vercel won't deploy broken lines. The check compares against the raw OSM layout in `route.src`, not just against the cleaned data, so a cleaning mistake fails. Run it after touching the builder, `public/maps/*.json`, `route.js`, `lane-layout.js`, `signals.js` or the road code in `world.js`. After changing lane logic, rebuild ALL maps (old map files draw no lines). Don't loosen its limits to make it pass; fix the data or the plan.
- The check covers geometry, not looks. After road changes, also screenshot a few lane-count changes, two-way stretches and signals in the game.

## Database (Supabase free tier)

- `supabase/schema.sql` is safe to re-run. After changing it, paste the whole file into Supabase → SQL Editor and run it.
- Authentication → Sign In / Providers → "Allow anonymous sign-ins" must be ON. Each browser gets an invisible anonymous player account.
- `scores`: the server stamps each score with the poster's account and name. Clients can't edit or delete scores.
- `player_progress`: each player sees only their own row. The name is set once, can't be changed, and must be unique.
- `leaderboard` view: each player's best time per map.

## Testing

- There are no unit tests. Check changes by running the dev server and driving the game with headless Chrome (puppeteer-core) and screenshots. Use `window.__game` to jump along the route (`S.s`), start races and finish.
- Test UI through real clicks. A past bug deleted the Start button handlers, and tests that started races via the hook didn't notice.
- After world or car changes, check fps (target 60) and menu load time on the biggest maps (`home`, `sherwood`).

## Wishlist (not done yet)

Engine and horn sounds plus music, police chasing speeders, buses and trucks, rain or night driving, house styles by era (bungalows vs two-storeys with front garages), LRT trains beside 114 St / 111 St.
