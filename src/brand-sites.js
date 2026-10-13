import * as THREE from 'three';
import { BRANDS, LOOKS, FUEL_DEFAULT, CELL_SIZE, brandOf, drawBrandCell } from './brands.js';

// Brand buildings and business signs along the road, from the map data (see brands.js for
// the brand table). Every footprint gets a role:
//   canopy / kiosk  gas stations: the canopy on columns over pumps (never a solid box), the
//                   shop, a forecourt and a price sign at the road
//   pad             a standalone restaurant, cafe or bank drawn in its brand's look (LOOKS)
//   box             big boxes: world.js draws the walls in brand colours; here the entrance
//                   portal with the logo and a pylon sign
//   hotel / dealer  logo high on the wall (hotels) or on a portal with a glass showroom
//                   (dealers), pylon sign
//   mall            strip malls: a sign per tenant along the front, a pylon listing them
//   store / name    one sign on the wall facing the road (logo or the business name)
// planBrandSites() decides the roles (world.js skips the footprints drawn here), then
// buildBrandSites() draws everything per square (CHUNK) in up to three meshes: plain
// surfaces and glowing signs on atlas page 0 (logos, price panels, surface patterns), and
// business names on page 1. Roadside signs are placed only where an exact check finds no
// road, sidewalk, building or gas station forecourt (spotChecker), never on the driven road.

// Brand geometry is sparse (a few thousand triangles per square), so it is merged per 1 km
// square: half the draw calls of 500 m pieces, still culled when out of view.
const CHUNK = 1000;

// ---------- footprint helpers ----------
function ringOf(b) {
  const ring = [];
  for (let k = 0; k < b.p.length; k += 2) ring.push([b.p[k] / 10, b.p[k + 1] / 10]);
  return ring;
}
function polyArea(ring) {
  let a = 0;
  for (let k = 0; k < ring.length; k++) {
    const [x1, z1] = ring[k];
    const [x2, z2] = ring[(k + 1) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}
function centroid(ring) {
  let cx = 0;
  let cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  return [cx / ring.length, cz / ring.length];
}
// Orient a ring so each edge's normal (-dz, dx) points outward (same rule as world.js).
function outward(ring) {
  const [cx, cz] = centroid(ring);
  let out = 0;
  for (let k = 0; k < ring.length; k++) {
    const [x1, z1] = ring[k];
    const [x2, z2] = ring[(k + 1) % ring.length];
    out += -(z2 - z1) * ((x1 + x2) / 2 - cx) + (x2 - x1) * ((z1 + z2) / 2 - cz);
  }
  return out < 0 ? ring.slice().reverse() : ring;
}
// Smallest rectangle around a ring: centre, long axis (ux, uz), half sizes A >= B.
function orientedBox(ring) {
  let best = null;
  for (let k = 0; k < ring.length; k++) {
    const [x1, z1] = ring[k];
    const [x2, z2] = ring[(k + 1) % ring.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.5) continue;
    const ax = (x2 - x1) / len;
    const az = (z2 - z1) / len;
    let minA = Infinity; let maxA = -Infinity; let minB = Infinity; let maxB = -Infinity;
    for (const [x, z] of ring) {
      const a = x * ax + z * az;
      const b = -x * az + z * ax;
      minA = Math.min(minA, a); maxA = Math.max(maxA, a); minB = Math.min(minB, b); maxB = Math.max(maxB, b);
    }
    const area = (maxA - minA) * (maxB - minB);
    if (!best || area < best.area) best = { area, ax, az, minA, maxA, minB, maxB };
  }
  if (!best) return null;
  const { ax, az, minA, maxA, minB, maxB } = best;
  const ca = (minA + maxA) / 2;
  const cb = (minB + maxB) / 2;
  let A = (maxA - minA) / 2;
  let B = (maxB - minB) / 2;
  let ux = ax;
  let uz = az;
  if (B > A) { [A, B] = [B, A]; ux = -az; uz = ax; }
  return { cx: ca * ax - cb * az, cz: ca * az + cb * ax, ux, uz, A, B, area: best.area };
}
function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const boxRing = (o) => {
  const { cx, cz, ux, uz, A, B } = o;
  return [[cx - ux * A + uz * B, cz - uz * A - ux * B], [cx + ux * A + uz * B, cz + uz * A - ux * B], [cx + ux * A - uz * B, cz + uz * A + ux * B], [cx - ux * A - uz * B, cz - uz * A + ux * B]];
};
// Gas stations whose canopy, walkway and shop came as one merged outline (a T or an L):
// slice the outline across one of its axes and group the slices of similar width. The
// canopy is the wide, thin part, the shop the compact one; the walkway is left out.
// Returns { canopy, kiosk } as rectangles (kiosk may be null), or null when it doesn't split.
function splitStation(ring, box) {
  const R = 0.5;
  const { cx, cz, ux, uz, A, B } = box;
  const nx = Math.max(1, Math.ceil((2 * A) / R));
  const ny = Math.max(1, Math.ceil((2 * B) / R));
  if (nx * ny > 40000) return null;
  const grid = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = -A + (i + 0.5) * R;
      const b = -B + (j + 0.5) * R;
      if (pointInRing(cx + ux * a - uz * b, cz + uz * a + ux * b, ring)) grid[j * nx + i] = 1;
    }
  }
  let best = null;
  for (const along of [0, 1]) {
    // Slices across the axis: filled count and extent of each.
    const n = along ? ny : nx;
    const m = along ? nx : ny;
    const prof = [];
    for (let s = 0; s < n; s++) {
      let cnt = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (let t = 0; t < m; t++) {
        if (grid[along ? s * nx + t : t * nx + s]) { cnt++; lo = Math.min(lo, t); hi = Math.max(hi, t); }
      }
      prof.push({ cnt, lo, hi });
    }
    // Slicing this way must cut each part in one piece (a slice through both the shop and
    // the canopy means the walkway runs the other way).
    const filled = prof.filter((p) => p.cnt);
    if (filled.filter((p) => p.cnt >= 0.9 * (p.hi - p.lo + 1)).length < 0.9 * filled.length) continue;
    // Runs of similar width, then short runs merged into their neighbours.
    let runs = [];
    for (let s = 0; s < n; s++) {
      const p = prof[s];
      if (!p.cnt) continue;
      const r = runs[runs.length - 1];
      if (r && r.s1 === s && Math.abs(p.cnt - r.sum / (r.s1 - r.s0)) <= Math.max(4, 0.22 * (r.sum / (r.s1 - r.s0)))) {
        r.s1 = s + 1; r.sum += p.cnt; r.lo = Math.min(r.lo, p.lo); r.hi = Math.max(r.hi, p.hi);
      } else runs.push({ s0: s, s1: s + 1, sum: p.cnt, lo: p.lo, hi: p.hi });
    }
    for (let guard = 0; guard < 20 && runs.length > 1; guard++) {
      const k = runs.findIndex((r) => r.s1 - r.s0 < 5);
      if (k < 0) break;
      const r = runs[k];
      const w = r.sum / (r.s1 - r.s0);
      const nb = [runs[k - 1], runs[k + 1]].filter((q) => q && (q.s1 === r.s0 || q.s0 === r.s1));
      if (!nb.length) { runs.splice(k, 1); continue; }
      // A sliver (a rounded corner, a step) joins the neighbour of closer width without
      // widening it.
      const q = nb.reduce((a, c) => (Math.abs(c.sum / (c.s1 - c.s0) - w) < Math.abs(a.sum / (a.s1 - a.s0) - w) ? c : a));
      const qw = q.sum / (q.s1 - q.s0);
      q.s0 = Math.min(q.s0, r.s0); q.s1 = Math.max(q.s1, r.s1); q.sum += qw * (r.s1 - r.s0);
      runs.splice(k, 1);
    }
    if (runs.length < 2) continue;
    runs = runs.map((r) => {
      const len = (r.s1 - r.s0) * R; // along the slicing axis
      const wid = (r.hi - r.lo + 1) * R; // across it
      return { ...r, len, wid, area: r.sum * R * R, mean: (r.sum / (r.s1 - r.s0)) * R };
    });
    const widths = runs.map((r) => r.mean);
    const contrast = Math.max(...widths) / Math.max(0.5, Math.min(...widths));
    if (contrast < 1.6) continue;
    // Canopy: the wider end part, extra credit when it is thin (a bar of pump islands).
    const canopy = [runs[0], runs[runs.length - 1]].reduce((a, r) => (r.area >= 50 && (!a || r.wid * (r.len <= 0.6 * r.wid ? 1.5 : 1) > a.wid * (a.len <= 0.6 * a.wid ? 1.5 : 1)) ? r : a), null);
    if (!canopy || canopy.mean < 0.85 * Math.max(...widths)) continue;
    // Shop: compact, preferably at the far end from the canopy (a walkway sits between).
    const ci = runs.indexOf(canopy);
    const far = ci === 0 ? runs[runs.length - 1] : ci === runs.length - 1 ? runs[0] : null;
    const ok = (r) => r && r !== canopy && r.area >= 40 && Math.max(r.len, r.wid) / Math.min(r.len, r.wid) <= 3.2;
    const kiosk = ok(far) ? far : runs.filter(ok).sort((p, q) => q.area - p.area)[0] ?? null;
    if (!best || contrast > best.contrast) best = { contrast, along, canopy, kiosk };
  }
  if (!best) return null;
  // Back to map rectangles.
  const toRect = (r) => {
    const s0 = r.s0 * R;
    const s1 = r.s1 * R;
    const t0 = r.lo * R;
    const t1 = (r.hi + 1) * R;
    const [a0, a1, b0, b1] = best.along ? [t0 - A, t1 - A, s0 - B, s1 - B] : [s0 - A, s1 - A, t0 - B, t1 - B];
    const am = (a0 + a1) / 2;
    const bm = (b0 + b1) / 2;
    let pa = (a1 - a0) / 2;
    let pb = (b1 - b0) / 2;
    let pux = ux;
    let puz = uz;
    if (pb > pa) { [pa, pb] = [pb, pa]; pux = -uz; puz = ux; }
    return { cx: cx + ux * am - uz * bm, cz: cz + uz * am + ux * bm, ux: pux, uz: puz, A: pa, B: pb, area: 4 * pa * pb };
  };
  return { canopy: toRect(best.canopy), kiosk: best.kiosk ? toRect(best.kiosk) : null };
}

// ---------- planning ----------
const BRAND_BY_ID = new Map(BRANDS.map((b) => [b.id, b]));
const FOOD = new Set(['food', 'cafe']);
const SHOP_KINDS = new Set(['retail', 'grocery', 'pharmacy', 'service']);
// Name signs for unbranded places only on these classes (as before): retail, office,
// civic, hotel, school, big box.
const SIGN_CLASSES = new Set([4, 6, 7, 9, 12, 13]);

const NO_SLICES = { due: () => false, wait: async () => {}, tick: async () => {} };

// Direction of the road nearest a point (the route or a side street within 80 m), and the
// unit vector from that road towards the point.
function roadDirAt(data, nearest, x, z) {
  let best = null;
  const nr = nearest(x, z, 80);
  if (nr) {
    const R = data.route;
    const i0 = Math.max(0, nr.i - 2);
    const i1 = Math.min(R.x.length - 1, nr.i + 2);
    const l = Math.hypot(R.x[i1] - R.x[i0], R.z[i1] - R.z[i0]) || 1;
    best = { d: nr.d, tx: (R.x[i1] - R.x[i0]) / l, tz: (R.z[i1] - R.z[i0]) / l, px: R.x[nr.i], pz: R.z[nr.i] };
  }
  for (const r of data.roads) {
    for (let k = 2; k < r.p.length; k += 2) {
      const ax = r.p[k - 2] / 10; const az = r.p[k - 1] / 10; const bx = r.p[k] / 10; const bz = r.p[k + 1] / 10;
      if (Math.abs(ax - x) > 120 && Math.abs(bx - x) > 120) continue;
      const dx = bx - ax; const dz = bz - az; const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const px = ax + dx * t; const pz = az + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < 80 && (!best || d < best.d)) { const l = Math.sqrt(l2); best = { d, tx: dx / l, tz: dz / l, px, pz }; }
    }
  }
  if (!best) return null;
  const al = Math.hypot(x - best.px, z - best.pz) || 1;
  return { tx: best.tx, tz: best.tz, ax: (x - best.px) / al, az: (z - best.pz) / al };
}

