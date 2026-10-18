# Drive Home

A 3D browser driving game on real Edmonton roads: beat the rush-hour commute.
Three.js + Vite, plain JavaScript ES modules, no framework.

- Live: https://drive-home-beta.vercel.app (Vercel project `drive-home`)
- Repo: https://github.com/stanqiu111/drive-home (private)

## Working with the owner

- The owner is not a programmer. Do the work end to end, check it yourself (screenshots, test drives), and explain results simply.
- **No paid APIs.** No API keys and no Claude/Anthropic API calls from the game. Free data and free tiers only.
- **Privacy:** never put the owner's real home or start address in code, map data, UI or commits. On purpose, the routes start at a public spot on 91 St SW (Summerside) and the Downtown map ends by the Alberta Legislature.
- Keep the data attribution credits in the menu (OpenStreetMap, City of Edmonton, NRCan) and the sound credits (`SOUND_CREDITS` in `sound.js`).
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
node tools/build-maps.mjs [id]   # rebuild maps (see "Map data")
node tools/build-osm-tiles.mjs   # refresh public/osm/ from the Alberta .pbf (see "Map data")
```

- Needs Node `^20.19` or `>=22.12` (Vite 8).
- Online features need `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Get it with `npx vercel login`, `npx vercel link`, then `npx vercel env pull .env.local`. Without it, the game still works and the leaderboard and online progress are hidden.

## Code map (`src/`)

- `main.js`: game loop, menu, HUD, race flow, driving physics, collisions, cameras, leaderboard and achievements UI.
  - `MAPS` = `public/maps/index.json` (written by the builder: km, route polyline, street list, lights, curves, bridge/highway metres, climb, landmarks) merged with `MAP_INFO` (destination label, 2-sentence description, cheer, ending theme). Add new maps to `MAP_INFO` and to `NEW_MAPS` for the "New" badge.
  - The map-select screen groups routes by start point (`GROUPS`), draws north-up route maps as inline SVG, difficulty stars and badges from the index facts, and a detail panel with description, rush-hour race bar and online rank.
  - HUD landmark callouts come from `data.landmarks` in each map file. The HUD only writes to the page when a value changed.
  - Loading a map (`selectMap`) never freezes the menu: the new world is built in ~8 ms slices while the old one stays on screen, its shaders are compiled in the background (`warmUp`: `compileAsync` on one stand-in per distinct shader, textures uploaded, bounding spheres computed), then it replaces the old world, whose GPU memory is freed. Picking another map meanwhile cancels the build. Map files are prefetched after the first map is shown.
  - Resolution (`PIXEL_BUDGET`, `applyResolution`, `adaptResolution`): the 3D view uses at most ~3M pixels, never more than the screen's pixel ratio, recomputed on resize and when the window moves to another screen; while racing, slow GPU-bound frames lower it in 15% steps and it climbs back when frames are steady. The menu draws every other frame.
  - A dev-only hook, `window.__game`, exposes `S`, `route`, `world`, `signals`, `renderer`, `effects`, `res` (resolution state), `startRace`, `finish`, `selectMap`, `selectCar`, `activatePower`, `progress`, `traffic`, `nitroCans`, `mysteryBoxes`, `sound`, `orbit` and `cam` (`{pos, look, fov}` free camera, `null` to release) for automated checks. `sound.debug` gives the sound event counters, engine state (gear, rpm, pitch, `source`: recorded or synth), the recordings' load state (`samples`) and mute state.
- `route.js`: works in route space.
  - `s` = metres along the route; `lat` = sideways offset (+ = right). Convert with `toWorld(s, lat, h)`.
  - Models face -z, and `yaw = atan2(-tx, -tz)`.
- `world.js`: builds a map from its JSON (`buildWorld`, async, in slices; it returns the world without adding it to the scene). Sky, fog and sunlight are scene-wide (`setupSky`), shaders depend on them. Everything big is cut into ~500 m pieces (`CHUNK`; terrain in 16-cell tiles) so pieces out of view aren't drawn; keep it that way when adding things. Texture noise uses a fixed seed (a map looks the same every load):
  - terrain (carved under the road) and water
  - the road, curbs and sidewalks (broken at side streets), bridges (Walterdale arches on `home`) and lane markings
  - side streets that ramp into junctions; raised side roads (overpass decks, their ramps, the other half of a divided road beside a hump) and piers are drawn from heights the builder writes (see "Road structures")
  - buildings: each has a class (`c`: house, rowhouse, apartments, retail, industrial, office, civic, outbuilding, hotel, parking, church, school, bigbox) and `wallStyle()` picks the texture: house siding, stucco with balconies, brick (schools, civic, heritage zones), tilt-up panels for big boxes, ribbed metal for warehouses, glass towers, concrete slab towers, parkades; hip roofs on houses, parapets and rooftop units on flat roofs; known chains get their brand colours (`brandLook()` from `brands.js`)
  - brand buildings and signs (`brand-sites.js`, see below), which replaced the old store-sign code
  - exit guide signs (`buildExitSigns`) from OSM ramp `destination` tags
  - trees, street lights and the finish banner
