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
- Pushing to `main` deploys to production automatically (Vercel is connected to GitHub). **Never push to `main` (or deploy live) until the owner says so.** Finish and check work locally, show the owner, then ask. Work in progress goes on a branch. After an approved push, confirm with `npx vercel ls drive-home`.
- **No co-author lines.** Don't add `Co-Authored-By: Claude …` or "Generated with Claude Code" to commits or PRs. When merging helper-agent commits that carry one, squash or rewrite them.

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
  - A dev-only hook, `window.__game`, exposes `S`, `route`, `world`, `startRace`, `finish`, `selectMap`, `selectCar`, `activatePower`, `progress`, `traffic`, `nitroCans`, `mysteryBoxes`, `sound`, `orbit` and `cam` (`{pos, look, fov}` free camera, `null` to release) for automated checks. `sound.debug` gives the sound event counters, engine state (gear, rpm, pitch) and mute state.
- `route.js`: works in route space.
  - `s` = metres along the route; `lat` = sideways offset (+ = right). Convert with `toWorld(s, lat, h)`.
  - Models face -z, and `yaw = atan2(-tx, -tz)`.
- `world.js`: builds a map from its JSON:
  - terrain (carved under the road) and water
  - the road, curbs and sidewalks (broken at side streets), bridges (Walterdale arches on `home`) and lane markings
  - side streets that ramp into junctions; raised side roads (overpass decks, their ramps, the other half of a divided road beside a hump) and piers are drawn from heights the builder writes (see "Road structures")
  - buildings: each has a class (`c`: house, rowhouse, apartments, retail, industrial, office, civic, outbuilding, hotel, parking, church, school, bigbox) and `wallStyle()` picks the texture: house siding, stucco with balconies, brick (schools, civic, heritage zones), tilt-up panels for big boxes, ribbed metal for warehouses, glass towers, concrete slab towers, parkades; hip roofs on houses, parapets and rooftop units on flat roofs; `BRANDS` colours known chains
  - store signs (`buildSigns`): real business names on the road-facing wall plus roadside pylon signs for big lots, packed into one texture atlas
  - exit guide signs (`buildExitSigns`) from OSM ramp `destination` tags
  - trees, street lights and the finish banner
- `landmarks.js` + `landmark-list.js` + `landmarks/<id>.js`: hand-made landmark models placed by latitude/longitude on whichever map covers them (Legislature, downtown skyline, Muttart, Hotel Macdonald, High Level Bridge, Rossdale plant, refineries, water tower, Lafarge, container yard, Snow Valley). `landmark-studio.html?id=<id>` renders one model from four angles for checking; `landmarks/_example.js` documents the module contract (`ctx.ground` follows real terrain, `ctx.onRoad` keeps props off streets, `ctx.route` describes the driven road so models keep clear of it). In dev, a warning lists any landmark standing on the driven road; it must stay silent. `excludeBox: [halfW, halfD, offsetE, offsetS]` in the list clears generic buildings and trees under a site.
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
- `sound.js`: every sound, made live with Web Audio (oscillators, filtered noise, envelopes): no audio files, nothing fetched.
  - `sound.play(name, opts)` for one-shots (crash, smash, nitro, can, box, the four power stingers, beep/go, finish, record, achievement, unlock, passby, liftoff, click); `sound.update(dt, p)` every frame for the engine, wind, tyre squeal and nitro hiss; `hornStart/hornStop` (H key, touch 📯 button); `setMuted`/`toggleMute` (M key, 🔊 buttons on the HUD and menu, saved as `driveHome.muted`).
  - Engines per vehicle (`ENGINES`): five combustion presets with a simulated 7-gear box (the Legacy has a boxer burble), an electric whine (Model X, E-bike), freewheel ticks (Bicycle, E-bike coasting), the Rocket's roar that swells at lift-off, and fun-ride voices (Poutine kazoo kart, Oilers organ hover, Rogers Place chug). Horns per vehicle in `HORNS`.
  - The AudioContext starts on the first click or key, suspends while muted or the tab is hidden, and nothing throws without Web Audio. Event counters tick even when muted, for tests.
- `sound-studio.html` (dev page, `/sound-studio.html`): buttons for every sound, hold-to-honk horns, an engine panel (vehicle, speed, gas, nitro, drift…) with a test drive, and "Run the check", which renders each sound offline and reports peak, loudness and clean starts/ends. Use it after changing sounds.
- `leaderboard.js`, `supabase.js`: online features.

## Map data (`tools/build-maps.mjs`)

