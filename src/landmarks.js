import * as THREE from 'three';
import { LANDMARK_LIST } from './landmark-list.js';
import { SKYLINE_TOWERS } from './landmarks/skyline-data.js';

// Real Edmonton landmarks, placed by latitude/longitude on any map whose ground covers
// them. Each model lives in src/landmarks/<id>.js and exports `build(ctx)`, which returns
// a THREE.Group in metres: x = east, z = south, y = up, origin at ground level under the
// landmark's listed lon/lat. ctx gives shared material helpers and `local(lon, lat)` to
// convert other coordinates into model-local metres.

const DEG = Math.PI / 180;
const mLat = (p) => 111132.954 - 559.822 * Math.cos(2 * p * DEG) + 1.175 * Math.cos(4 * p * DEG);
const mLon = (p) => 111412.84 * Math.cos(p * DEG) - 93.5 * Math.cos(3 * p * DEG) + 0.118 * Math.cos(5 * p * DEG);

// Same local projection as tools/build-maps.mjs: x = east, z = south, origin = the map's start.
export function projectTo(origin, lon, lat) {
  const [lon0, lat0] = origin;
  return [(lon - lon0) * mLon(lat), -(lat - lat0) * mLat((lat + lat0) / 2)];
}

let envMap = null;
export const setLandmarkEnvMap = (m) => { envMap = m; };

const matCache = new Map();
// Shared material factory: finish = matte | glossy | metal | glass | glow.
function materialFor(color, finish = 'matte', extra = {}) {
  const key = `${color}|${finish}|${JSON.stringify(extra)}`;
  if (matCache.has(key)) return matCache.get(key);
  let m;
  switch (finish) {
    case 'glossy': m = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, envMap, envMapIntensity: 0.5, ...extra }); break;
    case 'metal': m = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.85, envMap, envMapIntensity: 0.9, ...extra }); break;
    case 'glass': m = new THREE.MeshStandardMaterial({ color, roughness: 0.1, metalness: 0.7, envMap, envMapIntensity: 0.9, ...extra }); break;
    case 'glow': m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.6, ...extra }); break;
    default: m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
  }
  matCache.set(key, m);
  return m;
}

// All landmark modules, discovered at build time.
const modules = import.meta.glob('./landmarks/*.js', { eager: true });

export function landmarkContext(entry, ground = () => null, onRoad = () => false, route = () => null) {
  return {
    mat: materialFor,
    entry,
    // Metres from this landmark's origin to another lon/lat (x east, z south).
    local: (lon, lat) => projectTo([entry.lon, entry.lat], lon, lat),
    // Terrain height at model-local (x, z) relative to the model origin, or null when unknown
    // (always null in the landmark studio, which has flat ground).
    ground,
    // True when model-local (x, z) is on or right beside a road (always false in the studio);
    // use it to keep trees and props off the streets around a landmark.
    onRoad,
    // The driven road nearest to model-local (x, z): { s, lat, left, right, y } with lat =
    // metres right of the route line, left/right = its edges, y = road surface relative to
    // the model origin; null away from the route and in the studio. Use it to keep clear of
    // the road (see "Road structures" in CLAUDE.md).
    route,
  };
}

// excludeBox = [halfWidth, halfDepth, offsetEast = 0, offsetSouth = 0] in metres.
const boxOf = (L, x, z) => ({ x: x + (L.excludeBox[2] ?? 0), z: z + (L.excludeBox[3] ?? 0), hw: L.excludeBox[0], hd: L.excludeBox[1] });

// Ground area each landmark on this map occupies, as boxes in map metres.
export function landmarkFootprints(data) {
  const out = [];
  for (const L of LANDMARK_LIST) {
    const [x, z] = projectTo(data.origin, L.lon, L.lat);
    if (L.excludeBox) out.push(boxOf(L, x, z));
    else if (L.excludeR > 0) out.push({ x, z, hw: L.excludeR, hd: L.excludeR });
  }
  for (const T of SKYLINE_TOWERS) {
    if (!(T.excludeR > 0)) continue;
    const [x, z] = projectTo(data.origin, T.lon, T.lat);
    out.push({ x, z, hw: T.excludeR, hd: T.excludeR });
  }
  return out;
}