// `nearest(x, z, maxR)` = the nearest route sample {i, d} (routeLookup in world.js); `sl` lets
// the menu keep drawing meanwhile (slicer in world.js).
export async function planBrandSites(data, nearest, sl = NO_SLICES) {
  const list = data.buildings;
  const memo = new Map();
  const info = (i) => {
    if (memo.has(i)) return memo.get(i);
    const b = list[i];
    const ring = outward(ringOf(b));
    const [cx, cz] = centroid(ring);
    const area = polyArea(ring);
    const box = orientedBox(ring);
    const o = { i, b, ring, cx, cz, area, h: b.h / 10, box, rect: box ? area / box.area : 0, brand: brandOf(b.br, b.n) };
    memo.set(i, o);
    return o;
  };
  // Low buildings by 40 m cell, to find the parts of a gas station.
  const CELL = 40;
  const grid = new Map();
  const gridAll = new Map();
  const cellKey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const centres = new Float32Array(list.length * 2);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if ((i & 255) === 0 && sl.due()) await sl.wait();
    let cx = 0;
    let cz = 0;
    const n = b.p.length / 2;
    for (let k = 0; k < b.p.length; k += 2) { cx += b.p[k]; cz += b.p[k + 1]; }
    cx /= n * 10;
    cz /= n * 10;
    centres[i * 2] = cx;
    centres[i * 2 + 1] = cz;
    const k = cellKey(cx, cz);
    if (!gridAll.has(k)) gridAll.set(k, []);
    gridAll.get(k).push(i);
    if (b.h > 95) continue;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const around = (x, z, r, g = grid) => {
    const out = [];
    for (let a = Math.floor((x - r) / CELL); a <= Math.floor((x + r) / CELL); a++) {
      for (let c = Math.floor((z - r) / CELL); c <= Math.floor((z + r) / CELL); c++) {
        for (const i of g.get(`${a},${c}`) ?? []) if (Math.hypot(centres[i * 2] - x, centres[i * 2 + 1] - z) <= r) out.push(i);
      }
    }
    return out;
  };

  const skip = new Set();
  const used = new Set();
  const fuel = [];
  const pads = [];
  const marks = [];

  // ----- gas stations -----
  const seeds = [];
  list.forEach((b, i) => { if (b.k === 'fuel') seeds.push({ i, x: centres[i * 2], z: centres[i * 2 + 1] }); });
  for (const p of data.pois ?? []) if (p.k === 'fuel') seeds.push({ poi: p, x: p.x, z: p.z });
  const sites = [];
  for (const s of seeds) {
    const site = sites.find((t) => Math.hypot(t.x - s.x, t.z - s.z) < 45);
    if (site) site.seeds.push(s);
    else sites.push({ x: s.x, z: s.z, seeds: [s] });
  }
  const canopyScore = (o, seed) => {
    if (!o.box) return -99;
    let sc = 0;
    if (o.b.c === 8) sc += 3; // building=roof in OpenStreetMap: a canopy
    if (o.b.k === 'fuel') sc += 2;
    if (o.box.A / Math.max(o.box.B, 0.5) >= 2) sc += 2;
    if (o.box.B * 2 <= 14) sc += 1;
    if (o.rect >= 0.85) sc += 1;
    if (o.b.k && o.b.k !== 'fuel') sc -= 6;
    if (o.b.ps?.length) sc -= 3;
    if (o.h > 7.5) sc -= 2;
    if (!seed && !(o.b.c === 8 || (o.box.A / Math.max(o.box.B, 0.5) >= 2 && !o.b.n))) sc -= 4;
    return sc;
  };
  for (const site of sites) {
    if (sl.due()) await sl.wait();
    const seedIdx = site.seeds.filter((s) => s.i != null).map((s) => s.i);
    const poi = site.seeds.find((s) => s.poi)?.poi ?? null;
    // Brand: from the fuel-tagged footprints, else the POI.
    let brand = null;
    for (const i of seedIdx) { const o = info(i); if (o.brand && (o.brand.fuel || o.brand.kind === 'fuel')) { brand = o.brand; break; } }
    if (!brand && poi) brand = brandOf(poi.br, poi.n);
    if (brand && !brand.fuel) brand = null;
    const near = around(site.x, site.z, 60).filter((i) => !used.has(i));
    const cand = near.map(info).filter((o) => o.h <= 8.5 && o.area >= 25 && o.area <= 1500 && o.box);
    // Duplicate outlines of the same thing (city + OpenStreetMap): keep the tidier one.
    const dup = new Set();
    for (const a of cand) {
      for (const c of cand) {
        if (a === c || dup.has(a.i) || dup.has(c.i)) continue;
        if (pointInRing(c.cx, c.cz, a.ring) && pointInRing(a.cx, a.cz, c.ring) && a.area / c.area < 2 && c.area / a.area < 2) {
          const worse = canopyScore(a, a.b.k === 'fuel') + a.rect >= canopyScore(c, c.b.k === 'fuel') + c.rect ? c : a;
          dup.add(worse.i);
        }
      }
    }
    const live = cand.filter((o) => !dup.has(o.i));
    let canopy = null;
    let kiosk = null;
    let best = null;
    // Unnamed canopy-shaped neighbours count within 45 m of a fuel footprint or point.
    const refs = site.seeds.map((t) => (t.i != null ? [centres[t.i * 2], centres[t.i * 2 + 1]] : [t.x, t.z]));
    for (const o of live) {
      const isSeed = seedIdx.includes(o.i);
      if (!isSeed && Math.min(...refs.map(([x, z]) => Math.hypot(x - o.cx, z - o.cz))) > 45) continue;
      // A fuel-tagged merged outline (canopy + walkway + shop) that splits cleanly is the station.
      const split = isSeed && o.rect < 0.85 && o.area > 150 ? splitStation(o.ring, o.box) : null;
      const sc = split ? 10 : canopyScore(o, isSeed);
      if (sc >= (isSeed ? 1 : 3) && (!best || sc > best.sc)) best = { o, sc, split };
    }
    if (best) {
      const { o, split } = best;
      canopy = { ...(split ? split.canopy : o.box), i: o.i, h: o.h };
      if (split?.kiosk) kiosk = { ring: outward(boxRing(split.kiosk)), h: o.h, i: o.i, b: o.b, brand: o.brand, tenants: o.b.ps };
      skip.add(o.i);
      used.add(o.i);
    }
    if (!canopy && poi && !seedIdx.length) {
      // Only a point on the map: a standard canopy there, along the nearest road (placed clear
      // of roads and buildings when it is built, or left out).
      const r = roadDirAt(data, nearest, poi.x, poi.z);
      if (r) canopy = { cx: poi.x, cz: poi.z, ux: r.tx, uz: r.tz, A: 12, B: 4.5, h: 5.6, i: null, away: [r.ax, r.az] };
    }
    if (!canopy) continue; // a fuel-tagged shop alone: left as it is
    // The shop: a convenience store or fuel-tagged building nearby, else an unnamed one.
    if (!kiosk) {
      let bestK = null;
      for (const o of live) {
        if (used.has(o.i) || o.area < 40 || o.area > 700) continue;
        const d = Math.hypot(o.cx - canopy.cx, o.cz - canopy.cz) - Math.max(canopy.A, canopy.B) * 0.5;
        if (d > 40) continue;
        let sc = -d * 0.08;
        const ob = o.brand;
        if (o.b.k === 'convenience') sc += 3;
        else if (o.b.k === 'fuel') sc += 2;
        else if (!o.b.k && !o.b.n && !o.b.br) { if (d > 22 || o.rect < 0.8) continue; }
        else if (ob && brand && ob.id === brand.id && !o.b.k) sc += 1;
        else continue;
        if (ob && brand && ob.id === brand.id) sc += 2;
        if (!bestK || sc > bestK.sc) bestK = { o, sc };
      }
      if (bestK) {
        const o = bestK.o;
        kiosk = { ring: o.ring, h: o.h, i: o.i, b: o.b, brand: o.brand, tenants: o.b.ps };
        skip.add(o.i);
        used.add(o.i);
      }
    }
    for (const i of dup) { skip.add(i); used.add(i); }
    fuel.push({ brand, canopy, kiosk, name: brand ? null : ((canopy.i != null ? list[canopy.i].n : null) ?? poi?.n ?? null) });
  }

  // ----- everything else with a brand or a name -----
  for (let i = 0; i < list.length; i++) {
    if ((i & 63) === 0 && sl.due()) await sl.wait();
    if (used.has(i)) continue;
    const b = list[i];
    if (!b.n && !b.br && !b.ps) continue;
    const o = info(i);
    const brand = o.brand;
    const tenants = (b.ps ?? []).map(([n, br, k]) => ({ n, brand: brandOf(br, n), k })).filter((t) => t.n);
    const road = nearest(o.cx, o.cz, 340);
    if (!road) continue;
    const kind = brand?.kind;
    if (brand && (FOOD.has(kind) || kind === 'bank' || (kind === 'service' && brand.look)) && brand.look
      && o.area <= (kind === 'bank' ? 1600 : 1100) && o.h <= (kind === 'bank' ? 12 : 9) && o.rect >= 0.55
      && tenants.length <= 2 && road.d <= 300) {
      // Duplicate outlines on top of it are dropped with it.
      for (const j of around(o.cx, o.cz, 30)) {
        if (j === i || used.has(j)) continue;
        const q = info(j);
        if (pointInRing(q.cx, q.cz, o.ring) && q.area / o.area < 2.5) { skip.add(j); used.add(j); }
      }
      pads.push({ i, brand, look: LOOKS[brand.look] ?? LOOKS.generic, tenants, road });
      skip.add(i);
      used.add(i);
      continue;
    }
    let role = null;
    if (brand && kind === 'hotel') role = 'hotel';
    else if (brand && kind === 'car') role = 'dealer';
    else if (tenants.length && (tenants.some((t) => t.brand) || brand)) role = 'mall';
    else if (brand && (SHOP_KINDS.has(kind) || kind === 'fuel' || FOOD.has(kind) || kind === 'bank')) role = o.area >= 1200 || b.c === 13 ? 'box' : 'store';
    else if (b.n && SIGN_CLASSES.has(b.c)) role = tenants.length ? 'mall' : 'name';
    if (!role) continue;
    const bigLot = b.c === 13 || b.c === 9 || o.area >= 2000;
    if (!bigLot && road.d > 220) continue; // small shops far behind a parking lot aren't worth a sign
    marks.push({ i, role, brand, tenants, road, bigLot });
    used.add(i);
  }
  // Two outlines of one building (city footprint + OpenStreetMap) with the same brand or
  // name: only the bigger one gets the portal and signs.
  const byKey = new Map();
  for (const m of marks) {
    const key = m.brand?.id ?? list[m.i].n;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(m);
  }
  const dropped = new Set();
  for (const group of byKey.values()) {
    for (const a of group) {
      for (const c of group) {
        if (a === c || dropped.has(a) || dropped.has(c)) continue;
        const oa = info(a.i);
        const oc = info(c.i);
        if (oa.area >= oc.area && (pointInRing(oc.cx, oc.cz, oa.ring) || pointInRing(oa.cx, oa.cz, oc.ring))) dropped.add(c);
      }
    }
  }
  const kept = marks.filter((m) => !dropped.has(m));
  // The duplicate outline itself isn't drawn either (its walls would hide the signs and
  // showroom glass of the one kept).
  for (const m of kept) {
    const o = info(m.i);
    for (const j of around(o.cx, o.cz, 40, gridAll)) {
      if (j === m.i || used.has(j) && !dropped.has(marks.find((d) => d.i === j))) continue;
      const q = info(j);
      if (q.area / o.area > 0.6 && q.area / o.area < 1.67 && pointInRing(q.cx, q.cz, o.ring) && pointInRing(o.cx, o.cz, q.ring)) {
        skip.add(j);
        used.add(j);
      }
    }
  }
  return { skip, fuel, pads, marks: kept, info };
}