- `landmarks.js` + `landmark-list.js` + `landmarks/<id>.js`: hand-made landmark models placed by latitude/longitude on whichever map covers them (Legislature, downtown skyline, Muttart, Hotel Macdonald, High Level Bridge, Rossdale plant, refineries, water tower, Lafarge, container yard, Snow Valley; added 2026-10-10 for custom routes across the city: West Edmonton Mall, Rogers Place, City Hall, Art Gallery of Alberta, Royal Alberta Museum, Commonwealth Stadium, TELUS World of Science, Convention Centre, Southgate, Kingsway, Talus Dome). Rogers Place is its own model now, no longer part of the skyline. Shared modelling helpers are in `landmarks/_kit.js` (no `build()`, so it's never placed). Landmarks get no environment map in the game, so glass and metal look darker than in a studio: check with `landmark-studio.html?id=<id>&env=0` (game lighting; `&views=az,el;…` and `&target=x,y,z` set the cameras) and use `glass()` from `_kit.js` or 'glossy' with low metalness. `landmark-studio.html?id=<id>` renders one model from four angles for checking; `landmarks/_example.js` documents the module contract (`ctx.ground` follows real terrain, `ctx.onRoad` keeps props off streets, `ctx.route` describes the driven road so models keep clear of it). The road check (is any landmark standing on the driven road?) is slow, so it only runs on request: open the game with `?checkLandmarks`, or run `node tools/dev/check-landmarks.mjs [port]` with the dev server up; it must report 0 on every map. `excludeBox: [halfW, halfD, offsetE, offsetS]` in the list clears generic buildings and trees under a site.
- `cars.js`: six team cars, each body lofted from its real dimensions.
  - The cars: Tesla Model X, Honda CR-V, Honda Accord, Lexus IS 300, Subaru Legacy, Kia Carnival.
  - Shape comes from the `side`, `plan` and `cabin` keyframes plus a per-car `section` style.
  - `details()` draws lights and grilles that are projected onto the body; `c.side()` draws on the flanks (also as a darker paint patch for sculpted sides).
  - Opt-in per-car options (defaults keep the other cars unchanged; each is documented where it's defined): `nose`/`tail` (end rounding), `wrap` (how far front/rear decals wrap round the corners; also per decal as the helpers' last argument), `sag` (decal split tolerance), `mirror: { u, y, out, dx, dy, mat, armMat }`, `handleMat`, `rim: { size, lip, split, spoke }`, `section.sill` / `mold` / `faceFade` (black sill band, arch cladding width, no dark streaks on rounded bumpers), `glassFrame`, `cabinStations`, `rearWheel: { r, w }` (bigger, wider rear tyres, for the supercars; each wheel spins at its own size), a 4th value in `cabin` keyframes (the glass house's width at its base, for the McLaren's canopy narrower than the body), `brakeLight: false` (no third brake light above the rear window, the 911 has it on its wing); a negative `section.crown` (−0.06 to −0.1) lifts the fender crests above the hood, the dipped hood of a supercar; decal helpers `c.side()` (follows the flank's curve, optional shading), `c.sideFlat()`, `c.panel()`, `c.at()`, and an `'amber'` material. After changing shared code, check the other cars still render pixel-identical (hash the car-studio canvas before and after).
  - **Matched to the makers' official photos (2026-10-10)**, the owner's request ("go to their official website to match the exact design"): each car's maker publishes a 360° studio spin or studio photos; the matching fits a camera to the wheel positions in a photo, renders our car from it and overlays the outlines. Model years: Model X current body (2021 refresh; tesla.com/en_ca now says it's out of production), CR-V 2026 (2023+ body), Accord 2026 (2023+), Lexus IS 2027 (the 2026 facelift; Canada now sells only the IS 350, same body as the IS 300), Legacy 2025 Limited (the last year; black window frames), Carnival 2027 SX (the 2025 facelift: Star Map lights, full-width tail bar). Ask the owner before changing a car to another year. Width figures: some makers (Honda Canada's 2150 mm for the CR-V) include the mirrors.
  - Traffic uses `makeTrafficCar`: the same model in 10 meshes instead of 28 (parts that differ only in colour, roughness and metalness share a material through tiny palette textures; tyres and discs are static; the two rims of an axle spin as one), pixel-identical up close, and beyond 60 m (`LOD_FAR`, back within 50 m) a simpler version (coarser body and tyres, flat grille/plate colours). The player's car keeps full detail (`makeCar`). After changing a car, compare traffic renders at 10 m and 60 m too.
  - The file also holds the Bicycle, Cam's E-bike and the shared rider.
- `brands.js` + `brand-sites.js`: **brand buildings** (the owner asked to "build brand on the road", 2026-10-10). Chains look like their real buildings from the road: gas stations get a canopy on columns with brand stripes and logos, pumps, a forecourt and a roadside price sign; McDonald's, Tim Hortons, A&W, Wendy's, KFC, Taco Bell, DQ, Starbucks, Boston Pizza, Five Guys and others get their facade colours, towers, roof bands and pole signs; banks a stone building with the brand band; big boxes a branded entrance portal with glass doors; hotels a brand band and logo; car dealers the maker's emblem and a glass showroom; strip malls a sign per tenant and a plaza pylon. Data: the builder's `n`/`br`/`k`/`ps` on buildings and `pois` (see "Map data").
  - `brands.js`: the brand table `BRANDS` (213 chains). Each entry is matched on the OSM `brand` tag first, then the name, and holds `kind`, colours `c`, logo drawings `badge` (square) and `word` (wide), `look`, `fuel` colours, `pylon` (tall/low/price) and `box` (big-box wall and band); also `LOOKS` (restaurant, cafe and bank buildings) and `brandLook()`. Logos are drawn in code on a canvas, never downloaded (they use macOS fonts such as Brush Script and Arial Black; other systems fall back to generic fonts).
  - `brand-sites.js`: `planBrandSites()` gives each footprint a role (gas canopy/shop, standalone restaurant or bank, big box, hotel, dealer, mall, store or name) and lists the footprints world.js must skip (duplicate City/OSM outlines, buildings it redraws); `buildBrandSites()` draws up to 3 meshes per 1 km square from two atlas pages (logos and patterns; business names by priority, so on Downtown ~300 minor tenants don't fit and aren't shown). Roadside signs only go where an exact check finds no road, sidewalk, building or forecourt; one pylon per name within 150 m; none in the first 30 m or the last 60 m of a route (the ending camera).
  - **Adding a brand:** one line in `BRANDS`; text only is enough (`{ id, re, kind, c: { main, fg }, text, font, pylon }`), optionally a `badge`/`word` drawing, a `look`, `fuel` or `box` colours. No map rebuild needed. Screenshot it from the road, and run `node tools/dev/check-brands.mjs` (nothing from brand sites may stand on the driven road; it must report 0 on every map, like the landmark check).
- `supercars.js` + `supercars/<id>.js`: the garage's **Supercars** row (the owner asked for "fancy cars like 跑车", 2026-10-10): Lamborghini Revuelto, Ferrari 296 GTB, Porsche 911 Turbo S, McLaren 750S. One module per car in the CAR_MODELS format (helpers in `supercars/_shape.js`); `cars.js` merges them into CAR_MODELS, and `super: true` gives them their own garage row and keeps them out of traffic. They're faster than the team cars (top speed ×1.34-1.40, acceleration ×1.5-1.6). Like the team cars, each is modelled from the maker's own configurator images and specifications (2026-10-13): Revuelto 2024-27, 296 GTB 2022-26, 911 Turbo S 992.2 (2026-27), 750S 2023+. Known gaps: no scissor/dihedral door animation, the Revuelto's wing and engine-cover hexagons, the 296's real side scoop, the 911's yellow ceramic calipers (caliper colour is shared), see-through glass. Official image sources that work without a key: Lamborghini's configurator render service (`configuratormedia.lamborghini.com/renderservice/renderapi/v2/urls`), Ferrari's configurator (`carconfigurator.ferrari.com/f171/...beautyshot_ext_*`), Porsche's configurator renders (fixed angles, transparent background), McLaren's live 3D configurator (camera matrices readable). After changing one, render it in car-studio and compare.
- `funrides.js`: hand-designed rides built from simple parts: Poutine, Oilers Jersey, Rogers Place and the Rocket.
  - The Rocket is locked until every achievement is done.
  - It has endless nitro, lifts off above 250 km/h and smashes through traffic.
- `traffic.js`: AI cars.
- `signals.js`: real signal positions, light cycle, stop lines and crosswalks. All signals of a 1 km stretch share one mesh per material; the lamps glow through a small state texture.
- `effects.js`: explosion debris and tyre smoke (two instanced meshes), shockwave rings and the flash light (always in the scene at zero brightness: adding or removing a light recompiles every shader).
- `pickups.js`: nitro cans.
- `powers.js`: the ? boxes (shield, turbo, fly, blast). Turbo comes up twice as often.
- `ending.js`: per-map finish cutscene. Only `home` ends with video games; the others are burger, noodles, beach, shopping and BBQ.
- `progress.js`: achievements and per-player stats.
- `sound.js`: every sound, with Web Audio. Car engines, the turbo whistle and blow-off, tyre squeal, the Model X drive sound, the E-bike motor and the Rocket roar are **real recordings** (see "Sounds"); everything else is made live (oscillators, filtered noise, envelopes).
  - `sound.play(name, opts)` for one-shots (crash, smash, nitro, can, box, the four power stingers, beep/go, finish, record, achievement, unlock, passby, liftoff, blowoff, click); `sound.update(dt, p)` every frame for the engine, wind, tyre squeal and turbo whistle; `hornStart/hornStop` (H key, touch 📯 button); `setMuted`/`toggleMute` (M key, 🔊 buttons on the HUD and menu, saved as `driveHome.muted`).
  - Engines per vehicle (`ENGINES`), all driven by a simulated 7-gear box. Each car's `rec` picks its recorded engine (`pack`: `i4` inline four for the CR-V and Accord, `b4` boxer for the Legacy, `i6` straight six for the IS 300 and, muffled, the Carnival), its rpm range, tone (low-pass, EQ), level and factory turbo whistle. `RecEngineVoice` works like racing games: steady-rpm loops recorded on throttle and off it, each pitched around the rpm it was recorded at and crossfaded by rpm and throttle; an upshift briefly lifts the throttle. Nitro or the turbo power spool up a real turbo whistle; letting go plays the blow-off. The Model X layers a real Tesla drive recording under a soft whine, the E-bike a real brushless motor, the Rocket a jet afterburner. The Bicycle and the fun rides (Poutine kazoo kart, Oilers organ hover, Rogers Place chug) stay synthesised. The supercars have their own recorded packs: `v8` (a Ferrari 360 V8) for the 750S and the 296, `v12` (a Lamborghini) for the Revuelto, and `f6` (a Porsche idle with the boxer-four rev loops) for the 911, with factory turbo whistles on the turbo cars. Horns per vehicle in `HORNS`.
  - The recordings load in the background after the first click or key (`Samples`, four files, about 370 KB). Until they arrive, or if they fail, every voice uses the old synthesised one (`IceVoice` etc.), so the game never waits for audio. `sound.useRecordings = false` forces the synth (the studio's compare switch).
  - The AudioContext starts on the first click or key, suspends while muted or the tab is hidden, and nothing throws without Web Audio. Event counters tick even when muted, for tests.
- `sound-samples.js`: generated list of where each recorded loop sits in `public/sounds/*.m4a`, its rpm and length. Don't edit by hand (see "Sounds").
- `sound-studio.html` (dev page, `/sound-studio.html`): buttons for every sound, hold-to-honk horns, an engine panel (vehicle, speed, gas, nitro, drift…) with a **Recorded / Synth** switch, a scripted test drive (idle, revs, full throttle through the gears, nitro, lift off with blow-off, drift, braking), turbo-spool and squeal buttons, and "Run the check", which renders each sound offline and reports peak, loudness, clean starts/ends, clean loop seams and smooth rpm crossfades. Use it after changing sounds.
- `leaderboard.js`, `supabase.js`: online features.
- `custom-route.js`: the "Your routes" feature (see "Custom routes"): the builder screen (address search, route preview, progress bar), saving maps on the device (IndexedDB) and loading them back.
- `mapgen/`: the map builder, shared by `tools/build-maps.mjs` (Node) and the custom-route builder (browser). `core.js` is all the building logic (`buildMapData`, projection, lane cleaning, structures, buildings, signals), `osm-tiles.js` reads the OpenStreetMap tiles in `public/osm/`, `dem.js` reads NRCan terrain, `edmonton.js` has the city limits and route limits, `worker.js` runs a custom build in a background thread.
- `car-studio.html` (dev page, `/car-studio.html?id=crv`): one car from six angles (`ortho=1` for front/side/rear/top with a 0.5 m grid, `traffic=1`, `far=1`), with its measured size in `window.info`. Screenshot it with `node tools/dev/studio-shot.mjs "<url>" out.png`. Use it to compare a car with the maker's official photos.

## Map data (`tools/build-maps.mjs`, `src/mapgen/`)

- Run `node tools/build-maps.mjs [id]`. It writes `public/maps/<id>.json` and `index.json`, which are committed. The building logic lives in `src/mapgen/core.js` (shared with custom routes); `build-maps.mjs` only fetches, caches and writes. After any change to `core.js`, rebuild all maps and look at `git diff --stat public/maps`: a refactor must leave every map byte for byte the same.
- All sources are free and need no keys:
  - routes from the OSRM demo server
  - roads, railways, traffic signals and named places from OpenStreetMap, read from the tiles in `public/osm/`
  - buildings from City of Edmonton Rooflines (SODA dataset `jpxi-a9a5`)
  - zoning from City of Edmonton (`fixa-tstc`)
  - terrain from NRCan MRDEM-30 (a cloud-optimised GeoTIFF on S3, read with range requests)
- **OpenStreetMap tiles** (`public/osm/`, committed, about 57 MB in 734 files): all of Edmonton plus ~4.5 km, cut into 0.025° × 0.015° tiles by `node tools/build-osm-tiles.mjs` (about 30 s). Each tile holds every kept way touching it (roads, buildings, land-use areas with `WAY_KEYS` tags; railways; a road or railway that leaves the covered area keeps its parts inside it, as ways with id × 1000 + part, while closed outlines are all or nothing), the traffic-signal nodes and the named places (`POI_KEYS`: shops, restaurants, gas stations…). Format: top of `src/mapgen/osm-tiles.js`. The builder and the game read the same tiles, so built-in and custom maps get the same data. Public Overpass servers turn browsers away (HTTP 406), which is why the game serves this data itself.
- The tiles come from `tools/cache/alberta-latest.osm.pbf` (about 350 MB, https://download.geofabrik.de/north-america/canada/alberta-latest.osm.pbf). It's needed only to refresh the tiles: after changing what is kept (`WAY_KEYS`, `RAIL_KEYS`, `POI_KEYS`, `osmWayKind`, `isRail`, `isPoi`) or to pick up newer OpenStreetMap data; then rebuild every map. Regenerating adds ~20 MB to the git history each time, so don't do it casually. The old `osm-corridor.json` / `osm-rail.json` caches are no longer used.
- `tools/cache/` is not in git; on a new computer it starts empty. The builder re-downloads routes, buildings and zoning by itself (terrain is never cached).
- **Business names and brands**: each named OpenStreetMap place lends its name, brand and kind to the footprint it stands in. Buildings carry `n` (name; footprints over 150 m²), `br` (OSM `brand`), `k` (its amenity/shop/tourism/leisure/office value: `fast_food`, `fuel`, `bank`…) and `ps` (other named tenants, `[[name, brand, kind], …]`). Places not inside a drawn footprint and within 200 m of the road go to `pois: [{ k, n?, br?, x, z }]` (gas stations mapped as a point, kiosks).
- A building the road passes through (its corners can be far from the road, like a mall parkade a custom route starts in) is dropped, like one whose corners are on the road.
- Maps can have their own `start` (lon/lat) and `from` label; the two downtown maps start on 107 St by the Legislature (a public street). Raised structures are decided here (see "Road structures"). Railways come from a separate one-time pass over the `.pbf` (`tools/cache/osm-rail.json`).
- Side roads are kept only on the map's own ground (`clipRoadsToGround`: within `TERRAIN_RADIUS` + 100 m of the route). OpenStreetMap ways are first kept near the routes (`osmNearRoutes`: roads within ~550 m, buildings ~450 m, railways 300 m). For the built-in maps that filter uses all eight routes together (as the old corridor extract did); a custom map uses only its own route. So a built-in map also gets far side streets, and OSM names, places and building types for its far skyline towers, where another route passes nearby (a custom build of the same route has fewer far streets, and some towers ~550 m+ away lose their name or change style). It also means adding a ninth map to `MAPS` changes the other maps' files on the next rebuild: check that diff, it isn't a regression.
- Building classes come from OSM tags, then City of Edmonton zoning polygons (`fixa-tstc`, cached per map), then OSM land use, then size. Footprints under a landmark's `excludeR` are dropped. Named buildings keep their OSM name (`n`) for signs.
- **Adding a map:** add it to `MAPS` in `tools/build-maps.mjs` and to `MAP_INFO` in `src/main.js`, rebuild, then add its id to BOTH `map in (...)` checks in `supabase/schema.sql` and re-run the SQL; otherwise posting times on that map fails.
- **Adding a landmark:** add an entry to `src/landmark-list.js`, write `src/landmarks/<id>.js`, check it with `landmark-studio.html`, then rebuild the maps so footprints under it are dropped and the route callout is written.

## Sounds (`tools/sounds/build-sounds.mjs`)

The owner asked for real engine sounds ("turbo speed sound is not real, find a real engine source sound"), so engines and car effects are cut from real recordings.

- Every recording is **CC0** (public domain) on Freesound.org and is fetched as Freesound's public preview MP3 (no account, no key). No credit is required; the menu credits them anyway (`SOUND_CREDITS`).
- Run `node tools/sounds/build-sounds.mjs` (macOS: it uses `/usr/bin/afconvert` to decode MP3 and encode AAC). It downloads the sources into `tools/cache/sounds/` (gitignored) and writes `public/sounds/engine-i4.m4a`, `engine-boxer.m4a`, `engine-six.m4a`, `effects.m4a` (AAC, 32 kHz mono, 96 kbps; with the supercar packs `engine-v8.m4a`, `engine-v12.m4a`, `engine-flat6.m4a` about 510 KB together) and `src/sound-samples.js`. All of those are committed. A rebuild from the same sources gives the same audio (only the files' timestamps change), so commit new sound files only when the sources or cuts changed.
- How a loop is made: `trackCycle()` follows the engine cycle (two crank turns) through the recording, `flatten()` resamples a stretch of an rpm sweep to one steady rpm, `evenOut()` removes slow level swings so the loop doesn't pulse, and `makeLoop()` crossfades whole engine cycles into the start so there is no seam. In the file each loop has a copy of its end before it and its start after it, so the game loops cleanly from `at` to `at + len` (`sound-samples.js`).
- **Replacing or adding a sample:** add the recording to `SOURCES` in `tools/sounds/sources.mjs` (CC0 only; anything else needs the owner's OK and a credit), then add a loop to a pack in `PACKS` (`t` = centre time in seconds, `rpm` = rough rpm there, `cycles` = about 0.3–1 s worth, `load` = on or off throttle) or an item to `FX`, and run the tool. Its log prints each loop's measured rpm and a seam score (a click would show near 0). Then open `/sound-studio.html`, run the check (seams, crossfades, peaks) and listen to the test drive. A new engine type also needs an entry in `ENGINE_SETS` and a `rec.pack` in `ENGINES` (`sound.js`).

| Used for | Recording | Author | License |
|---|---|---|---|
| Inline four (CR-V, Accord): Mercedes-Benz 190E 2.3-16V on a dyno, exhaust mic | [19_2500_D6](https://freesound.org/people/Chippy569/sounds/162509/), [17_ShortSweep_D6](https://freesound.org/people/Chippy569/sounds/162501/), [20_6500_D6](https://freesound.org/people/Chippy569/sounds/162512/), [21_500_D6](https://freesound.org/people/Chippy569/sounds/162515/), [21_2500_D6](https://freesound.org/people/Chippy569/sounds/162518/), [17_MedSweep_D6](https://freesound.org/people/Chippy569/sounds/162504/), [21_6500_D6](https://freesound.org/people/Chippy569/sounds/162521/) | Chippy569 | CC0 |
| Boxer four (Legacy): Scion FR-S (Subaru FA20) dyno pull | [DynoJet Scion FR-S](https://freesound.org/people/dezoris/sounds/183654/) | dezoris | CC0 |
| Boxer idle (Legacy): 2003 Subaru Impreza WRX | [WRX - Exhaust sounds](https://freesound.org/people/ulose2piranha/sounds/273334/) | ulose2piranha | CC0 |
| Straight six (IS 300, Carnival) and the turbo whistle: Toyota Supra 2JZ on a dyno | [Import car revs on Chassis Dyno with Turbo](https://freesound.org/people/editboy23/sounds/496171/) | editboy23 | CC0 |
| Tyre squeal | [Chrysler LHS tire squeal 04](https://freesound.org/people/audible-edge/sounds/71739/) | audible-edge | CC0 |
| Rocket roar: turbojet afterburner | [Afterburner](https://freesound.org/people/TiesWijnen/sounds/413312/) | TiesWijnen | CC0 |
| Model X drive sound: Tesla Model S Plaid, full throttle | [Acceleration of an electric car](https://freesound.org/people/justVova/sounds/761685/) | justVova | CC0 |
| E-bike motor: brushless drill motor | [DeWalt 18V Cordless Combi Drill](https://freesound.org/people/megashroom/sounds/390162/) | megashroom | CC0 |
| Blow-off valve and nitro burst: compressed-air line released | [release_air_pffft](https://freesound.org/people/reg7783/sounds/131302/) | reg7783 | CC0 |
| Supercar V8 (McLaren 750S, Ferrari 296): Ferrari 360 Spider flat-plane V8, parked, mic above the engine | [Ferrari 360 Spider - engine sound](https://freesound.org/people/PritzProductions/sounds/241083/) | PritzProductions | CC0 |
| Supercar V12 (Lamborghini Revuelto): Lamborghini at a dealer, phone video (harmonics fit a V12) | [Lambo idle and rev.mp3](https://freesound.org/people/cheesepuff/sounds/112075/) | cheesepuff | CC0 |
| Porsche 911 idle (it revs on the FR-S boxer dyno loops) | [Porsche idle.aif](https://freesound.org/people/victormalloy/sounds/113216/) | victormalloy | CC0 |

- Not found as CC0 and therefore not used: a clean V6 (the six is a straight six, which shares the V6's firing rhythm; the Ferrari 296 uses the Ferrari V8), a real blow-off valve (a compressed-air release stands in), a clean electric-motor whine (the Model X whine stays synthesised, quietly, over the real Tesla recording), a flat six revving (the 911 revs on the boxer-four loops), and any supercar dyno pull or onboard run: the supercar packs (`engine-v8.m4a`, `engine-v12.m4a`, `engine-flat6.m4a`) come from parked cars revved by hand, so they top out around 4,400 rpm and the supercars' rev ranges are set to match.

## Custom routes (`src/custom-route.js`, `src/mapgen/`)

The owner asked for "a customized route, but have to be inside of edmonton … when user input both start and end address, with a progress bar build your map, need match quality with current route". In the menu, "Your routes" → **New route**:

1. The player types a start and a finish. Suggestions come from Photon (komoot) as they type; Enter falls back to Nominatim (its rules forbid search-as-you-type). Both are limited to Edmonton's box, and anything outside the city limits (`insideEdmonton`, OSM relation 2564500) is dropped. "53.52, -113.62" also works.
2. OSRM plans the drive; the screen shows a north-up preview and the distance. Routes must be 1-50 km (`CUSTOM_MIN_KM`, `CUSTOM_MAX_KM` in `edmonton.js`).
3. **Build this map** starts `src/mapgen/worker.js` in a background thread with a progress bar: OpenStreetMap tiles along the route from the game's own `public/osm/`, then `buildMapData()` (the same function the built-in maps use) with City rooflines and zoning and NRCan terrain downloaded live. A 10 km route takes about 5 s, 39 km about 12 s.
4. The map is saved in IndexedDB (`driveHome` database: `customMeta` for the menu, `customData` for the map files; at most 12, oldest dropped) and selected. Custom ids start with `custom-`.

Rules:
- **One builder.** Never copy or fork building logic into the browser: change `src/mapgen/core.js`, rebuild the built-in maps (they must stay the same unless the change is meant for them too), and custom maps follow. Tested 2026-10-10: a custom build of the Odd Burger route matched `burger.json` in every field except the far side streets explained under "Map data". The Node builder caches City rooflines and zoning per map (`tools/cache/rooflines-<id>.json`), so the byte-for-byte rebuild check doesn't run the shared download code (`loadRooflines`, `loadZoning`, the query boxes and radii); after changing those, run `node tools/dev/custom-routes.mjs`, which downloads live through that code.
- **Privacy.** Typed places only go to Photon/Nominatim and OSRM, and the map to the City/NRCan services as boxes; everything stays on the device. The builder's fine print says exactly that; keep it true if a service changes. Nominatim is asked at most once per search, at most once a second, with answers cached (its usage policy). The menu credits OSRM for routes. Custom routes have no online leaderboard (`showResult` skips it) and finishing one counts as map `custom` in the achievements stats. Never test with anyone's home address; use public places.
- Each custom map is projected around its own start (`makeProjection(start)`), which is how `landmarks.js` places landmarks; the built-in maps keep the global Summerside projection, so they don't change.
- If the City's data service is down, the map is still built with OpenStreetMap buildings and a note in the route's panel; if only some of its downloads fail, those stretches get OpenStreetMap buildings (`loadRooflines(..., { skipFailed: true })`; the Node builder keeps failing loudly instead). If terrain or routing is down, the builder says so.
- **Bridges at the ends.** A route that starts or ends on a bridge keeps its deck level with the end on land (the bare-earth terrain under the open end is the river).
- **Landmarks part-way.** A custom route can pass through a landmark's grounds (97 Ave really runs in a tunnel under the Legislature's north plaza, which the game can't model): a landmark with parts at road level must leave out what the driven road passes through, using `ctx.route` (the Legislature drops the pools and jets there).
- **Landmarks at the ends.** A route to or from a landmark (a mall, an arena, a downtown tower) would start or end inside its model, so `trimRouteAtLandmarks()` cuts the ends that lie on landmark grounds and backs the finish off until the ending scene's spot is clear. The landmark road check ignores model parts before the start and past the finish (no road goes on there). Check custom routes with the game open as `/?checkLandmarks` (the console reports per map); it must say 0, as for the built-in maps. Tested 2026-10-10 on West Edmonton Mall → Rogers Place and Kingsway → Commonwealth Stadium.
- The finish banner shows the destination; the ending scene is picked from what the destination is (`endingFor`: food → burger/noodles, shops → shopping, water → beach, ski → ski, else BBQ; video games stay Downtown's own). The Walterdale arches go over any route's bridge run within 150 m of the real bridge.
- Test with real clicks: `[data-new-route]`, type into `#cr-from`/`#cr-to`, click a `.cr-opt`, click `#cr-build`, wait for `#custom-screen` to close. `window.__game` is dev-only, so on a production preview wait on the page instead.

## Road lines (rule: don't break them again)

Lane lines were wrong from the first version on: short double-yellow lines popped up in the middle of one-way roads, yellow ran down wide one-way roads, and lines stepped sideways wherever OpenStreetMap's lane count changes. The cause was the renderer guessing where the centre line goes from road widths that had been smoothed separately from the lane count. To keep it fixed:

- **One source.** Lines, stop-line extents and the lanes traffic may use all come from `src/lane-layout.js`. `buildMarkings()` in `world.js` only turns its plan into meshes, `signals.js` and `route.lanes()` call it, and `tools/check-roads.mjs` checks the same plan. Don't place lane lines or lanes anywhere else.
- **No guessing.** Never decide one-way vs two-way from widths. The builder writes `route.ow` per sample: 1 = one-way carriageway, 0 = two-way road, 2 = unmarked lane at the ends (parking lots), plus `lanes`, `ctr` (centre turn lane), `right`, `left`, `laneFormat: 2` and `src` (the raw OSM layout, run-length encoded).
- **Clean as one unit.** In `tools/build-maps.mjs`, `cleanLaneLayout()` cleans the whole layout together. It only smooths away one-way/two-way flips under 30 m, merges lane-count changes under 80 m into a neighbour of the same kind, and keeps roundabouts and ramps (30 m or longer) at their own lane counts. Then `laneEdges()` makes the edges. Never smooth or filter `lanes`, `ow`, `right` or `left` on its own. On one-way roads the right edge follows the through lanes, so turn bays open on the median side; two-way roads are centred on the route line.
- **No caps, no blocks.** Don't cap lane counts when drawing lines; `route.lanes()` caps at 4 only for traffic and pickups. Take sideways offsets at every route sample, never once per block.
- **Signals come from the real junction.** The builder writes each signal as `[s, stop, end]`. It picks the first OSM signal node actually on our road, then takes the stop line and the gap in the lane lines from where the cross streets meet the road: the junction grows from the closest cross street to every side road within 7 m of it, up to 40 m from the signal (the distance the checker looks). So the lines break across the whole junction, and the stop line plus crosswalk sit just before it. Where our lanes are narrower than most of a lane at that spot (a two-way street narrowing into a one-way ramp), the stop line moves back to full width. Where cross streets meet our road comes from `sideRoadMouths()` in `lane-layout.js`, used by both the builder and the checker (two copies once disagreed by 2.4 m on a skewed street); roads running alongside (slip lanes, merges) aren't cross streets. The signal pole stands at the OSM signal node but never before the far side of the crosswalk (`signals.js`).
- **No folds.** On a turn tighter than the road is wide, lines (`lane-layout.js`) and sidewalks (`world.js`) on the inside are left out. How tight a turn is comes from `foldCurvature()`: the sharpest point of the corner, measured sample by sample the way the checker finds folds (an average over 16 m missed a 7 m corner on a custom route). Sidewalks are also left out where they would lie on another stretch of the route (the U-turn at the Sherwood finish).
- **Same input everywhere.** `laneInput()` builds the lane data for both the game (`route.laneData`) and the checker. Never hand `lane-layout.js` a differently shaped object: once the checker passed while the game crashed because of that.
- **The check.** `npm run build` runs `npm run check:roads` first and stops on any failure, so Vercel won't deploy broken lines. The check compares against the raw OSM layout in `route.src`, not just against the cleaned data, so a cleaning mistake fails. It also fails when a stop line is inside a cross street, when lane lines run into a junction past the gap, and when a line folds back in real positions. Run it after touching the builder, `public/maps/*.json`, `route.js`, `lane-layout.js`, `signals.js` or the road code in `world.js`. After changing lane logic, rebuild ALL maps (old map files draw no lines). Don't loosen its limits to make it pass; fix the data or the plan.
- **Custom routes too.** Custom maps are built in the browser and never pass through `npm run build`, so builder changes must be checked on new routes as well: run `node tools/dev/custom-routes.mjs --game 5173` (builds 12 fixed routes between public places across the city with the same code, including one that starts on the Walterdale Bridge and drives 97 Ave under the Legislature plaza and one that ends on the High Level Bridge; runs `node tools/check-roads.mjs --dir tools/cache/custom-maps`, and with `--game` also the landmark and brand road checks in the game; about 5 minutes). On 2026-10-10 ten routes across the city found a fold, a junction gap and two stop-line cases the built-in maps never hit; all were fixed in the builder and the plan, with no limit loosened.
- The check covers geometry, not looks. After road changes, also screenshot a few lane-count changes, two-way stretches and signals in the game, and run a real-click test: the game must still load and start.

## Road structures (rule: nothing raised on the driven road)

The DEM is bare earth, so bridges and overpasses have to be made up. On 2026-10-07 the game started lifting side bridges +6.5 m with 70 m straight ramps and piers, and the builder added +6.5 m humps to every short route bridge. Neither checked where things landed, so ramps, embankments and piers ended up across the lanes, and humps stacked into camel backs or rose over creeks. Fixed 2026-10-09. To keep it fixed:

- **The builder decides, the game draws.** `tools/build-maps.mjs` makes every raised structure:
  - **Route humps:** only where a road or railway really crosses under the route bridge. Lift only as much as `HUMP_CLEAR` needs. Ramps keep a 6% grade and a crest radius of at least `HUMP_RADIUS`. Neighbouring humps merge instead of adding. The lift goes into `route.lift`.
  - **`sideRoadStructures()`:** a side bridge that crosses OVER the route gets a deck `OVERPASS_CLEAR` above it (`o: 1`). The road pieces joined to its ends ramp down (`e: 1`) and are never raised inside the route corridor. Piers (`piers`) never stand on the route or any road. The other half of a divided road beside a hump rides level with us (`e: 1`). Side roads that meet a raised hump ramp stop at the embankment foot.
  - Raised pieces carry `h`, a height per point, and `world.js` just draws it; `junctionBlend` never drags a side road up a hump ramp.
- **Landmarks** use `ctx.route` to keep clear of the driven road (the High Level Bridge is fitted to it and drops steel that would stand in the lanes). The landmark road check (`node tools/dev/check-landmarks.mjs`, or `?checkLandmarks`) must report 0 on every map.
- **Room overhead.** `src/clearance.js` measures the room above the road at every route sample: overpass decks from the map data, and landmark parts over the road found by casting rays up (the High Level Bridge's upper deck). Flying (the Fly power, the Rocket's lift-off) and the chase camera stay under it, looking ahead so they dip in time. Anything new built over the road must be in the map data or a landmark, so this sees it.
- **Bridges only where OSM has one.** Route samples with no OSM road (gaps, and the parking-lot stretch at a route's end) are a bridge only when the roads on both sides of the gap are bridges. The game doesn't cut the ground away under bridges, so a made-up bridge disappears under the ground. That happened at the end of Snow Valley on 2026-10-10. `check-roads` fails on made-up bridges and on bridge decks below the ground.
- **The check.** `tools/check-roads.mjs` (run by `npm run build`) also fails on:
  - a raised side road or deck less than 5 m above the route where it is on the route;
  - a pier on any road;
  - a hump that dips between decks;
  - a hump steeper than its limits or higher than `HUMP_MAX`.
- After changing structures, screenshot the overpasses and humps from the driver's view.

## Database (Supabase free tier)

- `supabase/schema.sql` is safe to re-run. After changing it, paste the whole file into Supabase → SQL Editor and run it.
- Authentication → Sign In / Providers → "Allow anonymous sign-ins" must be ON. Each browser gets an invisible anonymous player account.
- `scores`: the server stamps each score with the poster's account and name. Clients can't edit or delete scores. Limits (added 2026-10-18, so a script can't fill the free 500 MB database): one post per player every 10 seconds (`score_limits`, which clients can't read or write), and only each player's best time per map is kept (a slower time is skipped without an error, a faster one replaces it), so each player holds at most one row per map. The game only ever reads best times, so nothing visible changed.
- `player_progress`: each player sees only their own row. The name is set once, can't be changed, and must be unique. `stats` and `achievements` are each capped below 4000 bytes.
- `leaderboard` view: each player's best time per map.
- Test schema changes before the owner runs them: load the old file, then the new one twice, into an in-memory Postgres (`@electric-sql/pglite`, installed outside the repo) with stand-ins for `auth.users`, `auth.uid()` and the `anon`/`authenticated` roles, and try normal play and abuse as each role.

## Costs (all free plans, checked 2026-10-17)

The owner worries about being charged. Everything is on a free plan, where going over a limit pauses the service instead of billing:
- **Vercel: Hobby** (`billing.plan: "hobby"`, no trial, $0). Over a limit, the feature stops for up to 30 days; Spend Management exists only on Pro. The game used ~62 MB of the 100 GB monthly transfer in its first two weeks; a first visit downloads ~2.9 MB (page, all 8 maps prefetched, sounds), so ~34,000 first visits a month fit. Never start a Pro trial or pick a paid plan in a Marketplace install without the owner's OK; if the account ever goes Pro, set `npx vercel budgets set --amount <dollars> --pause` first.
- **Unused Vercel Marketplace Supabase store `supabase-amber-pebble`**: Supabase Free Plan, $0, but connected to drive-home and injecting 16 unused env vars. Supabase pauses it after a week idle, and then every deploy fails in under a second with "Resource provisioning failed" (2026-10-13). The owner restored it on 2026-10-16; disconnecting it from drive-home (Vercel → Storage → supabase-amber-pebble → Projects → Disconnect) is the lasting fix, and agents are blocked from doing that themselves.
- **Supabase leaderboard project** (`mfsc…`, set directly via `VITE_*`): the owner's own Supabase org; free plans never charge. It also pauses after a week with no players.
- **GitHub**: private repo, no Actions, no LFS. The map and address services (Photon, Nominatim, OSRM demo, City of Edmonton, NRCan) are free and keyless; heavy use gets blocked, never billed.

## Testing

- There are no unit tests. Check changes by running the dev server and driving the game with headless Chrome (puppeteer-core, a dev dependency) and screenshots. Use `window.__game` to jump along the route (`S.s`), start races and finish.
- `node tools/dev/shots.mjs <map> <s,s,...>` saves a driver's view and a high view at each route position and prints fps. Write other throwaway test scripts outside the repo.
- `node tools/dev/studio-shot.mjs "<url>" out.png` screenshots a dev page that sets `window.ready` (car-studio, landmark-studio).
- `node tools/dev/check-brands.mjs [port] [maps]` checks that no brand site (canopy, forecourt, pylon, portal) stands on the driven road on any map; `node tools/dev/check-landmarks.mjs [port]` does the same for landmarks. Both must report 0.
- Test UI through real clicks. A past bug deleted the Start button handlers, and tests that started races via the hook didn't notice.
- After world or car changes, check fps and map switching on the biggest maps (`home`, `sherwood`); see "Performance".

### Performance

The owner plays on an M2 MacBook Air (fanless; Retina screen at 2x plus an external 2560×1440 monitor at 1x) in Chrome, usually on the dev server.

- **Measure** with `node tools/dev/perf.mjs` (dev server running; the top of the file explains every number). It runs headless Chrome on the real GPU (`--use-angle=metal`) and emulates the Retina laptop (1440×900 at 2x).
  - `switch`: clicks through the maps in the menu; time to load and the longest freeze. Also works on a production preview (`npm run build && npx vite preview --port 4174`, then `--port 4174`).
  - `drive --maps home,sherwood,refinery,snowvalley`: a 40 s scripted drive (gas, nitro, crashes, all power-ups, four spots along the route): frame-time p50/p95/p99, frames over 20/33 ms, CPU and GPU ms per frame, draw calls, triangles.
  - `firsts`: the first nitro, crash, smoke, power-ups and finish; shaders built during play must be 0.
  - `--throttle 4` slows the CPU 4x (a busy machine); `--monitor 2560x1440` moves the window to a 1x monitor after loading; `--uncapped` removes the 60 Hz cap to show headroom.
  - Run one test at a time and repeat anything important: other programs change the numbers. To tell a real regression from noise, run the live commit in a worktree on another port (`git worktree add --detach .claude/worktrees/baseline-<sha> <sha>`, clone node_modules with `cp -cR`, `npx vite --port 5189`) and alternate the same test between the two ports (`--port`): on 2026-10-13 a 167 ms frame and a 1.7 s load on refinery vanished this way (both versions identical, the machine was at load 29 from helpers' browsers). A clipped puppeteer screenshot (`clip:`) resizes the page, which re-applies the resolution budget; take full screenshots when comparing pixels.
- **Targets**: steady 60 fps at deviceScaleFactor 2 on 1440×900 (p95 frame time under 20 ms, no frames over 33 ms in the drive test); switching maps never freezes the menu for more than ~100 ms at a time; no shaders built during play.
- **Keep the look**: before/after screenshots of the same spots must match. Pixel-diff full screenshots taken at the same resolution (set `__game.renderer.setPixelRatio(devicePixelRatio)` first in the new code).
- Things that would break this: one mesh for a whole map (cut big things into ~500 m pieces), building or compiling during a race, `backdrop-filter` on HUD panels, writing the HUD every frame, adding or removing lights at run time.

## Status and handoff (2026-10-18)

This section is the compressed history and the to-do list; delete items as they get done.

### Where things are

- **Live** (`main`): 8 maps, landmarks, the map-select screen, building styles, store and exit signs, the online leaderboard and achievements, the road-line rewrite, the road-structure fix and signals at real junctions (deployed 2026-10-09).
- **Also live, deployed 2026-10-10 with the owner's OK:** the fixes for the owner's 2026-10-10 list:
  1. smooth map switching and the performance pass (see "Performance");
  2. engines, turbo, blow-off and tyre squeal from real CC0 recordings (see "Sounds");
  3. flying stays under the High Level Bridge's upper deck and under overpasses (`clearance.js`);
  4. the road at the end of Snow Valley is visible again.
- **Also live, pushed 2026-10-13 and deployed 2026-10-16** (the 2026-10-13 deploys failed on the paused Supabase store, see "Costs"; redeployed after the owner restored it) — the owner's 2026-10-10 requests:
  1. custom routes: any two places inside Edmonton, built in the browser with a progress bar (see "Custom routes"), on the shared builder `src/mapgen/` and the OpenStreetMap tiles in `public/osm/`;
  2. all six team cars rebuilt from the makers' official images and specifications;
  3. 11 new landmarks (West Edmonton Mall, Rogers Place, City Hall, …);
  4. brand buildings: gas stations, chain restaurants, banks, big boxes, hotels, dealers (`brands.js`, `brand-sites.js`);
  5. a Supercars row in the garage (Revuelto, 296 GTB, 911 Turbo S, 750S) with real recorded engines;
  6. road-line fixes found on new routes (folds at sharp corners, whole junctions, full-width stop lines, signal poles past the crosswalk), checked on 10 custom routes across the city (`tools/dev/custom-routes.mjs`);
  7. two code reviews' confirmed findings fixed (custom-route screen, address search rules, tiles at the area's edge, terrain read retries).
- Work in progress goes on a branch, and goes live only after the owner checks it locally and says so. Helpers (sub-agents) work in git worktrees under `.claude/worktrees/` and their branches are squash-merged (no co-author lines); usage limits often stop them mid-task, so resume them and their saved commits.

### Owner to-dos

- Paste all of `supabase/schema.sql` into Supabase → SQL Editor and run it (again, for the 2026-10-18 posting limits; it also brings the map list up to date with `snowvalley` and `refinery`).
- Disconnect the unused `supabase-amber-pebble` store from drive-home in Vercel before it pauses again (around 2026-10-23), or deploys fail (see "Costs").
- Glance at Vercel → Settings → Billing (should say Hobby) and Supabase → the leaderboard project's organisation → Billing (should say Free).
- `menu.png` and `race.png` in the project folder are old screenshots and can be deleted.
- Confirm the teammates' car model years: the cars now follow the current designs (Lexus IS 2026+ facelift front, Kia Carnival 2025 facelift lights, Legacy 2025 black window frames, CR-V and Accord 2023+). An older car looks different at the front or rear.
- Listen to the supercar engines (and the team cars) in `/sound-studio.html` and a drive: they're real recordings, but nobody has heard them yet.

### Unfinished work, in order

1. **Things on the driven road:** done 2026-10-09 (see "Road structures"). Left, cosmetic:
   - Sidewalk folds over the lanes on the ~5 m turn near the sherwood finish (s 22064–22194). The route itself turns that sharply; smoothing very sharp corners in the builder would fix it.
   - Side roads clip the underside of some real road bridges (home s 8174–8231; refinery s 1359–1810 and 11350–11424). Off the driven road.
2. **Sound effects: done 2026-10-09; real engine recordings added 2026-10-10 (live), waiting for the owner to listen.** `src/sound.js` + `sound-studio.html` (see the code map and "Sounds"). After the owner said the turbo speed sound wasn't real, engines, the turbo whistle and blow-off, tyre squeal, the Model X, E-bike and Rocket use CC0 recordings, with the synth as fallback. Tested: samples load after the first click and the engine switches to them, the game runs normally with the sound files blocked, loop seams and rpm crossfades are clean in offline renders, no clipping, no audio-node leak over 2 minutes of busy driving, 60 fps on home and sherwood. Still to do: the owner auditions everything in `/sound-studio.html` (Recorded vs Synth, test drive) and in a drive, then says what to change. Music stays on the wishlist.
3. **Road lines across all 8 maps: reviewed 2026-10-09** (about 265 spots screenshotted). The core rules held. Fixed after the review:
   - signals at the wrong junction (lines ran through about a dozen intersections, a stop line mid-block, a missing signal on Terrace Rd);
   - folded lines and a sidewalk across the lanes at the Sherwood finish U-turn;
   - ramps painted with a neighbour's lane count;
   - a 100 m dash gap around divided/undivided changes (now about 50 m);
   - stub dashes.
4. **Owner's choice (ask before doing):**
   - Real Alberta divided roads and freeways have a **yellow left edge line** along the median. Not done, because yellow on one-way roads is exactly what upset the owner before.
   - Residential collectors (88 St SW, Savaryn Dr, Rainbow Valley Rd) often have no edge lines or centre line in real life; `route.cls` could tone them down.
5. **Brand data follow-ups** (the brand helper's requests, 2026-10-13; the game copes without them):
   - Pass the OSM `building` value through (e.g. `building=roof`) so gas canopies are certain; class 8 lumps canopies with sheds and garages.
   - The `amenity=fuel` lot outline (needs it in the OSM tiles), so forecourts sit inside the real lot.
   - Tenant positions in `ps` (x, z of each place), so strip-mall signs go over the right store (now spread evenly along the wall).
   - Duplicate City/OSM building outlines (~27 on Downtown) dropped in the builder rather than skipped by the game.
6. **Lane-line follow-ups** (lower priority):
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
- West Edmonton Mall: heights of the tall parts estimated from photos (Galaxyland ~30 m, waterpark ~29 m, hotel 40 m); anchor stores, skylights and parkade storeys placed by eye.
- Rogers Place band curve, Art Gallery ribbons: drawn by eye. City Hall west-wing pillars approximate.
- Royal Alberta Museum: heights estimated; the screen picture is invented.
- Commonwealth Stadium: the field sits at street level (the real one is sunk); trusses and scoreboard invented.
- TELUS World of Science: blade count and mast position approximate.
- Convention Centre terraces follow the smoothed game terrain, not the real storeys.
- Southgate entrance size, Kingsway store heights and pylon: estimated. Talus Dome: ~380 balls instead of ~1,000.

## Wishlist (not done yet)

Music (sound effects are done, see `sound.js`), police chasing speeders, buses and trucks, rain or night driving, house styles by era (bungalows vs two-storeys with front garages), LRT trains beside 114 St / 111 St.