- Run `node tools/build-maps.mjs [id]`. It writes `public/maps/<id>.json` and `index.json`, which are committed.
- All sources are free and need no keys:
  - routes from the OSRM demo server
  - roads from OpenStreetMap (Geofabrik Alberta extract)
  - buildings from City of Edmonton Rooflines (SODA dataset `jpxi-a9a5`)
  - terrain from NRCan MRDEM-30
- It needs `tools/cache/alberta-latest.osm.pbf` (about 350 MB), from https://download.geofabrik.de/north-america/canada/alberta-latest.osm.pbf. `tools/cache/` is gitignored; the other downloads cache there automatically.
- `tools/cache/` is not in git; on a new computer it starts empty. The builder re-downloads routes, buildings, zoning and terrain by itself. The 350 MB `.pbf` is only read once to make `osm-corridor.json`, so it's needed only when that file is missing or must be re-extracted, for example after adding tags to `WAY_KEYS` such as `railway` for the hump fix. Download it by hand from the link above. A fresh download has newer OpenStreetMap data, so rebuilt maps may differ slightly.
- Maps can have their own `start` (lon/lat) and `from` label; the two downtown maps start on 107 St by the Legislature (a public street). Raised structures are decided here (see "Road structures"). Railways come from a separate one-time pass over the `.pbf` (`tools/cache/osm-rail.json`).
- Building classes come from OSM tags, then City of Edmonton zoning polygons (`fixa-tstc`, cached per map), then OSM land use, then size. Footprints under a landmark's `excludeR` are dropped. Named buildings keep their OSM name (`n`) for signs.
- **Adding a map:** add it to `MAPS` in `tools/build-maps.mjs` and to `MAP_INFO` in `src/main.js`, rebuild, then add its id to BOTH `map in (...)` checks in `supabase/schema.sql` and re-run the SQL; otherwise posting times on that map fails.
- **Adding a landmark:** add an entry to `src/landmark-list.js`, write `src/landmarks/<id>.js`, check it with `landmark-studio.html`, then rebuild the maps so footprints under it are dropped and the route callout is written.

## Road lines (rule: don't break them again)

Lane lines were wrong from the first version on: short double-yellow lines popped up in the middle of one-way roads, yellow ran down wide one-way roads, and lines stepped sideways wherever OpenStreetMap's lane count changes. The cause was the renderer guessing where the centre line goes from road widths that had been smoothed separately from the lane count. To keep it fixed:

- **One source.** Lines, stop-line extents and the lanes traffic may use all come from `src/lane-layout.js`. `buildMarkings()` in `world.js` only turns its plan into meshes, `signals.js` and `route.lanes()` call it, and `tools/check-roads.mjs` checks the same plan. Don't place lane lines or lanes anywhere else.
- **No guessing.** Never decide one-way vs two-way from widths. The builder writes `route.ow` per sample: 1 = one-way carriageway, 0 = two-way road, 2 = unmarked lane at the ends (parking lots), plus `lanes`, `ctr` (centre turn lane), `right`, `left`, `laneFormat: 2` and `src` (the raw OSM layout, run-length encoded).
- **Clean as one unit.** In `tools/build-maps.mjs`, `cleanLaneLayout()` cleans the whole layout together. It only smooths away one-way/two-way flips under 30 m, merges lane-count changes under 80 m into a neighbour of the same kind, and keeps roundabouts and ramps (30 m or longer) at their own lane counts. Then `laneEdges()` makes the edges. Never smooth or filter `lanes`, `ow`, `right` or `left` on its own. On one-way roads the right edge follows the through lanes, so turn bays open on the median side; two-way roads are centred on the route line.
- **No caps, no blocks.** Don't cap lane counts when drawing lines; `route.lanes()` caps at 4 only for traffic and pickups. Take sideways offsets at every route sample, never once per block.
- **Signals come from the real junction.** The builder writes each signal as `[s, stop, end]`. It picks the first OSM signal node actually on our road, then takes the stop line and the gap in the lane lines from where the cross streets meet the road. So the lines break across the whole junction, and the stop line plus crosswalk sit just before it.
- **No folds.** On a turn tighter than the road is wide, lines (`lane-layout.js`) and sidewalks (`world.js`) on the inside are left out. Sidewalks are also left out where they would lie on another stretch of the route (the U-turn at the Sherwood finish).
- **Same input everywhere.** `laneInput()` builds the lane data for both the game (`route.laneData`) and the checker. Never hand `lane-layout.js` a differently shaped object: once the checker passed while the game crashed because of that.
- **The check.** `npm run build` runs `npm run check:roads` first and stops on any failure, so Vercel won't deploy broken lines. The check compares against the raw OSM layout in `route.src`, not just against the cleaned data, so a cleaning mistake fails. It also fails when a stop line is inside a cross street, when lane lines run into a junction past the gap, and when a line folds back in real positions. Run it after touching the builder, `public/maps/*.json`, `route.js`, `lane-layout.js`, `signals.js` or the road code in `world.js`. After changing lane logic, rebuild ALL maps (old map files draw no lines). Don't loosen its limits to make it pass; fix the data or the plan.
- The check covers geometry, not looks. After road changes, also screenshot a few lane-count changes, two-way stretches and signals in the game, and run a real-click test: the game must still load and start.