// ---------- the atlas ----------
const PAD = 4;
const SIGN_FONT = 'bold 46px -apple-system, Helvetica, Arial, sans-serif';
const SIGN_STYLES = [
  ['#ffffff', '#c8102e'], ['#ffffff', '#1f4fb0'], ['#ffd84d', '#1c1c1e'], ['#1c1c1e', '#f4f4f0'], ['#ffffff', '#1d7a46'],
  ['#ffffff', '#e8731c'], ['#f4f4f0', '#4a2d8a'], ['#1c1c1e', '#ffc42e'],
];
function hash(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
// Fixed cells: [key, width, height, draw]. Pattern cells tile (their edges match).
let noiseSeed = 1;
const rnd = () => {
  noiseSeed = (noiseSeed + 0x6d2b79f5) | 0;
  let t = Math.imul(noiseSeed ^ (noiseSeed >>> 15), 1 | noiseSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
function speckle(g, w, h, n, lo, hi, size = 2) {
  for (let i = 0; i < n; i++) {
    const v = (lo + rnd() * (hi - lo)) | 0;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(rnd() * w, rnd() * h, size, size);
  }
}
const FIXED = [
  ['white', 16, 16, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }],
  // Storefront glass: one bay (about 2.5 m × 2.2 m), frame, reflection, warm lit interior.
  ['glass', 128, 112, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2a3644');
    grad.addColorStop(0.55, '#3b4a5a');
    grad.addColorStop(1, '#9a8060');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,214,150,0.35)';
    g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.moveTo(w * 0.15, 0); g.lineTo(w * 0.45, 0); g.lineTo(w * 0.1, h); g.lineTo(0, h); g.lineTo(0, h * 0.5); g.fill();
    g.fillStyle = '#2b2c2f';
    g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6); g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h);
    g.fillRect(0, h * 0.2, w, 4);
  }],
  // Canopy underside: white panels with bright light fixtures (one tile ≈ 3 m).
  ['light', 128, 128, (g, w, h) => {
    g.fillStyle = '#dcdcd8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c4c4c0'; g.fillRect(0, h / 2 - 1, w, 2); g.fillRect(w / 2 - 1, 0, 2, h);
    g.fillStyle = '#ffffff';
    for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]]) g.fillRect(w * x - 18, h * y - 18, 36, 36);
    g.fillStyle = '#fffbe8';
    for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]]) g.fillRect(w * x - 12, h * y - 12, 24, 24);
  }],
  // Pump face: screen, keypad, price display, hose holster.
  ['screen', 64, 96, (g, w, h) => {
    g.fillStyle = '#e8e8e6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d2228'; g.fillRect(8, 8, w - 16, 26);
    g.fillStyle = '#6fd0ff'; g.fillRect(12, 12, w - 24, 18);
    g.fillStyle = '#2b2f35'; g.fillRect(8, 40, w - 16, 14);
    g.fillStyle = '#ff6a3d'; g.font = 'bold 11px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('45.20', w / 2, 47);
    g.fillStyle = '#9aa0a6';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g.fillRect(14 + c * 13, 60 + r * 9, 9, 6);
    g.fillStyle = '#2b2f35'; g.fillRect(w / 2 - 6, h - 12, 12, 10);
  }],
  // Price panels (cents per litre): LED digits on black.
  ['price0', 256, 160, (g, w, h) => priceCell(g, w, h, ['REGULAR', '145.9'], ['DIESEL', '159.9'])],
  ['price1', 256, 160, (g, w, h) => priceCell(g, w, h, ['REGULAR', '147.9'], ['PREMIUM', '167.9'])],
  // KFC's red and white bucket stripes (one tile ≈ 2 m).
  ['stripes', 128, 64, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#c8102e'; g.fillRect((i * w) / 8, 0, w / 8 + 0.5, h); } }],
  // Red and white checks (Five Guys), one tile ≈ 1.2 m.
  ['checker', 64, 64, (g, w, h) => { const s = w / 4; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#ffffff' : '#d21033'; g.fillRect(i * s, j * s, s + 0.5, s + 0.5); } }],
  // Neutral patterns, tinted by the vertex colour: brick, stone, wood slats, metal panels, stucco (one tile ≈ 2 m).
  ['brick', 128, 128, (g, w, h) => {
    g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      for (let x = (y / 8) % 2 ? -8 : 0; x < w; x += 16) {
        const v = (215 + rnd() * 40) | 0;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x + 1, y + 1, 14, 6);
      }
    }
  }],
  ['stone', 128, 128, (g, w, h) => {
    g.fillStyle = '#a8a8a8'; g.fillRect(0, 0, w, h);
    let y = 0;
    while (y < h) {
      const rh = 10 + ((rnd() * 3) | 0) * 4;
      let x = -(rnd() * 20) | 0;
      while (x < w) {
        const rw = 14 + ((rnd() * 4) | 0) * 6;
        const v = (200 + rnd() * 55) | 0;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x + 1, y + 1, rw - 2, Math.min(rh, h - y) - 2);
        x += rw;
      }
      y += rh;
    }
  }],
  ['wood', 128, 128, (g, w, h) => {
    for (let x = 0; x < w; x += 8) {
      const v = (205 + rnd() * 50) | 0;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, 0, 8, h);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 7, 0, 1, h);
      g.fillStyle = 'rgba(0,0,0,0.06)';
      for (let k = 0; k < 6; k++) g.fillRect(x + 1 + rnd() * 5, rnd() * h, 1, 10 + rnd() * 30);
    }
  }],
  ['panel', 128, 128, (g, w, h) => {
    g.fillStyle = '#f0f0f0'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 120, 225, 250);
    g.fillStyle = '#9a9a9a';
    g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(0, h / 2, w, 2); g.fillRect(w / 2, 0, 2, h);
  }],
  ['stucco', 128, 128, (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, 200, 255, 2);
  }],
];
function priceCell(g, w, h, a, b) {
  g.fillStyle = '#121314';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#3a3c40';
  g.lineWidth = 6;
  g.strokeRect(3, 3, w - 6, h - 6);
  for (const [k, [label, price]] of [[0, a], [1, b]]) {
    const y = h * (0.27 + k * 0.47);
    // Label stacked in a narrow column at the left, LED digits filling the rest.
    g.fillStyle = '#f4f4f0';
    g.font = 'bold 15px Helvetica, Arial, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(label, 14, y - 22);
    g.fillStyle = k ? '#ffb000' : '#ff3b1f';
    g.font = 'bold 60px "Courier New", Courier, monospace';
    g.textAlign = 'center';
    g.fillText(price, w / 2 + 6, y + 8);
  }
}

// The atlas has two pages (one texture each). Page 0: the fixed cells and the brands' badges
// and wide signs, drawn as large as lets every brand on the map fit. Page 1: the names of
// other businesses, most important first (atlasRequests), as many as fit; signs left out
// simply aren't put up. Cells are uv rects [u0, v0, u1, v1, aspect, page].
const PAGE_W = 2048;
const PAGE_H = 2048;
function nameCell(key, measure) {
  const name = key.slice(5);
  const w = Math.min(1024, Math.ceil(measure.measureText(name).width) + 28);
  return {
    key, w, h: 64,
    draw(g, cw, ch) {
      const [fg, bgc] = SIGN_STYLES[Math.floor(hash(name.length * 3.1, name.charCodeAt(0)) * SIGN_STYLES.length)];
      g.fillStyle = bgc;
      g.fillRect(0, 0, cw, ch);
      g.fillStyle = fg;
      g.font = SIGN_FONT;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      // Very long names are squeezed to fit the cell.
      const tw = g.measureText(name).width;
      if (tw > cw - 28) {
        g.save();
        g.translate(14, ch / 2 + 2);
        g.scale((cw - 28) / tw, 1);
        g.fillText(name, 0, 0);
        g.restore();
      } else g.fillText(name, 14, ch / 2 + 2);
    },
  };
}
const padded = (it) => (it.w + PAD * 2) * (it.h + PAD * 2);
// Shelf packing in the given order; returns the placed items and how many didn't fit.
function shelf(items, maxH = PAGE_H) {
  let x = 0;
  let y = 0;
  let rowH = 0;
  const placed = [];
  let dropped = 0;
  for (const it of items) {
    const w = it.w + PAD * 2;
    const h = it.h + PAD * 2;
    if (x + w > PAGE_W) { x = 0; y += rowH; rowH = 0; }
    if (y + h > maxH) { dropped++; continue; }
    placed.push({ it, x: x + PAD, y: y + PAD });
    x += w;
    rowH = Math.max(rowH, h);
  }
  return { placed, dropped, height: y + rowH };
}
async function drawPage(page, placed, height, cells, sl, maxAnisotropy) {
  // As tall as its content (WebGL2 mipmaps any size), in steps of 64 px.
  const H = Math.min(PAGE_H, Math.max(64, Math.ceil(height / 64) * 64));
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  let n = 0;
  for (const { it, x: px, y: py } of placed) {
    // Drawn a little enlarged so it covers its padding too (far-away, mipmapped signs then
    // don't bleed into their neighbours); the uv rect is the inner part. Drawing it twice, or
    // copying edge pixels canvas-to-itself, makes the GPU miss menu frames.
    g.save();
    g.translate(px - PAD, py - PAD);
    g.scale((it.w + PAD * 2) / it.w, (it.h + PAD * 2) / it.h);
    it.draw(g, it.w, it.h);
    g.restore();
    const e = 0.5;
    cells.set(it.key, [(px + e) / PAGE_W, 1 - (py + it.h - e) / H, (px + it.w - e) / PAGE_W, 1 - (py + e) / H, it.w / it.h, page]);
    if (sl.due()) await sl.wait();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.max(4, maxAnisotropy);
  return tex;
}
async function buildAtlas(requests, sl, maxAnisotropy) {
  noiseSeed = 7;
  const cells = new Map();
  const fixed = FIXED.map(([key, w, h, draw]) => ({ key, w, h, draw }));
  const brandKeys = requests.filter((k) => !k.startsWith('name|'));
  const nameKeys = requests.filter((k) => k.startsWith('name|'));
  // Page 0: brand signs as large as fits (with room for packing gaps), on the smallest page
  // that keeps them at 84 % or more; a busy map uses a full page with smaller signs.
  const fixedArea = fixed.reduce((a, it) => a + padded(it), 0);
  const brandItems = (scale) => brandKeys.map((key) => {
    const [id, fmt] = key.split('|');
    const brand = BRAND_BY_ID.get(id);
    const [w, h] = CELL_SIZE[fmt].map((v) => Math.round(v * scale));
    return { key, w, h, draw: (g, cw, ch) => drawBrandCell(brand, fmt, g, cw, ch) };
  });
  let items = null;
  let pageH = PAGE_H;
  search: for (const h of [512, 1024, PAGE_H]) {
    for (const scale of [1, 0.84, 0.72, 0.62, 0.54]) {
      if (h < PAGE_H && scale < 0.84) break;
      items = brandItems(scale);
      if (items.reduce((a, it) => a + padded(it), 0) <= PAGE_W * h * 0.86 - fixedArea) { pageH = h; break search; }
    }
  }
  // Fixed cells first, then by height (badges, then wide signs); the least important drop out
  // if even the smallest scale overflows.
  const order = items.map((it, k) => [it, k]).sort((a, b) => (b[0].h - a[0].h) || (a[1] - b[1])).map(([it]) => it);
  let p0 = shelf([...fixed, ...order], pageH);
  // Packing gaps can still overflow a small page: then use the next size up.
  while (p0.dropped && pageH < PAGE_H) { pageH *= 2; p0 = shelf([...fixed, ...order], pageH); }
  const pages = [await drawPage(0, p0.placed, p0.height, cells, sl, maxAnisotropy)];
  let dropped = p0.dropped;
  // Page 1: names in priority order.
  if (nameKeys.length) {
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = SIGN_FONT;
    const p1 = shelf(nameKeys.map((k) => nameCell(k, measure)));
    dropped += p1.dropped;
    if (p1.placed.length) pages.push(await drawPage(1, p1.placed, p1.height, cells, sl, maxAnisotropy));
  }
  const w0 = cells.get('white');
  const white = [(w0[0] + w0[2]) / 2, (w0[1] + w0[3]) / 2, (w0[0] + w0[2]) / 2, (w0[1] + w0[3]) / 2];
  return { pages, cells, white, dropped, cell: (key) => cells.get(key) ?? null };
}

// ---------- geometry ----------
const colorCache = new Map();
function col(hexValue) {
  if (!colorCache.has(hexValue)) colorCache.set(hexValue, new THREE.Color(hexValue));
  return colorCache.get(hexValue);
}
const WHITE = 0xffffff;

class GB {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.t = [];
  }
  tri(a, b, c, color, ta, tb, tc, nrm) {
    let nx;
    let ny;
    let nz;
    if (nrm) [nx, ny, nz] = nrm;
    else {
      const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
      const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
    }
    const cc = col(color);
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.c.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
    this.t.push(ta[0], ta[1], tb[0], tb[1], tc[0], tc[1]);
  }
  // Quad a-b-c-d counter-clockwise seen from the front; uv rect r = [u0, v0, u1, v1] puts
  // (u0, v0) at a, (u1, v0) at b, (u1, v1) at c and (u0, v1) at d.
  quad(a, b, c, d, color, r) {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = d[0] - a[0]; const vy = d[1] - a[1]; const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const n = [nx, ny, nz];
    this.tri(a, b, c, color, [r[0], r[1]], [r[2], r[1]], [r[2], r[3]], n);
    this.tri(a, c, d, color, [r[0], r[1]], [r[2], r[3]], [r[0], r[3]], n);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    return g;
  }
}

