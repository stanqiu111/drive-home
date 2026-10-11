// Builds a fixed set of custom routes across Edmonton with the same code and data as the
// game's custom-route builder (src/mapgen/worker.js), then runs the road-line check on them.
// Custom maps never pass through `npm run build`, so run this after changing src/mapgen/ or
// src/lane-layout.js (see "Custom routes" and "Road lines" in CLAUDE.md).
//
//   node tools/dev/custom-routes.mjs           # all routes (about 2 minutes)
//   node tools/dev/custom-routes.mjs 0 3       # just routes 0 and 3
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
};
const ROUTES = [
  ['wem', 'rogers'], ['clareview', 'windermere'], ['kingsway', 'southgate'], ['clareview', 'millwoods'], ['butterdome', 'expo'],
  ['lewis', 'commonwealth'], ['terwillegar', 'rogers'], ['castledowns', 'bonniedoon'], ['meadows', 'cityhall'], ['zoo', 'ram'],
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
const pick = process.argv.slice(2).map(Number);
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
