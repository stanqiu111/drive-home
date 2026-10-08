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

export function landmarkContext(entry, ground = () => null, onRoad = () => false) {
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

// Place every landmark that falls on this map. `heightAt(x, z)` gives ground height or null;
// `onRoad(x, z)` says whether a map point is on a road.
export function buildLandmarks(data, heightAt, onRoad = () => false) {
  const group = new THREE.Group();
  for (const L of LANDMARK_LIST) {
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
    const model = mod.build(landmarkContext(L, ground, (lx, lz) => onRoad(...toMap(lx, lz))));
    model.position.set(x, base, z);
    model.rotation.y = a;
    model.name = `landmark:${L.id}`;
    group.add(model);
  }
  return group;
}