// Drawing context: geometry per square (CHUNK), the atlas, the ground.
class Ctx {
  constructor(atlas, heightAt) {
    this.atlas = atlas;
    this.heightAt = heightAt;
    this.chunks = new Map();
    this.cur = null;
  }
  at(x, z) {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    if (!this.chunks.has(k)) this.chunks.set(k, { S: new GB(), G: new GB(), N: new GB() });
    this.cur = this.chunks.get(k);
    return this.cur;
  }
  get S() { return this.cur.S; }
  get G() { return this.cur.G; }
  // The glowing builder for a sign cell: names live on the second atlas page.
  sg(cell) { return cell && cell[5] === 1 ? this.cur.N : this.cur.G; }
  ground(x, z, fallback = 0) { return this.heightAt(x, z) ?? fallback; }
  // A wall strip along p1→p2 (outward normal on the left of the walking direction as in
  // world.js), from y0 to y1, tiled with an atlas cell every tw × th metres.
  wall(gb, x1, z1, x2, z2, y0, y1, color, cell = 'white', tw = 2, th = 2, out = 0) {
    if (y1 - y0 < 0.01) return;
    const L = Math.hypot(x2 - x1, z2 - z1);
    if (L < 0.01) return;
    const dx = (x2 - x1) / L;
    const dz = (z2 - z1) / L;
    const ox = -dz * out;
    const oz = dx * out;
    const r = cell === 'white' ? this.atlas.white : this.atlas.cell(cell);
    const P = (a, y) => [x1 + dx * a + ox, y, z1 + dz * a + oz];
    if (cell === 'white' || !r) {
      gb.quad(P(0, y0), P(L, y0), P(L, y1), P(0, y1), color, this.atlas.white);
      return;
    }
    let a = 0;
    while (a < L - 1e-3) {
      const a2 = Math.min(L, (Math.floor(a / tw + 1e-6) + 1) * tw);
      const fu0 = a / tw - Math.floor(a / tw + 1e-6);
      const fu1 = fu0 + (a2 - a) / tw;
      let y = y0;
      while (y < y1 - 1e-3) {
        const yb = Math.min(y1, y0 + (Math.floor((y - y0) / th + 1e-6) + 1) * th);
        const fv0 = (y - y0) / th - Math.floor((y - y0) / th + 1e-6);
        const fv1 = fv0 + (yb - y) / th;
        gb.quad(P(a, y), P(a2, y), P(a2, yb), P(a, yb), color, [r[0] + (r[2] - r[0]) * fu0, r[1] + (r[3] - r[1]) * fv0, r[0] + (r[2] - r[0]) * fu1, r[1] + (r[3] - r[1]) * fv1]);
        y = yb;
      }
      a = a2;
    }
  }
  // A flat sign (atlas cell) facing (nx, nz), centred at (x, y, z).
  sign(gb, x, y, z, nx, nz, w, h, r, color = WHITE) {
    const rx = nz;
    const rz = -nx;
    const a = [x - rx * w / 2, y - h / 2, z - rz * w / 2];
    const b = [x + rx * w / 2, y - h / 2, z + rz * w / 2];
    const c = [x + rx * w / 2, y + h / 2, z + rz * w / 2];
    const d = [x - rx * w / 2, y + h / 2, z - rz * w / 2];
    gb.quad(a, b, c, d, color, r);
  }
  // A box with axes (ux, uz) and (-uz, ux), half sizes a × b, from y0 to y1.
  box(gb, cx, cz, ux, uz, a, b, y0, y1, side, top = side, bottom = null) {
    const vx = -uz;
    const vz = ux;
    const P = (sa, sb, y) => [cx + ux * a * sa + vx * b * sb, y, cz + uz * a * sa + vz * b * sb];
    const W = this.atlas.white;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const [sa, sb] = corners[k];
      const [ta, tb] = corners[(k + 1) % 4];
      // Walking -1,-1 → 1,-1 → 1,1 → -1,1 has the outside on the right: wind accordingly.
      gb.quad(P(ta, tb, y0), P(sa, sb, y0), P(sa, sb, y1), P(ta, tb, y1), side, W);
    }
    if (top != null) gb.quad(P(-1, -1, y1), P(-1, 1, y1), P(1, 1, y1), P(1, -1, y1), top, W);
    if (bottom != null) gb.quad(P(-1, -1, y0), P(1, -1, y0), P(1, 1, y0), P(-1, 1, y0), bottom, W);
  }
}

// Flat roof over a ring at height y.
function flatRoof(ctx, gb, ring, y, color) {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const W = ctx.atlas.white;
  for (const [ia, ib, ic] of tris) {
    const a = [ring[ia][0], y, ring[ia][1]];
    let b = [ring[ib][0], y, ring[ib][1]];
    let c = [ring[ic][0], y, ring[ic][1]];
    // Upward: (b - a) × (c - a) must have y > 0.
    if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) < 0) [b, c] = [c, b];
    gb.tri(a, b, c, color, W, W, W, [0, 1, 0]);
  }
}
// Ring moved outward by d (mitred corners).
function offsetRing(ring, d) {
  const n = ring.length;
  const out = [];
  for (let k = 0; k < n; k++) {
    const [x0, z0] = ring[(k - 1 + n) % n];
    const [x1, z1] = ring[k];
    const [x2, z2] = ring[(k + 1) % n];
    const l0 = Math.hypot(x1 - x0, z1 - z0) || 1;
    const l1 = Math.hypot(x2 - x1, z2 - z1) || 1;
    const n0x = -(z1 - z0) / l0; const n0z = (x1 - x0) / l0;
    const n1x = -(z2 - z1) / l1; const n1z = (x2 - x1) / l1;
    let mx = n0x + n1x;
    let mz = n0z + n1z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const cos = Math.max(0.5, mx * n0x + mz * n0z);
    out.push([x1 + (mx * d) / cos, z1 + (mz * d) / cos]);
  }
  return out;
}

// Which sign cell to use: the brand's wide sign if it has one (or `prefer` = 'badge').
function brandCell(atlas, brand, prefer = 'word') {
  const has = (fmt) => (fmt === 'badge' ? brand.badge : brand.word);
  const fmt = has(prefer) ? prefer : prefer === 'word' ? 'badge' : 'word';
  return atlas.cell(`${brand.id}|${fmt}`);
}

// Edge facts for a ring: length, direction, outward normal, how much it faces (tx, tz).
function edges(ring, tx, tz) {
  const out = [];
  for (let k = 0; k < ring.length; k++) {
    const [x1, z1] = ring[k];
    const [x2, z2] = ring[(k + 1) % ring.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.05) { out.push(null); continue; }
    const dx = (x2 - x1) / len;
    const dz = (z2 - z1) / len;
    const nx = -dz;
    const nz = dx;
    const mx = (x1 + x2) / 2;
    const mz = (z1 + z2) / 2;
    const tl = Math.hypot(tx - mx, tz - mz) || 1;
    out.push({ k, x1, z1, x2, z2, len, dx, dz, nx, nz, mx, mz, facing: ((tx - mx) * nx + (tz - mz) * nz) / tl });
  }
  return out;
}
const frontEdge = (es) => es.filter(Boolean).filter((e) => e.len >= 4).reduce((best, e) => {
  const sc = e.facing * Math.min(e.len, 30);
  return !best || sc > best.sc ? { e, sc } : best;
}, null)?.e ?? es.filter(Boolean)[0];

function groundBase(ctx, ring) {
  let base = Infinity;
  for (const [x, z] of ring) {
    const g = ctx.heightAt(x, z);
    if (g != null) base = Math.min(base, g);
  }
  return base === Infinity ? null : base - 0.5;
}

