// Builds a fixed set of custom routes across Edmonton with the same code and data as the
// game's custom-route builder (src/mapgen/worker.js), then runs the road-line check on them.
// Custom maps never pass through `npm run build`, so run this after changing src/mapgen/ or
// src/lane-layout.js (see "Custom routes" and "Road lines" in CLAUDE.md).
//
//   node tools/dev/custom-routes.mjs           # all routes (about 2 minutes)
//   node tools/dev/custom-routes.mjs 0 3       # just routes 0 and 3
//   node tools/dev/custom-routes.mjs --game 5173
//       also loads each map in the game (dev server on that port) and runs the landmark and
//       brand road checks on it: the maps are put in public/maps for the run (as zzc<n>) and
//       always taken out again.
//
// Maps go to tools/cache/custom-maps/ (not in git). Start and finish are public places;
// never add anyone's home address here.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeProjection, routeFromCoords, trimRouteAtLandmarks, osmNearRoutes, loadRooflines, loadZoning, buildMapData } from '../../src/mapgen/core.js';
import { tilesForRoutes, mergeTiles } from '../../src/mapgen/osm-tiles.js';
import { sampleDEM } from '../../src/mapgen/dem.js';
import { osrmRouteUrl } from '../../src/mapgen/edmonton.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'tools/cache/custom-maps');
const UA = 'DriveHomeGame/0.1 (personal hobby project)';
const P = {
  wem: ['West Edmonton Mall', [-113.622725, 53.52312]],
  rogers: ['Rogers Place', [-113.497795, 53.546794]],
  clareview: ['Clareview Rec Centre', [-113.402147, 53.602146]],
  windermere: ['Currents of Windermere', [-113.60361, 53.436891]],
  kingsway: ['Kingsway Mall', [-113.505886, 53.562968]],
  southgate: ['Southgate Centre', [-113.514143, 53.485765]],
  millwoods: ['Mill Woods Town Centre', [-113.430451, 53.455684]],
  butterdome: ['Butterdome', [-113.52791, 53.523435]],
  expo: ['Edmonton EXPO Centre', [-113.458096, 53.56871]],
  lewis: ['Lewis Farms Transit Centre', [-113.666732, 53.523162]],
  commonwealth: ['Commonwealth Stadium', [-113.476423, 53.559659]],
  terwillegar: ['Terwillegar Rec Centre', [-113.582111, 53.458496]],
  castledowns: ['Castle Downs Transit Centre', [-113.516154, 53.616543]],
  bonniedoon: ['Bonnie Doon Centre', [-113.457067, 53.520806]],
  meadows: ['The Meadows Rec Centre', [-113.371214, 53.457971]],
  cityhall: ['Edmonton City Hall', [-113.490165, 53.545472]],
  zoo: ['Edmonton Valley Zoo', [-113.555627, 53.51096]],
  ram: ['Royal Alberta Museum', [-113.489081, 53.547148]],
  walterdale: ['Walterdale Bridge', [-113.5017099, 53.5283861]], // starts on a bridge, then 97 Ave under the Legislature plaza
  garneau: ['Garneau', [-113.525, 53.515]],
  highlevel: ['High Level Bridge', [-113.5113467, 53.5296248]], // ends mid-bridge
};
const ROUTES = [
  ['wem', 'rogers'], ['clareview', 'windermere'], ['kingsway', 'southgate'], ['clareview', 'millwoods'], ['butterdome', 'expo'],
  ['lewis', 'commonwealth'], ['terwillegar', 'rogers'], ['castledowns', 'bonniedoon'], ['meadows', 'cityhall'], ['zoo', 'ram'],
  ['walterdale', 'southgate'], ['garneau', 'highlevel'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(1500 * (i + 1));
  }
  throw new Error(`fetch failed: ${url}`);
}

fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const gameAt = args.indexOf('--game');
const gamePort = gameAt >= 0 ? args[gameAt + 1] || '5173' : null;
const pick = args.filter((a, i) => /^\d+$/.test(a) && (gameAt < 0 || i !== gameAt + 1)).map(Number);
const todo = ROUTES.map((r, i) => [i, r]).filter(([i]) => !pick.length || pick.includes(i));
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.json') && !pick.length) fs.rmSync(path.join(OUT, f));
for (const [i, [a, b]] of todo) {
  const t0 = Date.now();
  const [nameA, start] = P[a];
  const [nameB, dest] = P[b];
  const j = await getJSON(osrmRouteUrl(start, dest));
  await sleep(1100); // the OSRM demo server asks for at most one request a second
  const proj = makeProjection(start);
  const pts = trimRouteAtLandmarks(routeFromCoords(j.routes[0].geometry.coordinates, proj), proj);
  const tiles = [...tilesForRoutes([pts], proj)]
    .map((k) => path.join(ROOT, 'public/osm/t', `${k}.json`))
    .filter((f) => fs.existsSync(f))
    .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const osm = osmNearRoutes(mergeTiles(tiles), [pts], proj);
  const id = `${i}-${a}-${b}`;
  const { out, meta } = await buildMapData({ id, name: `${nameA} → ${nameB}`, start, dest }, pts, osm, {
    proj, sampleDEM, log: () => {},
    rooflines: (m, p) => loadRooflines(p, getJSON, { proj, parallel: 4 }),
    zoning: (m, p) => loadZoning(p, getJSON, { proj }),
  });
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(out));
  console.log(`${id}: ${meta.km} km, ${out.buildings.length} buildings, ${out.signals.length} signals, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
try {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/check-roads.mjs'), '--dir', OUT], { stdio: 'inherit' });
} catch {
  process.exitCode = 1;
}

// In the game: landmarks and brand sites must keep off the driven road on custom maps too.
if (gamePort) {
  const MAPS = path.join(ROOT, 'public/maps');
  const indexFile = path.join(MAPS, 'index.json');
  const indexText = fs.readFileSync(indexFile, 'utf8');
  const ids = [];
  try {
    const index = JSON.parse(indexText);
    for (const f of fs.readdirSync(OUT).filter((n) => n.endsWith('.json')).sort()) {
      const id = `zzc${f.split('-')[0]}`;
      const data = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
      fs.writeFileSync(path.join(MAPS, `${id}.json`), JSON.stringify({ ...data, id }));
      index.push({ id, name: f.replace(/\.json$/, ''), from: 'Summerside', km: 1, poly: [[0, 0], [1, 1]], landmarks: [], streets: [], signals: 0, curves: 0, bridgeM: 0, highwayM: 0, climb: 0 });
      ids.push(id);
    }
    fs.writeFileSync(indexFile, JSON.stringify(index));
    for (const tool of ['check-landmarks.mjs', 'check-brands.mjs']) {
      try {
        execFileSync(process.execPath, [path.join(ROOT, 'tools/dev', tool), gamePort, ids.join(',')], { stdio: 'inherit' });
      } catch {
        process.exitCode = 1;
      }
    }
  } finally {
    fs.writeFileSync(indexFile, indexText);
    for (const id of ids) fs.rmSync(path.join(MAPS, `${id}.json`), { force: true });
  }
}
