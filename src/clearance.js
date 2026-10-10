import * as THREE from 'three';

// How much room there is above the road at each route sample (metres above the road
// surface): the underside of the lowest thing overhead that the car could fly into, such
// as an overpass deck from the map builder (`o: 1` side roads) or a landmark part over the
// road (the High Level Bridge's upper streetcar deck). Infinity where the sky is open.
// Flying and the chase camera stay under it (main.js), so they never end up inside or on
// top of a bridge.
const DECK_DEPTH = 1.4; // overpass decks are drawn 1.4 m deep under their surface (world.js)

export function overheadClearance(route, data, landmarks) {
  const n = route.n;
  const step = route.step;
  const clear = new Float32Array(n).fill(Infinity);
  const f = {};
  const latOf = (x, z, i) => {
    route.frame(i * step, f);
    return -(x - f.x) * f.tz + (z - f.z) * f.tx;
  };
  // Route samples near a point, from a coarse grid.
  const CELL = 30;
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.floor(route.x[i] / CELL)},${Math.floor(route.z[i] / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const nearestSample = (x, z) => {
    let best = -1;
    let bd = 40 * 40;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const i of grid.get(`${cx + a},${cz + b}`) ?? []) {
        const d = (route.x[i] - x) ** 2 + (route.z[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  };

  // 1. Overpass decks over the route.
  for (const r of data.roads ?? []) {
    if (!r.o || !r.h) continue;
    for (let k = 0; k < r.h.length; k++) {
      const x = r.p[2 * k] / 10;
      const z = r.p[2 * k + 1] / 10;
      const i = nearestSample(x, z);
      if (i < 0) continue;
      const lat = latOf(x, z, i);
      if (lat < route.leftArr[i] - r.w / 2 - 1 || lat > route.rightArr[i] + r.w / 2 + 1) continue;
      const room = r.h[k] - DECK_DEPTH - route.y[i];
      // The deck is r.w wide (and may cross at an angle): cover the samples under it.
      const span = Math.ceil((r.w + 3) / step);
      for (let j = Math.max(0, i - span); j <= Math.min(n - 1, i + span); j++) clear[j] = Math.min(clear[j], room);
    }
  }

  // 2. Landmark parts over the road: cast rays straight up from the road where a landmark's
  //    parts reach over it.
  if (landmarks) {
    landmarks.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.far = 30;
    const up = new THREE.Vector3(0, 1, 0);
    const o = new THREE.Vector3();
    const box = new THREE.Box3();
    const meshes = [];
    landmarks.traverse((m) => {
      if (!m.isMesh) return;
      box.setFromObject(m);
      if (Number.isFinite(box.min.x)) meshes.push({ m, box: box.clone() });
    });
    for (let i = 0; i < n; i++) {
      const x = route.x[i];
      const z = route.z[i];
      const y = route.y[i];
      const reach = Math.max(route.rightArr[i], -route.leftArr[i]) + 1;
      const over = meshes.filter(({ box: b }) => x > b.min.x - reach && x < b.max.x + reach && z > b.min.z - reach && z < b.max.z + reach
        && b.max.y > y + 1 && b.min.y < y + 30);
      if (!over.length) continue;
      for (const lat of [route.leftArr[i] * 0.7, 0, route.rightArr[i] * 0.7]) {
        route.toWorld(i * step, lat, 0.3, o);
        ray.set(o, up);
        for (const { m } of over) {
          const hit = ray.intersectObject(m, false)[0];
          if (hit) clear[i] = Math.min(clear[i], hit.distance + 0.3);
        }
      }
    }
  }

  const at = (s) => clear[Math.max(0, Math.min(n - 1, Math.round(s / step)))];
  return {
    clear,
    // Room above the road at s, and the least room anywhere between s0 and s1.
    at,
    ahead(s0, s1) {
      let least = Infinity;
      const a = Math.max(0, Math.floor(s0 / step));
      const b = Math.min(n - 1, Math.ceil(s1 / step));
      for (let i = a; i <= b; i++) if (clear[i] < least) least = clear[i];
      return least;
    },
  };
}