// A shop building in a look (restaurant, cafe, bank, gas station kiosk). `toward` = the point
// it faces (the road or the canopy). Returns the facts signs need.
function shopBuilding(ctx, ring, h, look, toward) {
  const base = groundBase(ctx, ring);
  if (base == null) return null;
  const S = ctx.S;
  const G = ctx.G;
  const top = base + 0.5 + Math.max(4, Math.min(h, 9));
  const es = edges(ring, toward[0], toward[1]);
  const front = frontEdge(es);
  const back = es.filter(Boolean).reduce((m, e) => (!m || e.facing < m.facing ? e : m), null);
  const bandH = look.bandH ?? 1.1;
  const mansard = look.mansard != null;
  const wallTop = top - (look.band != null || mansard ? bandH : 0);
  const plinthTop = Math.min(base + 0.5 + (look.baseH ?? 0.8), wallTop - 1);
  const winBot = plinthTop + 0.05;
  const winTop = Math.min(base + 0.5 + 3.0, wallTop - 0.25);
  for (const e of es) {
    if (!e) continue;
    ctx.wall(S, e.x1, e.z1, e.x2, e.z2, base, plinthTop, look.base ?? 0x7a776f, look.baseCell ?? 'white');
    ctx.wall(S, e.x1, e.z1, e.x2, e.z2, plinthTop, wallTop, look.wall, look.wallCell ?? 'white', look.wallCell === 'stucco' ? 3 : 2, 2);
    if (look.band != null && !mansard) ctx.wall(S, e.x1, e.z1, e.x2, e.z2, wallTop, top, look.band, look.bandCell ?? 'white', look.bandCell === 'checker' ? 1.2 : 2, bandH, 0.01);
    if (look.stripe != null) ctx.wall(S, e.x1, e.z1, e.x2, e.z2, wallTop - 0.42, wallTop - 0.18, look.stripe, 'white', 2, 2, 0.02);
    if (look.stripes) {
      // Thin coloured lines under the band (7-Eleven, Circle K kiosks).
      look.stripes.forEach((c, j) => ctx.wall(S, e.x1, e.z1, e.x2, e.z2, wallTop - 0.2 * (j + 1), wallTop - 0.2 * j, c, 'white', 2, 2, 0.02));
    }
    // Storefront windows on every side but the back.
    if (e !== back && e.len >= 4.5 && winTop - winBot > 1.2 && (e === front || e.facing > -0.6)) {
      const inset = 1.0;
      const usable = e.len - inset * 2;
      const nb = Math.max(1, Math.round(usable / 2.6));
      const bw = usable / nb;
      const r = ctx.atlas.cell('glass');
      for (let q = 0; q < nb; q++) {
        const a0 = inset + q * bw;
        const P = (a, y) => [e.x1 + e.dx * a + e.nx * 0.04, y, e.z1 + e.dz * a + e.nz * 0.04];
        G.quad(P(a0, winBot), P(a0 + bw, winBot), P(a0 + bw, winTop), P(a0, winTop), WHITE, r);
      }
      if (look.awning != null && e === front) {
        // A shallow awning over the front windows.
        const y = winTop + 0.12;
        const P = (a, o, yy) => [e.x1 + e.dx * a + e.nx * o, yy, e.z1 + e.dz * a + e.nz * o];
        S.quad(P(inset, 0.05, y), P(e.len - inset, 0.05, y), P(e.len - inset, 1.1, y - 0.35), P(inset, 1.1, y - 0.35), look.awning, ctx.atlas.white);
        S.quad(P(inset, 1.1, y - 0.35), P(e.len - inset, 1.1, y - 0.35), P(e.len - inset, 0.05, y - 0.05), P(inset, 0.05, y - 0.05), 0x55565a, ctx.atlas.white);
        S.quad(P(inset, 1.1, y - 0.35), P(inset, 1.1, y - 0.55), P(e.len - inset, 1.1, y - 0.55), P(e.len - inset, 1.1, y - 0.35), look.awning, ctx.atlas.white);
      }
    }
  }
  // Roof: mansard band (sloped, Dairy Queen style) or parapet with a coping.
  const roofCol = 0x8d8b86;
  if (mansard) {
    const lo = offsetRing(ring, 0.55);
    const hi = offsetRing(ring, -0.35);
    const W = ctx.atlas.white;
    for (let k = 0; k < ring.length; k++) {
      const k2 = (k + 1) % ring.length;
      S.quad([lo[k][0], wallTop, lo[k][1]], [lo[k2][0], wallTop, lo[k2][1]], [hi[k2][0], top, hi[k2][1]], [hi[k][0], top, hi[k][1]], look.mansard, W);
      // Soffit under the overhang.
      S.quad([lo[k2][0], wallTop, lo[k2][1]], [lo[k][0], wallTop, lo[k][1]], [ring[k][0], wallTop, ring[k][1]], [ring[k2][0], wallTop, ring[k2][1]], 0xd8d4cc, W);
    }
    flatRoof(ctx, S, hi, top, roofCol);
  } else {
    const inner = offsetRing(ring, -0.3);
    const roofY = top - 0.35;
    const W = ctx.atlas.white;
    for (let k = 0; k < ring.length; k++) {
      const k2 = (k + 1) % ring.length;
      S.quad([inner[k2][0], roofY, inner[k2][1]], [inner[k][0], roofY, inner[k][1]], [inner[k][0], top, inner[k][1]], [inner[k2][0], top, inner[k2][1]], look.band ?? look.wall, W);
      S.quad([ring[k][0], top, ring[k][1]], [ring[k2][0], top, ring[k2][1]], [inner[k2][0], top, inner[k2][1]], [inner[k][0], top, inner[k][1]], look.trim ?? 0x5c5a56, W);
    }
    flatRoof(ctx, S, inner, roofY, roofCol);
    // A rooftop unit.
    const [cx, cz] = centroid(ring);
    if (pointInRing(cx, cz, inner)) ctx.box(S, cx, cz, 1, 0, 1.1, 0.8, roofY, roofY + 1.1, 0xb7b9bb);
  }
  // Where fascia signs go: on the band, under a mansard, or high on the wall.
  const signY = mansard ? wallTop - 0.55 : look.band != null ? wallTop + bandH / 2 : top - 0.85;
  const signH = mansard ? 0.9 : look.band != null ? Math.min(bandH + 0.25, 1.35) : 1.1;
  return { base, top, wallTop, front, es, bandH, signY, signH };
}

// Tower at one end of the front wall (with the logo on its two outer faces).
function shopTower(ctx, f, t, brand) {
  const { front: e, top, base } = f;
  const S = ctx.S;
  const G = ctx.G;
  const size = Math.min(t.size ?? 4.4, e.len * 0.45);
  if (size < 2.5) return null;
  // The end of the front wall nearer the road point.
  const atStart = t.end != null ? t.end === 0 : true;
  const cxE = atStart ? e.x1 : e.x2;
  const czE = atStart ? e.z1 : e.z2;
  const ex = atStart ? e.dx : -e.dx; // along the wall, into the building's length
  const ez = atStart ? e.dz : -e.dz;
  const cx = cxE + ex * (size / 2 - 0.4) + e.nx * (0.6 - size / 2);
  const cz = czE + ez * (size / 2 - 0.4) + e.nz * (0.6 - size / 2);
  const tTop = top + (t.up ?? 2.6);
  const hs = size / 2;
  // Walls (tiled), band and cap.
  const vx = -e.nz;
  const vz = e.nx;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + e.nx * hs * a + vx * hs * b, cz + e.nz * hs * a + vz * hs * b]);
  const ring = outward(corners);
  const bandTop = tTop;
  const bandBot = t.band != null ? tTop - 0.9 : tTop;
  for (let k = 0; k < 4; k++) {
    const [x1, z1] = ring[k];
    const [x2, z2] = ring[(k + 1) % 4];
    ctx.wall(S, x1, z1, x2, z2, base, bandBot, t.col, t.cell ?? 'white', 2, 2);
    if (t.band != null) ctx.wall(S, x1, z1, x2, z2, bandBot, bandTop, t.band, 'white', 2, 2, 0.01);
  }
  if (t.cap != null) {
    // Hip-roof cap (terracotta tile on Boston Pizza / Olive Garden towers).
    const eave = offsetRing(ring, 0.45);
    const peak = [cx, tTop + size * 0.42, cz];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      S.tri([eave[k][0], tTop, eave[k][1]], [eave[k2][0], tTop, eave[k2][1]], peak, t.cap, ctx.atlas.white, ctx.atlas.white, ctx.atlas.white);
      S.quad([eave[k2][0], tTop, eave[k2][1]], [eave[k][0], tTop, eave[k][1]], [ring[k][0], tTop, ring[k][1]], [ring[k2][0], tTop, ring[k2][1]], 0xd8d4cc, ctx.atlas.white);
    }
  } else {
    flatRoof(ctx, S, ring, tTop, t.band ?? t.col);
  }
  if (t.arch != null) {
    // A coloured band round the top of the tower (McDonald's yellow).
    for (let k = 0; k < 4; k++) {
      const [x1, z1] = ring[k];
      const [x2, z2] = ring[(k + 1) % 4];
      ctx.wall(S, x1, z1, x2, z2, bandBot - 0.12 - 0.36, bandBot - 0.12, t.arch, 'white', 2, 2, 0.02);
    }
  }
  // Logo on the front face and the outer side face.
  if (t.logo && brand) {
    const cell = brandCell(ctx.atlas, brand, 'badge');
    if (cell) {
      const avail = (t.up ?? 2.6) + 1.2;
      let sh = Math.min(size * 0.8, avail - 0.4);
      let sw = sh * cell[4];
      if (sw > size * 0.9) { sw = size * 0.9; sh = sw / cell[4]; }
      const y = bandBot - (t.arch != null ? 0.65 : 0.25) - sh / 2;
      G.quad(...signCorners(cx + e.nx * (hs + 0.08), y, cz + e.nz * (hs + 0.08), e.nx, e.nz, sw, sh), WHITE, cell);
      const sx = -ex;
      const sz = -ez;
      G.quad(...signCorners(cx + sx * (hs + 0.08), y, cz + sz * (hs + 0.08), sx, sz, sw, sh), WHITE, cell);
    }
  }
  return { size, atStart };
}
function signCorners(x, y, z, nx, nz, w, h) {
  const rx = nz;
  const rz = -nx;
  return [[x - rx * w / 2, y - h / 2, z - rz * w / 2], [x + rx * w / 2, y - h / 2, z + rz * w / 2], [x + rx * w / 2, y + h / 2, z + rz * w / 2], [x - rx * w / 2, y + h / 2, z - rz * w / 2]];
}

// Signs on a wall: cells side by side centred in [a0, a1] along the edge, at height y.
function wallSigns(ctx, e, a0, a1, y, maxH, cells, out = 0.1) {
  const span = a1 - a0;
  if (span < 1.5 || !cells.length) return;
  const slot = span / cells.length;
  cells.forEach((cell, k) => {
    if (!cell) return;
    let sh = maxH;
    let sw = sh * cell[4];
    if (sw > slot * 0.86) { sw = slot * 0.86; sh = sw / cell[4]; }
    const a = a0 + slot * (k + 0.5);
    ctx.sg(cell).quad(...signCorners(e.x1 + e.dx * a + e.nx * out, y, e.z1 + e.dz * a + e.nz * out, e.nx, e.nz, sw, sh), WHITE, cell);
  });
}

