// Builds a custom route's map in a background thread, with the same code and data as the
// built-in maps (core.js): the route from OSRM, OpenStreetMap from the game's own tiles
// (public/osm), buildings and zoning from the City of Edmonton, terrain from NRCan. Posts
// { type: 'progress', f: 0..1, label } while it works, then { type: 'done', out, meta } or
// { type: 'error', message }. Started by src/custom-route.js.
import { makeProjection, routeFromCoords, trimRouteAtLandmarks, osmNearRoutes, loadRooflines, loadZoning, buildMapData, STEP } from './core.js';
import { tilesForRoutes, mergeTiles, tileUrl } from './osm-tiles.js';
import { sampleDEM } from './dem.js';
import { osrmRouteUrl, CUSTOM_MIN_KM as MIN_KM, CUSTOM_MAX_KM as MAX_KM } from './edmonton.js';

const post = (msg) => self.postMessage(msg);
const progress = (f, label) => post({ type: 'progress', f: Math.max(0, Math.min(1, f)), label });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, { tries = 4, allow404 = false } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      if (r.status === 404 && allow404) return null;
      last = new Error(`HTTP ${r.status}`);
    } catch (e) {
      last = e;
    }
    await sleep(1500 * (i + 1));
  }
  throw new Error(`${new URL(url, self.location.href).hostname} did not answer (${last?.message ?? 'network error'})`);
}

// Runs `jobs` (functions returning promises) `n` at a time, keeping results in order.
async function inParallel(jobs, n, onDone) {
  const out = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const run = async () => {
    while (next < jobs.length) {
      const k = next++;
      out[k] = await jobs[k]();
      onDone?.(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, run));
  return out;
}

async function build({ id, name, from, to, start, dest, coords }) {
  // 1. The route (the menu usually fetched it already for the preview).
  progress(0, 'Planning the route');
  if (!coords) {
    const j = await getJSON(osrmRouteUrl(start, dest));
    if (!j.routes?.length) throw new Error('No driving route was found between those two places.');
    coords = j.routes[0].geometry.coordinates;
  }
  const proj = makeProjection(start);
  const full = routeFromCoords(coords, proj);
  const pts = trimRouteAtLandmarks(full, proj);
  if (pts.length < full.length * 0.6 && pts.length * STEP < 1000) throw new Error('Most of that drive is inside a landmark’s grounds. Pick places farther apart.');
  const km = (pts.length * STEP) / 1000;
  if (km < MIN_KM) throw new Error(`That drive is only ${km.toFixed(1)} km. Pick places at least ${MIN_KM} km apart.`);
  if (km > MAX_KM) throw new Error(`That drive is ${km.toFixed(0)} km. Custom routes can be up to ${MAX_KM} km.`);

  // 2. OpenStreetMap: the tiles along the route.
  progress(0.02, 'Downloading the streets');
  const index = await getJSON('/osm/index.json');
  const have = new Set(index.tiles);
  const keys = [...tilesForRoutes([pts], proj)];
  const missing = keys.filter((k) => !have.has(k));
  if (missing.length > keys.length * 0.02) throw new Error('This route leaves the Edmonton area the game has street data for.');
  const tiles = await inParallel(keys.filter((k) => have.has(k)).map((k) => () => getJSON(tileUrl(k))), 6,
    (d, n) => progress(0.02 + 0.2 * (d / n), `Downloading the streets (${d}/${n})`));
  const osm = osmNearRoutes(mergeTiles(tiles), [pts], proj);

  // 3. Everything else, exactly like tools/build-maps.mjs.
  const m = { id, name, from, start, dest };
  const span = (a, b) => (f) => a + (b - a) * f;
  const overall = span(0.22, 1);
  // If the City's open-data service is down, the map is still built: buildings then come
  // from OpenStreetMap alone (as outside the city limits), styled without zoning.
  const notes = [];
  const { out, meta } = await buildMapData(m, pts, osm, {
    proj,
    log: () => {},
    progress: (f, label) => progress(overall(f), label),
    sampleDEM: (points) => sampleDEM(points).catch(() => {
      throw new Error('The terrain service (Natural Resources Canada) did not answer. Try again in a moment.');
    }),
    rooflines: (mm, p) => loadRooflines(p, getJSON, {
      proj, parallel: 4, skipFailed: true,
      tick: (d, n) => progress(overall(0.5 + 0.25 * (d / n)), `Downloading the buildings (${d}/${n})`),
    }).then((list) => {
      if (list.missing) notes.push('Some City building data was unavailable: a few stretches have OpenStreetMap buildings instead.');
      return list;
    }, () => { notes.push('City building data was unavailable: buildings come from OpenStreetMap.'); return []; }),
    zoning: (mm, p) => loadZoning(p, getJSON, { proj }).catch(() => { notes.push('City zoning was unavailable.'); return []; }),
  });
  out.custom = { to, created: Date.now(), ...(notes.length ? { notes } : {}) };
  meta.to = to;
  return { out, meta };
}

self.onmessage = async (e) => {
  try {
    const { out, meta } = await build(e.data);
    post({ type: 'done', out, meta });
  } catch (err) {
    post({ type: 'error', message: err?.message || String(err) });
  }
};