## Road structures (rule: nothing raised on the driven road)

The DEM is bare earth, so bridges and overpasses have to be made up. On 2026-10-07 the game started lifting side bridges +6.5 m with 70 m straight ramps and piers, and the builder added +6.5 m humps to every short route bridge. Neither checked where things landed, so ramps, embankments and piers ended up across the lanes, and humps stacked into camel backs or rose over creeks. Fixed 2026-10-09. To keep it fixed:

- **The builder decides, the game draws.** `tools/build-maps.mjs` makes every raised structure:
  - **Route humps:** only where a road or railway really crosses under the route bridge. Lift only as much as `HUMP_CLEAR` needs. Ramps keep a 6% grade and a crest radius of at least `HUMP_RADIUS`. Neighbouring humps merge instead of adding. The lift goes into `route.lift`.
  - **`sideRoadStructures()`:** a side bridge that crosses OVER the route gets a deck `OVERPASS_CLEAR` above it (`o: 1`). The road pieces joined to its ends ramp down (`e: 1`) and are never raised inside the route corridor. Piers (`piers`) never stand on the route or any road. The other half of a divided road beside a hump rides level with us (`e: 1`). Side roads that meet a raised hump ramp stop at the embankment foot.
  - Raised pieces carry `h`, a height per point, and `world.js` just draws it; `junctionBlend` never drags a side road up a hump ramp.
- **Landmarks** use `ctx.route` to keep clear of the driven road (the High Level Bridge is fitted to it and drops steel that would stand in the lanes). The dev warning must stay silent on every map.
- **The check.** `tools/check-roads.mjs` (run by `npm run build`) also fails on:
  - a raised side road or deck less than 5 m above the route where it is on the route;
  - a pier on any road;
  - a hump that dips between decks;
  - a hump steeper than its limits or higher than `HUMP_MAX`.
- After changing structures, screenshot the overpasses and humps from the driver's view.

## Database (Supabase free tier)

- `supabase/schema.sql` is safe to re-run. After changing it, paste the whole file into Supabase → SQL Editor and run it.
- Authentication → Sign In / Providers → "Allow anonymous sign-ins" must be ON. Each browser gets an invisible anonymous player account.
- `scores`: the server stamps each score with the poster's account and name. Clients can't edit or delete scores.
- `player_progress`: each player sees only their own row. The name is set once, can't be changed, and must be unique.
- `leaderboard` view: each player's best time per map.

## Testing

- There are no unit tests. Check changes by running the dev server and driving the game with headless Chrome (puppeteer-core, a dev dependency) and screenshots. Use `window.__game` to jump along the route (`S.s`), start races and finish.
- `node tools/dev/shots.mjs <map> <s,s,...>` saves a driver's view and a high view at each route position and prints fps. Write other throwaway test scripts outside the repo.
- Test UI through real clicks. A past bug deleted the Start button handlers, and tests that started races via the hook didn't notice.
- After world or car changes, check fps (target 60) and menu load time on the biggest maps (`home`, `sherwood`).

## Status and handoff (2026-10-08)

The owner switched computers mid-task. This section is the compressed history and the to-do list; delete items as they get done.

### Where things are