// ---------- roadside signs ----------
// Exact "is this spot free" test for signs (the shared occupancy grid is 4 m coarse): off the
// driven road and its sidewalks, off side streets, outside buildings.
async function spotChecker(data, route, nearest, sl) {
  const CELL = 30;
  const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const roads = new Map();
  for (const r of data.roads) {
    if (sl.due()) await sl.wait();
    for (let k = 2; k < r.p.length; k += 2) {
      const seg = [r.p[k - 2] / 10, r.p[k - 1] / 10, r.p[k] / 10, r.p[k + 1] / 10, r.w / 2];
      const n = Math.ceil(Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) / CELL) + 1;
      const seen = new Set();
      for (let m = 0; m <= n; m++) {
        const kk = key(seg[0] + ((seg[2] - seg[0]) * m) / n, seg[1] + ((seg[3] - seg[1]) * m) / n);
        if (seen.has(kk)) continue;
        seen.add(kk);
        if (!roads.has(kk)) roads.set(kk, []);
        roads.get(kk).push(seg);
      }
    }
  }
  const blds = new Map();
  let nb = 0;
  for (const b of data.buildings) {
    if ((++nb & 127) === 0 && sl.due()) await sl.wait();
    const ring = ringOf(b);
    let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    if (x1 - x0 > 400 || z1 - z0 > 400) continue;
    const item = { ring, box: [x0, z0, x1, z1] };
    for (let a = Math.floor(x0 / CELL); a <= Math.floor(x1 / CELL); a++) {
      for (let c = Math.floor(z0 / CELL); c <= Math.floor(z1 / CELL); c++) {
        const kk = `${a},${c}`;
        if (!blds.has(kk)) blds.set(kk, []);
        blds.get(kk).push(item);
      }
    }
  }
  const f = {};
  // True when a circle of radius r at (x, z) touches a road, sidewalk or building.
  return (x, z, r) => {
    const nr = nearest(x, z, 60);
    if (nr) {
      route.frame(nr.i * route.step, f);
      const lat = -(x - f.x) * f.tz + (z - f.z) * f.tx;
      const along = (x - f.x) * f.tx + (z - f.z) * f.tz;
      if (Math.abs(along) < route.step * 3 && lat > f.left - 3 - r && lat < f.right + 3 + r) return true;
    }
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++) {
      for (let c = -1; c <= 1; c++) {
        for (const [ax, az, bx, bz, hw] of roads.get(`${cx + a},${cz + c}`) ?? []) {
          const dx = bx - ax;
          const dz = bz - az;
          const l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          if (Math.hypot(ax + dx * t - x, az + dz * t - z) < hw + 1.5 + r) return true;
        }
      }
    }
    for (const { ring, box } of blds.get(key(x, z)) ?? []) {
      if (x < box[0] - r || x > box[2] + r || z < box[1] - r || z > box[3] + r) continue;
      if (pointInRing(x, z, ring)) return true;
      for (let k = 0; k < ring.length; k++) {
        const [ax, az] = ring[k];
        const [bx, bz] = ring[(k + 1) % ring.length];
        const dx = bx - ax;
        const dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        if (Math.hypot(ax + dx * t - x, az + dz * t - z) < r) return true;
      }
    }
    return false;
  };
}
// Inside a reserved area (a gas station's canopy and forecourt), with 1 m to spare.
function inReserved(env, x, z) {
  return env.reserved.some((r) => {
    const dx = x - r.cx;
    const dz = z - r.cz;
    return Math.abs(dx * r.ux + dz * r.uz) < r.A + 1 && Math.abs(-dx * r.uz + dz * r.ux) < r.B + 1;
  });
}
// A free spot beside the road for a sign near (x, z): just past the sidewalk on the
// building's side, slid along the road off side streets and away from other signs.
function roadsideSpot(env, x, z, halfW, maxD = 140) {
  const { route, nearest, signs, blocked } = env;
  const nr = nearest(x, z, maxD);
  if (!nr) return null;
  const s0 = nr.i * route.step;
  const f0 = route.frame(s0);
  const side = (-(x - f0.x) * f0.tz + (z - f0.z) * f0.tx) >= 0 ? 1 : -1;
  // Signs stay out of the first 30 m and the last 60 m (the ending camera looks back along
  // the road there); places at the ends of the route get theirs a little further along.
  const ends = s0 > route.length - 110 ? [-44, -54, -66, -80, -96] : s0 < 70 ? [44, 54, 66, 80] : [];
  for (const ds of [0, 6, -6, 12, -12, 18, -18, 26, -26, 34, -34, ...ends]) {
    const s = s0 + ds;
    if (s < 30 || s > route.length - 60) continue;
    const f = route.frame(s);
    if (route.bridge[route.idx(s)]) continue;
    // Past the sidewalk (which ends 2.5 m beyond the road edge): the panel faces traffic, so
    // it reaches halfW towards the road from its centre.
    const lat = (side > 0 ? f.right : f.left) + side * (3.9 + halfW);
    const p = route.toWorld(s, lat, 0);
    const tx = f.tx;
    const tz = f.tz;
    // The panel runs across the road direction: check both its ends and its middle.
    const ax = -tz * side;
    const az = tx * side;
    if ([-halfW, 0, halfW].some((t) => blocked(p.x + ax * t, p.z + az * t, 0.6) || inReserved(env, p.x + ax * t, p.z + az * t))) continue;
    if (signs.some(([sx, sz]) => Math.hypot(sx - p.x, sz - p.z) < 9 + halfW)) continue;
    const gy = env.heightAt(p.x, p.z);
    if (gy == null) continue;
    signs.push([p.x, p.z]);
    return { x: p.x, z: p.z, y: Math.min(gy, p.y) - 0.05, tx, tz, side };
  }
  return null;
}
// A two-sided panel facing along the road (readable when driving either way).
function twoSided(ctx, x, y, z, tx, tz, w, h, cell, depth = 0.3, edgeCol = 0x3a3d42, box = true) {
  for (const sgn of [1, -1]) {
    ctx.sg(cell).quad(...signCorners(x + tx * sgn * (depth / 2 + 0.01), y, z + tz * sgn * (depth / 2 + 0.01), tx * sgn, tz * sgn, w, h), WHITE, cell);
  }
  if (box && depth > 0) ctx.box(ctx.S, x, z, -tz, tx, w / 2, depth / 2, y - h / 2, y + h / 2, edgeCol);
}
// One roadside sign per name: two footprints sharing a name (a store and its garden centre,
// two city outlines of one sports centre) get a single pylon within 150 m.
function pylonTaken(env, cell, x, z) {
  if (env.pylons.some(([c, px, pz]) => c === cell && Math.hypot(px - x, pz - z) < 150)) return true;
  env.pylons.push([cell, x, z]);
  return false;
}
// Tall pole sign: pole(s) and a panel with the logo high up.
function pylon(ctx, env, x, z, cell, opts = {}) {
  if (!cell || pylonTaken(env, cell, x, z)) return;
  const wide = cell[4] > 1.6;
  let ph = opts.h ?? (wide ? 2.6 : 3.4);
  let pw = ph * cell[4];
  const maxW = opts.maxW ?? 9;
  if (pw > maxW) { pw = maxW; ph = pw / cell[4]; }
  // An optional second panel under the first (a dealer's name under the maker's emblem).
  let sw = 0;
  let sh = 0;
  if (opts.sub) {
    sw = Math.max(pw, 3.6);
    sh = sw / opts.sub[4];
    if (sh > 0.9) { sh = 0.9; sw = sh * opts.sub[4]; }
  }
  const spot = roadsideSpot(env, x, z, Math.max(pw, sw) / 2, opts.maxD ?? 140);
  if (!spot) return;
  ctx.at(spot.x, spot.z);
  const S = ctx.S;
  const bottom = spot.y + (opts.lift ?? (wide ? 6.5 : 6));
  const poleCol = opts.pole ?? 0x55585e;
  if (pw > 4) {
    // Two poles under a wide panel (the panel runs across the road direction).
    for (const t of [-pw * 0.3, pw * 0.3]) ctx.box(S, spot.x - spot.tz * t, spot.z + spot.tx * t, -spot.tz, spot.tx, 0.22, 0.22, spot.y, bottom, poleCol);
  } else {
    ctx.box(S, spot.x, spot.z, -spot.tz, spot.tx, 0.32, 0.32, spot.y, bottom, poleCol);
  }
  twoSided(ctx, spot.x, bottom + ph / 2, spot.z, spot.tx, spot.tz, pw, ph, cell, 0.35, opts.edge ?? 0x3a3d42);
  if (opts.sub) twoSided(ctx, spot.x, bottom - 0.2 - sh / 2, spot.z, spot.tx, spot.tz, sw, sh, opts.sub, 0.3, opts.edge ?? 0x3a3d42);
}
// Low monument sign (banks): a plinth and a panel about 2 m up.
function monument(ctx, env, x, z, cell, col = 0x8f8a82) {
  if (!cell || pylonTaken(env, cell, x, z)) return;
  let ph = cell[4] > 1.6 ? 0.9 : 1.5;
  let pw = ph * cell[4];
  if (pw > 3.4) { pw = 3.4; ph = pw / cell[4]; }
  const spot = roadsideSpot(env, x, z, pw / 2 + 0.25, 120);
  if (!spot) return;
  ctx.at(spot.x, spot.z);
  ctx.box(ctx.S, spot.x, spot.z, -spot.tz, spot.tx, pw / 2 + 0.25, 0.35, spot.y, spot.y + 0.7, col);
  twoSided(ctx, spot.x, spot.y + 0.75 + ph / 2, spot.z, spot.tx, spot.tz, pw, ph, cell, 0.3, col);
}
// Gas price sign: a tall brand-coloured slab with the logo on top and the prices below.
function priceSign(ctx, env, x, z, brand, style, variant) {
  const spot = roadsideSpot(env, x, z, 1.3, 120);
  if (!spot) return;
  ctx.at(spot.x, spot.z);
  const S = ctx.S;
  const G = ctx.G;
  const y0 = spot.y;
  const w = 2.3;
  const ax = -spot.tz;
  const az = spot.tx;
  ctx.box(S, spot.x, spot.z, ax, az, w / 2 + 0.15, 0.4, y0, y0 + 0.7, 0x77736c);
  ctx.box(S, spot.x, spot.z, ax, az, w / 2, 0.28, y0 + 0.7, y0 + 6.6, style.priceBody ?? 0x5b6470);
  const logo = brand ? brandCell(ctx.atlas, brand, 'badge') : null;
  const price = ctx.atlas.cell(`price${variant % 2}`);
  for (const sgn of [1, -1]) {
    const nx = spot.tx * sgn;
    const nz = spot.tz * sgn;
    const ox = spot.x + nx * 0.3;
    const oz = spot.z + nz * 0.3;
    if (logo) {
      const lh = 2.0;
      const lw = Math.min(2.1, lh * logo[4]);
      G.quad(...signCorners(ox, y0 + 5.4, oz, nx, nz, lw, lw / logo[4]), WHITE, logo);
    }
    if (price) G.quad(...signCorners(ox, y0 + 3.3, oz, nx, nz, 2.1, 2.1 / price[4]), WHITE, price);
  }
}