// The road check (is any landmark standing on the driven road?) visits every triangle of
// every model, which freezes the game for a second or more on the big sites, so it only runs
// on request: open the game with ?checkLandmarks, or run `node tools/dev/check-landmarks.mjs`,
// which does that for every map. It must report nothing (see "Road structures" in CLAUDE.md).
export const LANDMARK_CHECK = typeof location !== 'undefined' && new URLSearchParams(location.search).has('checkLandmarks');

// Place every landmark that falls on this map. `heightAt(x, z)` gives ground height or null;
// `onRoad(x, z)` says whether a map point is on a road; `routeAt(x, z)` describes the driven
// road nearest a map point (see landmarkContext). `sl` lets the game draw frames between
// landmarks (see slicer in world.js).
export async function buildLandmarks(data, heightAt, onRoad = () => false, routeAt = () => null, sl = null) {
  const group = new THREE.Group();
  group.userData.intrusions = [];
  let checked = 0;
  for (const L of LANDMARK_LIST) {
    if (sl) await sl.tick();
    const mod = modules[`./landmarks/${L.id}.js`];
    if (!mod?.build) continue;
    const [x, z] = projectTo(data.origin, L.lon, L.lat);
    const g = heightAt(x, z);
    if (g == null) continue;
    const base = g + (mod.sink ?? 0), a = -(L.yaw ?? 0) * DEG, c = Math.cos(a), sn = Math.sin(a);
    const toMap = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
    const ground = (lx, lz) => {
      const h = heightAt(...toMap(lx, lz));
      return h == null ? null : h - base;
    };
    const route = (lx, lz) => {
      const r = routeAt(...toMap(lx, lz));
      return r && { ...r, y: r.y - base };
    };
    const model = mod.build(landmarkContext(L, ground, (lx, lz) => onRoad(...toMap(lx, lz)), route));
    model.position.set(x, base, z);
    model.rotation.y = a;
    model.name = `landmark:${L.id}`;
    group.add(model);
    if (LANDMARK_CHECK) {
      checked++;
      const hits = roadIntrusions(model, routeAt);
      if (hits.length) {
        group.userData.intrusions.push({ id: L.id, hits });
        console.warn(`Landmark ${L.id} stands on the driven road at s=${hits.slice(0, 5).map((h) => Math.round(h.s)).join(', ')}${hits.length > 5 ? '…' : ''} (${hits.length} points)`);
      }
    }
  }
  if (LANDMARK_CHECK) console.info(`Landmark check (${data.id}): ${checked} landmarks checked, ${group.userData.intrusions.length} on the driven road`);
  return group;
}

// Dev check: points of a placed model (vertices and triangle centres) that are on the
// driven road, from just below its surface up to 4.5 m above it.
// Vertices, edge points and centres of each triangle (long thin parts have few vertices).
const SAMPLE_WEIGHTS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1 / 3, 1 / 3, 1 / 3]];
for (const f of [0.25, 0.5, 0.75]) SAMPLE_WEIGHTS.push([f, 1 - f, 0], [0, f, 1 - f], [1 - f, 0, f]);
function roadIntrusions(model, routeAt) {
  const hits = [];
  const p = new THREE.Vector3();
  const test = () => {
    const r = routeAt(p.x, p.z);
    // Inside the road edges and from just above the surface (kerbs and lawns flush with the
    // road are fine) to 4.5 m up, where a car or the chase camera would hit it. Nothing counts
    // before the start or past the finish, where the road doesn't go on.
    if (!r || r.beyond || p.y < r.y + 0.05 || p.y > r.y + 4.5) return;
    if (r.lat > r.left - 0.1 && r.lat < r.right + 0.1) hits.push({ s: r.s, lat: r.lat, h: p.y - r.y });
  };
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isMesh || hits.length > 200) return;
    const pos = o.geometry.attributes.position;
    const m = new THREE.Matrix4();
    const instances = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < instances; k++) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, m); m.premultiply(o.matrixWorld); } else m.copy(o.matrixWorld);
      const idx = o.geometry.index;
      const tri = idx ? idx.count / 3 : pos.count / 3;
      const v = (j) => (idx ? idx.getX(j) : j);
      for (let t = 0; t < tri; t++) {
        for (const w of SAMPLE_WEIGHTS) {
          p.set(0, 0, 0);
          for (let q = 0; q < 3; q++) {
            const j = v(t * 3 + q);
            p.x += pos.getX(j) * w[q]; p.y += pos.getY(j) * w[q]; p.z += pos.getZ(j) * w[q];
          }
          p.applyMatrix4(m);
          test();
        }
      }
    }
  });
  return hits;
}