- **Live** (`main`, deployed 2026-10-09 with the owner's OK): 8 maps, landmarks, the map-select screen, building styles, store and exit signs, the online leaderboard and achievements. Also live: the road-line rewrite, the road-structure fix, signals at real junctions and the sound effects.
- **In progress:** a performance pass for the owner's report of fps dropping to ~30 on their Retina MacBook. It covers adaptive resolution, camera far matched to the fog, precompiled shaders, no runtime building, and lighter distant traffic. Work in progress goes on a branch, and it goes live only after the owner checks it locally and says so.

### Owner to-dos

- If not already done since 2026-10-07: paste all of `supabase/schema.sql` into Supabase → SQL Editor and run it. Its map list now includes `snowvalley` and `refinery`; without it, posting times on those two maps fails.
- `menu.png` and `race.png` in the project folder are old screenshots and can be deleted.

### Unfinished work, in order

1. **Things on the driven road:** done 2026-10-09 (see "Road structures"). Left, cosmetic:
   - Sidewalk folds over the lanes on the ~5 m turn near the sherwood finish (s 22064–22194). The route itself turns that sharply; smoothing very sharp corners in the builder would fix it.
   - Side roads clip the underside of some real road bridges (home s 8174–8231; refinery s 1359–1810 and 11350–11424). Off the driven road.
2. **Sound effects: done 2026-10-09, waiting for the owner to listen.** `src/sound.js` + `sound-studio.html` (see the code map). Tested: each event plays once, no audio-node leak over 2 minutes of busy driving, 60 fps on home and sherwood, no clipping or clicks in offline renders, works with Web Audio missing. Still to do: the owner auditions everything in `/sound-studio.html` and in a drive, then says what to change. Music stays on the wishlist.
3. **Road lines across all 8 maps: reviewed 2026-10-09** (about 265 spots screenshotted). The core rules held. Fixed after the review:
   - signals at the wrong junction (lines ran through about a dozen intersections, a stop line mid-block, a missing signal on Terrace Rd);
   - folded lines and a sidewalk across the lanes at the Sherwood finish U-turn;
   - ramps painted with a neighbour's lane count;
   - a 100 m dash gap around divided/undivided changes (now about 50 m);
   - stub dashes.
4. **Owner's choice (ask before doing):**
   - Real Alberta divided roads and freeways have a **yellow left edge line** along the median. Not done, because yellow on one-way roads is exactly what upset the owner before.
   - Residential collectors (88 St SW, Savaryn Dr, Rainbow Valley Rd) often have no edge lines or centre line in real life; `route.cls` could tone them down.
5. **Lane-line follow-ups** (lower priority):
   - The kerb bulges a little where a divided road meets an undivided one.
   - On two-way roads where the split flips (2+3 to 3+2, snowvalley 114 St s 2818–3240), both kerbs slide 3.5 m while the yellow stays put.
   - `turn:lanes` / `lanes:both_ways` aren't extracted.
   - Lane-0 traffic glides 3.5 m when a two-way road adds a lane on the right.
   - Edge lines aren't broken at side-street mouths, only at signals.
   - About 730 m of untagged Ellerslie Rd SW (windermere s 7528–8258) takes 1 lane from a short tagged piece; check against aerial photos.

### How the road-line fix works (2026-10-08)

The owner reported a double yellow appearing in the middle of a one-way road (91 St SW, ~450 m after the Summerside start) and said it was "broken again". The history showed the line code and lane data had never changed since the first commit: the bug was there from day one. The fix, its rule and its check are under "Road lines" above.

### Compressed history

- **Oct 5:** 3D Three.js game: beat the commute on real Edmonton roads.
  - Maps from the Summerside start (91 St SW, a public spot): Downtown (ends by the Legislature), Windermere, Sherwood Park, Odd Burger, Summerside Beach Club, Noodle Feast.
  - The team's six cars, Cam's E-bike, a plain Bicycle, and fun rides (Poutine, Oilers Jersey, Rogers Place; the Sofa was removed later).
  - Nitro cans and ? boxes, smoother road surfaces, and the Vercel + GitHub + Supabase setup.
  - Online leaderboard with one fixed name per player; achievements that unlock the Rocket (endless nitro, lifts off above 250 km/h); themed endings per map; a pinned Start button.
  - A modelling overhaul of cars, rocket, roads, buildings, trees and signals.
- **Oct 6:** CLAUDE.md written so work can continue from another computer.
- **Oct 7:**
  - Building styles from zoning, store and exit signs, overpasses and humps.
  - Two downtown routes: Snow Valley to the south, Refinery Row to the east.
  - A new map-select screen (route maps, stars, badges, rush-hour bar, rank).
  - 13 hand-made landmarks with HUD callouts.
- **Oct 8:** landmark fixes (refinery follows the terrain, the Legislature terrace is off the road, callout sides fixed), then the road-line rewrite above, the road audit (to-do 1) and the sound request (to-do 2). The owner asked: approve before any deploy, and no co-author lines.

### Landmark caveats (unverified details)

- Legislature portico column count.
- Rossdale heights and windows.
- Lafarge yard layout (invented).
- Water tower colours and lettering.
- Suncor lies outside every map's terrain, so it never shows.

## Wishlist (not done yet)

Music (sound effects are done, see `sound.js`), police chasing speeders, buses and trucks, rain or night driving, house styles by era (bungalows vs two-storeys with front garages), LRT trains beside 114 St / 111 St.