// ---------- gas stations ----------
function fuelStyle(brand) {
  return { ...FUEL_DEFAULT, ...(brand?.fuel ?? {}) };
}
function buildFuelSite(ctx, env, site, k) {
  const { kiosk, brand } = site;
  let cp = site.canopy;
  if (cp.away) {
    // A canopy made up from a map point: slide it back from the road until it touches no
    // road, sidewalk or building (forecourt included), or leave the station out.
    const clear = (c) => {
      // Every 3 m over the canopy and a 3 m apron round it.
      const A = c.A + 3;
      const B = c.B + 3;
      for (let a = -A; a <= A + 0.01; a += (2 * A) / Math.ceil((2 * A) / 3)) {
        for (let b = -B; b <= B + 0.01; b += (2 * B) / Math.ceil((2 * B) / 3)) {
          if (env.blocked(c.cx + c.ux * a - c.uz * b, c.cz + c.uz * a + c.ux * b, 0.8)) return false;
        }
      }
      return true;
    };
    let found = null;
    for (let m = 0; m <= 8 && !found; m++) {
      const c = { ...cp, cx: cp.cx + cp.away[0] * 3 * m, cz: cp.cz + cp.away[1] * 3 * m };
      if (clear(c)) found = c;
    }
    // Nor next to the finish, where the ending scene (couch, TV) stands.
    const end = env.route.toWorld(env.route.length, 0, 0);
    if (!found || Math.hypot(found.cx - end.x, found.cz - end.z) < found.A + 40) return;
    cp = found;
  }
  // Later signs keep off the canopy and its forecourt.
  env.reserved.push({ ...cp, A: cp.A + 5, B: cp.B + 5 });
  const st = fuelStyle(brand);
  ctx.at(cp.cx, cp.cz);
  const S = ctx.S;
  const G = ctx.G;
  const W = ctx.atlas.white;
  const corners = boxRing(cp);
  let gsum = 0;
  let gn = 0;
  for (const [x, z] of [...corners, [cp.cx, cp.cz]]) {
    const g = ctx.heightAt(x, z);
    if (g != null) { gsum += g; gn++; }
  }
  if (!gn) return;
  const gy = gsum / gn;
  const H = gy + Math.max(5.2, Math.min(cp.h, 6.4));
  const F = 1.1;
  const { cx, cz, ux, uz } = cp;
  const A = cp.A;
  const B = Math.max(cp.B, 2.5);
  const vx = -uz;
  const vz = ux;
  // Forecourt: concrete under and around the canopy, following the ground, kept off roads.
  const M = 5;
  const step = 3;
  const na = Math.max(1, Math.round((2 * (A + M)) / step));
  const nb = Math.max(1, Math.round((2 * (B + M)) / step));
  const at = (ia, ib) => {
    const a = -(A + M) + (2 * (A + M) * ia) / na;
    const b = -(B + M) + (2 * (B + M) * ib) / nb;
    const x = cx + ux * a + vx * b;
    const z = cz + uz * a + vz * b;
    return [x, (ctx.heightAt(x, z) ?? gy) + 0.06, z];
  };
  for (let ia = 0; ia < na; ia++) {
    for (let ib = 0; ib < nb; ib++) {
      const p00 = at(ia, ib);
      const p11 = at(ia + 1, ib + 1);
      const mx = (p00[0] + p11[0]) / 2;
      const mz = (p00[2] + p11[2]) / 2;
      if (env.onRoad(mx, mz) || env.onRoad(p00[0], p00[2]) || env.onRoad(p11[0], p11[2])) continue;
      const p10 = at(ia + 1, ib);
      const p01 = at(ia, ib + 1);
      // Wound so the face points up whichever way the axes turn.
      const up = (p10[2] - p00[2]) * (p01[0] - p00[0]) - (p10[0] - p00[0]) * (p01[2] - p00[2]) > 0;
      if (up) S.quad(p00, p10, p11, p01, 0xb4b1a9, W);
      else S.quad(p00, p01, p11, p10, 0xb4b1a9, W);
    }
  }
  // Canopy: roof, fascia bands, lit underside.
  const P = (sa, sb, y) => [cx + ux * A * sa + vx * B * sb, y, cz + uz * A * sa + vz * B * sb];
  S.quad(P(-1, -1, H), P(-1, 1, H), P(1, 1, H), P(1, -1, H), 0xdedcd6, W);
  const under = ctx.atlas.cell('light');
  // Underside tiled about every 3 m.
  const nU = Math.max(1, Math.round((2 * A) / 3));
  const nV = Math.max(1, Math.round((2 * B) / 3));
  for (let i = 0; i < nU; i++) {
    for (let j = 0; j < nV; j++) {
      const a0 = -1 + (2 * i) / nU; const a1 = -1 + (2 * (i + 1)) / nU;
      const b0 = -1 + (2 * j) / nV; const b1 = -1 + (2 * (j + 1)) / nV;
      G.quad(P(a0, b0, H - F), P(a1, b0, H - F), P(a1, b1, H - F), P(a0, b1, H - F), WHITE, under);
    }
  }
  const faces = [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]];
  for (const [[sa, sb], [ta, tb]] of faces) {
    let y = H;
    for (const [c, share] of st.bands) {
      const y2 = y - F * share;
      // Walking around the box this way has the outside on the left: wind b→a.
      S.quad(P(ta, tb, y2), P(sa, sb, y2), P(sa, sb, y), P(ta, tb, y), c, W);
      y = y2;
    }
  }
  // Logos: a badge box on the middle of each side (two on long sides over 32 m).
  const logo = brand ? brandCell(ctx.atlas, brand, 'badge') : site.name ? ctx.atlas.cell(`name|${site.name}`) : null;
  if (logo) {
    const lh = Math.min(1.9, F + 0.8);
    const lw = Math.min(lh * logo[4], 2 * B - 1);
    const lhh = lw / logo[4];
    const yc = H - F / 2;
    const place = (px, pz, nx, nz) => {
      ctx.sg(logo).quad(...signCorners(px + nx * 0.16, yc, pz + nz * 0.16, nx, nz, lw, lhh), WHITE, logo);
      ctx.box(S, px + nx * 0.07, pz + nz * 0.07, -nz, nx, lw / 2, 0.08, yc - lhh / 2, yc + lhh / 2, st.bands[0][0]);
    };
    const longSpots = A > 16 ? [-0.5, 0.5] : [0];
    for (const sgn of [1, -1]) {
      for (const t of longSpots) place(cx + ux * A * t + vx * B * sgn, cz + uz * A * t + vz * B * sgn, vx * sgn, vz * sgn);
      place(cx + ux * A * sgn, cz + uz * A * sgn, ux * sgn, uz * sgn);
    }
  }
  // Pump islands across the canopy, one column each; two rows under deep canopies.
  const nI = Math.max(1, Math.round((2 * A) / 7.5));
  const rows = 2 * B > 15 ? [-B / 2, B / 2] : [0];
  const islandLen = Math.min(2 * B / rows.length - 2, 6);
  for (let i = 0; i < nI; i++) {
    const a = -A + ((i + 0.5) * 2 * A) / nI;
    for (const b of rows) {
      const ix = cx + ux * a + vx * b;
      const iz = cz + uz * a + vz * b;
      const g = (ctx.heightAt(ix, iz) ?? gy) + 0.06;
      // Island curb.
      ctx.box(S, ix, iz, vx, vz, islandLen / 2, 0.6, g, g + 0.18, 0xc9c6bf);
      // Column to the underside.
      ctx.box(S, ix, iz, ux, uz, 0.22, 0.22, g + 0.18, H - F, st.column ?? 0xe8e8e6);
      // Two pumps facing the cars on both sides.
      for (const t of [-1, 1]) {
        if (islandLen < 3) { if (t > 0) continue; }
        const off = islandLen < 3 ? 0 : t * Math.min(1.7, islandLen / 2 - 0.8);
        const px = ix + vx * off;
        const pz = iz + vz * off;
        ctx.box(S, px, pz, ux, uz, 0.28, 0.5, g + 0.18, g + 1.7, st.pumpBody ?? 0xe9e9e6);
        ctx.box(S, px, pz, ux, uz, 0.3, 0.52, g + 1.7, g + 2.05, st.pumpHead ?? 0x5b6470);
        const screen = ctx.atlas.cell('screen');
        for (const sgn of [1, -1]) G.quad(...signCorners(px + ux * sgn * 0.29, g + 1.15, pz + uz * sgn * 0.29, ux * sgn, uz * sgn, 0.62, 0.62 / screen[4]), WHITE, screen);
      }
    }
  }
  // The shop.
  if (kiosk) {
    const [kx, kz] = centroid(kiosk.ring);
    ctx.at(kx, kz);
    const own = kiosk.brand && kiosk.brand !== brand ? kiosk.brand : null;
    const ks = own?.fuel ? fuelStyle(own) : st;
    const bandCol = own && !own.fuel ? own.c.main : ks.kioskBand ?? 0x5b6470;
    const look = { wall: ks.kioskWall ?? 0xe4e2dc, wallCell: 'panel', base: 0x7d7a74, baseCell: 'white', baseH: 0.6, band: bandCol, bandH: 1.0, trim: bandCol, stripes: ks.kioskStripes };
    const f = shopBuilding(ctx, kiosk.ring, Math.min(Math.max(kiosk.h, 4.2), 6), look, [cp.cx, cp.cz]);
    if (f) {
      const signBrand = own ?? brand;
      const main = signBrand ? brandCell(ctx.atlas, signBrand, 'word') : kiosk.b?.n ? ctx.atlas.cell(`name|${kiosk.b.n}`) : null;
      const cells = [main, ...(kiosk.tenants ?? []).slice(0, 2).map(([n, br]) => { const tb = brandOf(br, n); return tb ? brandCell(ctx.atlas, tb, 'word') : ctx.atlas.cell(`name|${n}`); })].filter(Boolean);
      const e = f.front;
      wallSigns(ctx, e, 0.6, e.len - 0.6, f.signY, Math.min(f.bandH * 0.9 + 0.2, 1.2), cells);
      // Also on the side facing the road, if it isn't the front.
      const road = env.nearest(kx, kz, 200);
      if (road && cells.length) {
        const rx = env.route.x[road.i];
        const rz = env.route.z[road.i];
        const es = edges(kiosk.ring, rx, rz);
        const re = frontEdge(es);
        if (re && re.k !== e.k && re.facing > 0.3) wallSigns(ctx, re, 0.6, re.len - 0.6, f.signY, Math.min(f.bandH * 0.9 + 0.2, 1.2), [cells[0]]);
      }
    }
  }
  // Price sign at the road.
  priceSign(ctx, env, cp.cx, cp.cz, brand, st, k);
}

// ---------- restaurants, cafes, banks ----------
function buildPad(ctx, env, pad, info) {
  const o = info(pad.i);
  const { brand } = pad;
  let { look } = pad;
  // Plain looks (banks, smaller chains) wear the brand colour on their fascia band.
  if (look.band == null && look.mansard == null) look = { ...look, band: brand.c.main, trim: brand.c.main };
  ctx.at(o.cx, o.cz);
  const rx = env.route.x[pad.road.i];
  const rz = env.route.z[pad.road.i];
  const f = shopBuilding(ctx, o.ring, o.h, look, [rx, rz]);
  if (!f) return;
  const e = f.front;
  let a0 = 0.5;
  let a1 = e.len - 0.5;
  if (look.tower) {
    // Tower at the end of the front wall nearer the road point.
    const d1 = Math.hypot(e.x1 - rx, e.z1 - rz);
    const d2 = Math.hypot(e.x2 - rx, e.z2 - rz);
    const t = shopTower(ctx, f, { ...look.tower, end: d1 <= d2 ? 0 : 1, arch: look.arch }, brand);
    if (t) {
      if (t.atStart) a0 = t.size + 0.2;
      else a1 = e.len - t.size - 0.2;
    }
  }
  // Fascia signs: the brand (and its tenants) on the front, the brand on a side facing the road.
  const main = brandCell(ctx.atlas, brand, 'word');
  const tenants = pad.tenants.slice(0, 2).map((t) => (t.brand ? brandCell(ctx.atlas, t.brand, 'word') : ctx.atlas.cell(`name|${t.n}`))).filter(Boolean);
  const side = f.es.filter((q) => q && q !== e && q.len >= 5 && q.facing > 0.25).sort((p, q) => q.facing - p.facing)[0];
  if (look.mansard != null) {
    // Mounted on the sloped roof band (Dairy Queen, Swiss Chalet, IHOP), tenants on the wall.
    const y = f.wallTop + f.bandH * 0.47;
    const h = f.bandH * 0.86;
    wallSigns(ctx, e, a0, a1, y, h, [main], 0.62);
    if (side) wallSigns(ctx, side, 0.6, side.len - 0.6, y, h, [main], 0.62);
    if (tenants.length) wallSigns(ctx, e, a0, a1, f.signY, f.signH, tenants, 0.12);
  } else {
    wallSigns(ctx, e, a0, a1, f.signY, f.signH, [main, ...tenants].filter(Boolean), 0.1);
    if (side) wallSigns(ctx, side, 0.6, side.len - 0.6, f.signY, f.signH, [main]);
  }
  // Roadside sign.
  if (brand.pylon === 'tall') pylon(ctx, env, o.cx, o.cz, brandCell(ctx.atlas, brand, 'badge'), { maxD: 130, pole: brand.id === 'mcd' ? 0xd8d8d8 : 0x55585e });
  else if (brand.pylon === 'low') monument(ctx, env, o.cx, o.cz, brandCell(ctx.atlas, brand, 'word'));
}

