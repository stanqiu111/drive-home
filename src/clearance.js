import * as THREE from 'three';

// How much room there is above the road at each route sample (metres above the road
// surface): the underside of the lowest thing overhead that the car could fly into, such
// as an overpass deck from the map builder (`o: 1` side roads) or a landmark part over the
// road (the High Level Bridge's upper streetcar deck). Infinity where the sky is open.
// Flying and the chase camera stay under it (main.js), so they never end up inside or on
// top of a bridge. See "Road structures" in CLAUDE.md.
const DECK_DEPTH = 1.4; // overpass decks are drawn 1.4 m deep under their surface (world.js)
const BIN = 4;          // m: landmark triangles are sorted into square cells of this size
const MAX_CELLS = 4000; // flat triangles covering more cells (ground pads, plazas) are never ceilings

export async function overheadClearance(route, data, landmarks, sl = null) {
  const n = route.n;
  const step = route.step;
  const clear = new Float32Array(n).fill(Infinity);
  const tick = () => sl?.tick();
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
  await tick();

  // 2. Landmark parts over the road. Rays go straight up, so only roof-like (not vertical)
  //    triangles can stop them: sort those into BIN-sized cells once, then each ray only
  //    tests the few triangles in its cell.
  if (!landmarks) return result(clear, n, step);
  landmarks.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const nearRoute = (b) => {
    for (let i = 0; i < n; i += 5) {
      const reach = Math.max(route.rightArr[i], -route.leftArr[i]) + 2;
      if (route.x[i] > b.min.x - reach && route.x[i] < b.max.x + reach && route.z[i] > b.min.z - reach && route.z[i] < b.max.z + reach
        && b.max.y > route.y[i] + 1 && b.min.y < route.y[i] + 30) return true;
    }
    return false;
  };
  const cells = new Map(); // cell key -> flat list of triangles, 9 numbers each
  const key = (cx, cz) => cx * 100003 + cz;
  const m4 = new THREE.Matrix4();
  const inst = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const meshes = [];
  landmarks.traverse((m) => { if (m.isMesh) meshes.push(m); });
  for (const m of meshes) {
    box.setFromObject(m);
    if (!Number.isFinite(box.min.x) || !nearRoute(box)) continue;
    const pos = m.geometry.attributes.position;
    const idx = m.geometry.index;
    const tris = idx ? idx.count / 3 : pos.count / 3;
    const copies = m.isInstancedMesh ? m.count : 1;
    const w = new Float32Array(pos.count * 3);
    for (let c = 0; c < copies; c++) {
      if (m.isInstancedMesh) { m.getMatrixAt(c, inst); m4.multiplyMatrices(m.matrixWorld, inst); } else m4.copy(m.matrixWorld);
      for (let j = 0; j < pos.count; j++) {
        v.fromBufferAttribute(pos, j).applyMatrix4(m4);
        w[j * 3] = v.x; w[j * 3 + 1] = v.y; w[j * 3 + 2] = v.z;
      }
      for (let t = 0; t < tris; t++) {
        const a = (idx ? idx.getX(t * 3) : t * 3) * 3;
        const b = (idx ? idx.getX(t * 3 + 1) : t * 3 + 1) * 3;
        const d = (idx ? idx.getX(t * 3 + 2) : t * 3 + 2) * 3;
        const area = (w[b] - w[a]) * (w[d + 2] - w[a + 2]) - (w[d] - w[a]) * (w[b + 2] - w[a + 2]);
        if (Math.abs(area) < 1e-3) continue; // vertical: a wall, not a roof
        const z0 = Math.floor(Math.min(w[a + 2], w[b + 2], w[d + 2]) / BIN), z1 = Math.floor(Math.max(w[a + 2], w[b + 2], w[d + 2]) / BIN);
        const tri = [w[a], w[a + 1], w[a + 2], w[b], w[b + 1], w[b + 2], w[d], w[d + 1], w[d + 2]];
        const add = (cx, cz) => {
          const k = key(cx, cz);
          const list = cells.get(k);
          if (list) list.push(...tri); else cells.set(k, tri.slice());
        };
        // Exactly the cells the triangle covers, row by row (cheap even for a long deck slab
        // lying at an angle); a huge flat pad (ground, plaza) is never a ceiling.
        if (coveredCells(tri, z0, z1, add) > MAX_CELLS) continue;
      }
      await tick();
    }
  }
  if (cells.size) {
    const o = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      for (const lat of [route.leftArr[i] * 0.7, 0, route.rightArr[i] * 0.7]) {
        route.toWorld(i * step, lat, 0.3, o);
        const list = cells.get(key(Math.floor(o.x / BIN), Math.floor(o.z / BIN)));
        if (!list) continue;
        for (let t = 0; t < list.length; t += 9) {
          const y = heightOver(list, t, o.x, o.z);
          if (y != null && y > o.y && y - o.y < 30) clear[i] = Math.min(clear[i], y - o.y + 0.3);
        }
      }
      if ((i & 255) === 0) await tick();
    }
  }
  return result(clear, n, step);
}

// Calls add(cx, cz) for every BIN cell the triangle (9 numbers) overlaps, one row of cells
// at a time: the triangle's x-extent within each row band comes from its corners in the band
// and its edges crossing the band's borders. Returns the number of cells (stops early past
// MAX_CELLS, before adding anything for such a huge triangle).
function coveredCells(tri, z0, z1, add) {
  const P = [[tri[0], tri[2]], [tri[3], tri[5]], [tri[6], tri[8]]];
  const rows = [];
  let count = 0;
  for (let cz = z0; cz <= z1; cz++) {
    const lo = cz * BIN;
    const hi = lo + BIN;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let e = 0; e < 3; e++) {
      const [ax, az] = P[e];
      const [bx, bz] = P[(e + 1) % 3];
      if (az >= lo && az <= hi) { minX = Math.min(minX, ax); maxX = Math.max(maxX, ax); }
      for (const zl of [lo, hi]) {
        if ((az - zl) * (bz - zl) < 0) {
          const x = ax + ((bx - ax) * (zl - az)) / (bz - az);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    if (minX > maxX) continue;
    const c0 = Math.floor(minX / BIN);
    const c1 = Math.floor(maxX / BIN);
    count += c1 - c0 + 1;
    if (count > MAX_CELLS) return count;
    rows.push(cz, c0, c1);
  }
  for (let r = 0; r < rows.length; r += 3) for (let cx = rows[r + 1]; cx <= rows[r + 2]; cx++) add(cx, rows[r]);
  return count;
}

// Height of triangle t of `list` straight above (x, z), or null if (x, z) is outside it.
function heightOver(list, t, x, z) {
  const ax = list[t], ay = list[t + 1], az = list[t + 2];
  const bx = list[t + 3], by = list[t + 4], bz = list[t + 5];
  const cx = list[t + 6], cy = list[t + 7], cz = list[t + 8];
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-9) return null;
  const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
  const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
  if (u < 0 || v < 0 || u + v > 1) return null;
  return ay * u + by * v + cy * (1 - u - v);
}

function result(clear, n, step) {
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
