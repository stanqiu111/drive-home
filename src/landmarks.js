import * as THREE from 'three';

// Real Edmonton landmarks, placed by latitude/longitude on any map whose ground
// covers them. Each entry builds a low-poly model (units: metres, y up, facing +z).
// `yaw` turns the model (degrees, clockwise seen from above). Models are built once
// per map load, so keep them cheap.

const DEG = Math.PI / 180;
const mLat = (p) => 111132.954 - 559.822 * Math.cos(2 * p * DEG) + 1.175 * Math.cos(4 * p * DEG);
const mLon = (p) => 111412.84 * Math.cos(p * DEG) - 93.5 * Math.cos(3 * p * DEG) + 0.118 * Math.cos(5 * p * DEG);

// Same local projection as tools/build-maps.mjs: x = east, z = south, origin = the map's start.
export function projectTo(origin, lon, lat) {
  const [lon0, lat0] = origin;
  return [(lon - lon0) * mLon(lat), -(lat - lat0) * mLat((lat + lat0) / 2)];
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

export const LANDMARKS = [];

export function registerLandmark(entry) {
  LANDMARKS.push(entry);
}

// Place every landmark that falls on this map. `heightAt(x, z)` gives ground height or null.
export function buildLandmarks(data, heightAt) {
  const group = new THREE.Group();
  for (const L of LANDMARKS) {
    const [x, z] = projectTo(data.origin, L.lon, L.lat);
    const g = heightAt(x, z);
    if (g == null) continue;
    const model = L.build({ mat });
    model.position.set(x, g + (L.sink ?? 0), z);
    model.rotation.y = -(L.yaw ?? 0) * DEG;
    model.name = `landmark:${L.id}`;
    group.add(model);
  }
  return group;
}