// ---------- signs on buildings world.js draws ----------
function buildMark(ctx, env, m, info) {
  const o = info(m.i);
  const b = o.b;
  const rx = env.route.x[m.road.i];
  const rz = env.route.z[m.road.i];
  const es = edges(o.ring, rx, rz);
  // The wall whose outward normal points at the road, preferring long walls.
  let best = null;
  for (const e of es) {
    if (!e || e.len < 6 || e.facing < 0.3) continue;
    const toRoad = Math.hypot(rx - e.mx, rz - e.mz);
    const sc = e.facing * Math.min(e.len, 40) - toRoad * 0.05;
    if (!best || sc > best.sc) best = { e, sc };
  }
  if (!best) return;
  const e = best.e;
  ctx.at(e.mx, e.mz);
  const base = (ctx.heightAt(e.mx, e.mz) ?? 0) - 0.5;
  const top = base + 0.5 + o.h;
  const brand = m.brand;
  const cellOf = (t) => (t.brand ? brandCell(ctx.atlas, t.brand, 'word') : ctx.atlas.cell(`name|${t.n}`));
  const mainCell = brand ? brandCell(ctx.atlas, brand, 'word') : b.n ? ctx.atlas.cell(`name|${b.n}`) : null;
  const S = ctx.S;
  if (m.role === 'box' || m.role === 'dealer') {
    // Entrance portal rising above the roof, in the brand colour, with the logo.
    const pw = m.role === 'dealer' ? Math.min(8, e.len * 0.3) : Math.max(10, Math.min(28, e.len * 0.24));
    if (pw >= 4 && brand) {
      const portalTop = top + (m.role === 'dealer' ? 2.2 : 2.4);
      const pc = brand.box?.portal ?? brand.box?.band ?? brand.c.main;
      const a = e.len / 2;
      const px = e.x1 + e.dx * a + e.nx * 0.6;
      const pz = e.z1 + e.dz * a + e.nz * 0.6;
      ctx.box(S, px, pz, e.dx, e.dz, pw / 2, 0.75, base, portalTop, pc);
      const glass = ctx.atlas.cell('glass');
      if (m.role === 'box') {
        // Glass entrance doors at the foot of the portal.
        const dw = Math.min(pw * 0.6, 8);
        const n = Math.max(1, Math.round(dw / 2.4));
        for (let q = 0; q < n; q++) {
          const a0 = -dw / 2 + (dw * q) / n;
          const P = (t, y) => [px + e.dx * t + e.nx * 0.77, y, pz + e.dz * t + e.nz * 0.77];
          ctx.G.quad(P(a0, base + 0.55), P(a0 + dw / n, base + 0.55), P(a0 + dw / n, base + 3.3), P(a0, base + 3.3), WHITE, glass);
        }
      } else {
        // Car showroom: a glass front along the road-facing wall, either side of the portal.
        const gTop = Math.min(top - 1.0, base + 5.5);
        const n = Math.max(1, Math.round(e.len / 3));
        for (let q = 0; q < n; q++) {
          const a0 = (e.len * q) / n;
          const a1 = (e.len * (q + 1)) / n;
          if (a1 > a - pw / 2 - 0.2 && a0 < a + pw / 2 + 0.2) continue;
          const P = (t, y) => [e.x1 + e.dx * t + e.nx * 0.06, y, e.z1 + e.dz * t + e.nz * 0.06];
          ctx.G.quad(P(a0, base + 0.8), P(a1, base + 0.8), P(a1, gTop), P(a0, gTop), WHITE, glass);
        }
      }
      const cell = m.role === 'dealer' ? brandCell(ctx.atlas, brand, 'badge') : mainCell;
      if (cell) {
        let sh = m.role === 'dealer' ? Math.min(pw * 0.8, 4) : Math.min(2.8, (portalTop - top) + 1.6);
        let sw = sh * cell[4];
        if (sw > pw * 0.9) { sw = pw * 0.9; sh = sw / cell[4]; }
        ctx.sg(cell).quad(...signCorners(px + e.nx * 0.78, portalTop - 0.35 - sh / 2, pz + e.nz * 0.78, e.nx, e.nz, sw, sh), WHITE, cell);
      }
    } else if (mainCell) {
      wallSigns(ctx, e, 0, e.len, top - 1.6, Math.min(2.4, o.h * 0.35), [mainCell]);
    }
    // Dealers: the maker's emblem with the dealer's own name (Koch Ford) under it.
    const sub = m.role === 'dealer' && b.n && b.n !== brand?.text ? ctx.atlas.cell(`name|${b.n}`) : null;
    if (brand?.pylon) pylon(ctx, env, o.cx, o.cz, brandCell(ctx.atlas, brand, brand.badge && m.role === 'dealer' ? 'badge' : 'word'), { maxD: m.bigLot ? 340 : 160, wide: true, lift: m.road.d > 60 ? 8.5 : 6.5, h: m.road.d > 60 ? 3.6 : 3, sub });
  } else if (m.role === 'hotel') {
    if (mainCell) {
      const sh = Math.min(3, Math.max(1.4, o.h * 0.12));
      wallSigns(ctx, e, 0, e.len, top - sh / 2 - 0.6, sh, [mainCell]);
    }
    if (brand?.pylon) pylon(ctx, env, o.cx, o.cz, brandCell(ctx.atlas, brand, 'word'), { maxD: 200, wide: true });
  } else if (m.role === 'mall') {
    const tenants = [...(brand || b.n ? [{ n: b.n ?? brand?.text, brand }] : []), ...m.tenants];
    const n = Math.max(1, Math.min(tenants.length, Math.floor(e.len / 7)));
    const cells = tenants.slice(0, n).map(cellOf).filter(Boolean);
    const sh = Math.min(1.2, o.h * 0.25);
    wallSigns(ctx, e, 0.5, e.len - 0.5, top - sh / 2 - 0.45, sh, cells);
    // A plaza pylon: the centre's own name on top (a big mall), then its branded tenants.
    const branded = m.tenants.filter((t) => t.brand).slice(0, 4);
    const head = m.bigLot && b.n && !brand ? [ctx.atlas.cell(`name|${b.n}`)] : brand ? [mainCell] : [];
    const stack = [...head, ...branded.map((t) => brandCell(ctx.atlas, t.brand, 'word'))].filter(Boolean).slice(0, 4);
    if ((branded.length >= 2 && m.road.d < 160) || (head[0] && m.bigLot && e.len > 25)) plazaPylon(ctx, env, o.cx, o.cz, stack, m.bigLot ? 340 : 160, m.bigLot);
  } else if (mainCell) {
    // store / name: one sign on the wall, a pylon for big lots.
    const big = m.bigLot;
    const sh = Math.min(big ? 2.4 : 1.1, o.h * 0.35);
    wallSigns(ctx, e, 0, e.len, top - sh * 0.8 - (big ? 0.6 : 0.3), sh, [mainCell]);
    if (brand?.pylon === 'tall' && (big || m.road.d < 90)) pylon(ctx, env, o.cx, o.cz, brandCell(ctx.atlas, brand, brand.badge ? 'badge' : 'word'), { maxD: 140, wide: !brand.badge });
    else if (big && e.len > 25 && mainCell) pylon(ctx, env, o.cx, o.cz, mainCell, { maxD: 340, wide: true, lift: m.road.d > 60 ? 9 : 6, h: m.road.d > 60 ? 4 : 3, maxW: 11 });
  }
}
// A shopping centre's pylon: panels stacked on a plinth (bigger for big centres).
function plazaPylon(ctx, env, x, z, cells, maxD = 160, big = false) {
  if (!cells.length || pylonTaken(env, cells[0], x, z)) return;
  const pw = big ? 8 : 4.2;
  const ph = big ? 1.7 : 1.05;
  const spot = roadsideSpot(env, x, z, pw / 2 + 0.2, maxD);
  if (!spot) return;
  ctx.at(spot.x, spot.z);
  const y0 = spot.y + (big ? 5 : 3.2);
  ctx.box(ctx.S, spot.x, spot.z, -spot.tz, spot.tx, 0.6, 0.3, spot.y, y0, 0x6b6762);
  cells.forEach((cell, k) => {
    let w = pw;
    let h = w / cell[4];
    if (h > ph) { h = ph; w = h * cell[4]; }
    // On the faces of the backing box drawn below.
    twoSided(ctx, spot.x, y0 + (cells.length - k - 0.5) * (ph + 0.12), spot.z, spot.tx, spot.tz, w, h, cell, 0.5, 0, false);
  });
  const total = cells.length * (ph + 0.12);
  ctx.box(ctx.S, spot.x, spot.z, -spot.tz, spot.tx, pw / 2 + 0.2, 0.25, y0 - 0.1, y0 + total + 0.25, 0x4a4d52);
}

// ---------- main entry ----------
// What the atlas should hold: each brand's signs and the names of unbranded places, with a
// priority (gas stations and brand restaurants first, then big and close places, tenants
// last), so the most useful ones are kept when a busy map has more than fits.
export function atlasRequests(plan) {
  const { fuel, pads, marks, info } = plan;
  const best = new Map();
  const want = (key, prio) => { if (!best.has(key) || best.get(key) < prio) best.set(key, prio); };
  const brandKey = (brand, f) => `${brand.id}|${f === 'word' && !brand.word ? 'badge' : f === 'badge' && !brand.badge ? 'word' : f}`;
  const addBrand = (brand, prio, ...fmts) => { if (brand) for (const f of fmts) want(brandKey(brand, f), prio); };
  const addName = (n, prio) => { if (n) want(`name|${n}`, prio); };
  for (const s of fuel) {
    if (s.brand) addBrand(s.brand, 1000, 'badge', 'word');
    else addName(s.name, 950);
    if (s.kiosk) {
      if (s.kiosk.brand) addBrand(s.kiosk.brand, 980, 'word');
      else addName(s.kiosk.b?.n, 900);
      for (const [n, br] of s.kiosk.tenants ?? []) { const tb = brandOf(br, n); if (tb) addBrand(tb, 850, 'word'); else addName(n, 400); }
    }
  }
  for (const p of pads) {
    const d = p.road.d / 10;
    addBrand(p.brand, 960 - d, 'word', 'badge');
    for (const t of p.tenants) { if (t.brand) addBrand(t.brand, 800 - d, 'word'); else addName(t.n, 450 - d); }
  }
  for (const m of marks) {
    const d = m.road.d / 10;
    const big = m.bigLot ? 100 : 0;
    if (m.brand) addBrand(m.brand, 700 + big - d, 'word', ...(m.role === 'dealer' || m.brand.pylon === 'tall' ? ['badge'] : []));
    else addName(info(m.i).b.n, 600 + big - d);
    if (m.role === 'dealer') addName(info(m.i).b.n, 650 - d);
    for (const t of m.tenants) { if (t.brand) addBrand(t.brand, 500 - d, 'word'); else addName(t.n, 300 - d); }
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

// `env`: { route, heightAt, onRoad(x, z), nearest(x, z, maxR) } (see world.js).
export async function buildBrandSites(data, plan, env, { sl, maxAnisotropy = 1 } = {}) {
  const { fuel, pads, marks, info } = plan;
  const group = new THREE.Group();
  if (!fuel.length && !pads.length && !marks.length) return group;
  // Big, close places first (their roadside signs get the free spots).
  const sorted = marks.slice().sort((a, b) => (b.bigLot - a.bigLot) || (a.road.d - b.road.d));
  const atlas = await buildAtlas(atlasRequests(plan), sl, maxAnisotropy);
  const ctx = new Ctx(atlas, env.heightAt);
  const signEnv = { ...env, signs: [], pylons: [], reserved: [], blocked: await spotChecker(data, env.route, env.nearest, sl) };
  await sl.tick();
  const tick = async () => { if (sl.due()) await sl.wait(); };
  for (let k = 0; k < fuel.length; k++) { buildFuelSite(ctx, signEnv, fuel[k], k); await tick(); }
  for (const p of pads) { buildPad(ctx, signEnv, p, info); await tick(); }
  for (const m of sorted) { buildMark(ctx, signEnv, m, info); await tick(); }
  // Plain surfaces, then glowing signs (logos, windows, the lit canopy undersides) on each page.
  const [page0, page1] = atlas.pages;
  const solid = new THREE.MeshStandardMaterial({ map: page0, vertexColors: true, roughness: 0.8 });
  const glowOf = (tex) => new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.42, vertexColors: true, roughness: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
  const glow = glowOf(page0);
  const names = page1 ? glowOf(page1) : null;
  for (const { S, G, N } of ctx.chunks.values()) {
    if (S.p.length) group.add(new THREE.Mesh(S.build(), solid));
    if (G.p.length) group.add(new THREE.Mesh(G.build(), glow));
    if (N.p.length && names) group.add(new THREE.Mesh(N.build(), names));
    if (sl.due()) await sl.wait();
  }
  group.userData.summary = { fuel: fuel.length, pads: pads.length, marks: marks.length, cells: atlas.cells.size, dropped: atlas.dropped, pages: atlas.pages.map((t) => `${t.image.width}x${t.image.height}`).join(' + ') };
  return group;
}
