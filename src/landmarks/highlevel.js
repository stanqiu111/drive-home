import * as THREE from 'three';

// High Level Bridge (1913) with the Dudley B. Menzies LRT bridge (1992) to its west.
//
// The real trestle runs about 19 degrees west of south, not along z, and the game's
// 109 Street road follows OpenStreetMap, so the bridge axis is taken from the two ends of
// the straight OSM deck segment (via ctx.local) and the whole trestle is built in a frame
// rotated to match. That keeps the car on the game's road exactly between the trusses.
//
// Heights are metres above river level (the model origin). The game's road deck on this
// bridge sits 42.3 m above the river (from the map data), so the lower deck is built at
// that height; the clear box above the road (y 42.3 .. 50, |x| < 6) holds nothing, and
// the upper (streetcar) deck hangs from y = 50 up.
export const sink = 0;

// OSM nodes (lon, lat). The ends of the straight 109 Street deck segment give the axis;
// the Capital Line nodes (south to north) give the LRT bridge's gentle curve.
const HLB_N = [-113.509743, 53.532398];
const HLB_S = [-113.512977, 53.52685];
const LRT = [
  [-113.515518, 53.527348], [-113.514877, 53.527648], [-113.514468, 53.527853], [-113.514158, 53.528015],
  [-113.513991, 53.528114], [-113.513877, 53.528184], [-113.513741, 53.528274], [-113.513577, 53.528386],
  [-113.513407, 53.528522], [-113.513256, 53.528651], [-113.513138, 53.528766], [-113.513049, 53.528858],
  [-113.512911, 53.529016], [-113.512767, 53.529198], [-113.512668, 53.529339], [-113.512458, 53.529671],
  [-113.512313, 53.529918], [-113.512162, 53.530175], [-113.511241, 53.531741], [-113.510717, 53.532641],
];

const ROAD_Y = 42.3;   // the game's road surface (lower deck)
const BOT_Y = 41.4;    // bottom chord centre (0.7 wide x 1.0 deep)
const TOP_Y = 50.5;    // top chord centre; upper-deck floor beams span y 50.0 .. 50.8
const TRUSS_X = 6.35;  // truss centrelines; members 0.7 wide -> 12.0 m clear (real decks: 11.89 m)
const T0 = -346;       // north abutment face, metres along the axis (south positive)
const T1 = 446;        // south abutment face

// Supports along the axis: four concrete river piers under 3 x 88 m Pratt spans, two
// light bents on the north (Warren) approach, eight steel towers with 14.33 m tower spans
// and 29.26 m Pratt spans on the long south approach over the Kinsmen Park flats.
const PIERS = [-210, -122, -34, 54];
const BENTS_N = [-300, -255];
const TOWERS_S = [90.4, 134.0, 177.6, 221.2, 264.8, 308.4, 352.0, 395.6];
const PIER_TOP = 14;   // concrete river piers reach this height; steel above

// Game terrain along the axis (metres above river), sampled from the map DEM.
const GROUND = [
  [-360, 42.3], [-330, 39.3], [-300, 32.1], [-270, 23.1], [-240, 15.2], [-210, 8.6], [-180, 2.8], [-150, -0.1],
  [-120, -0.4], [-30, -0.4], [0, 0], [30, 2.4], [60, 7.6], [90, 9.5], [120, 9.5], [150, 9.0], [180, 8.5], [210, 8.6],
  [240, 9.2], [270, 11.0], [300, 14.6], [330, 19.9], [360, 25.5], [390, 30.7], [420, 36.3], [450, 41.4], [480, 45.0],
];
function groundAt(t) {
  if (t <= GROUND[0][0]) return GROUND[0][1];
  for (let i = 1; i < GROUND.length; i++) {
    const [t1, g1] = GROUND[i];
    if (t <= t1) { const [t0, g0] = GROUND[i - 1]; return g0 + (g1 - g0) * (t - t0) / (t1 - t0); }
  }
  return GROUND[GROUND.length - 1][1];
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Collects flat-shaded quads for one material and builds a single indexed geometry.
class Builder {
  // `keep(a, b)` (optional) can veto a part between two points, e.g. one standing on the road.
  constructor(keep = null) { this.p = []; this.nr = []; this.ix = []; this.v = 0; this.keep = keep; }
  quad(a, b, c, d) {
    _n.crossVectors(_a.subVectors(b, a), _b.subVectors(c, a)).normalize();
    for (const q of [a, b, c, d]) { this.p.push(q.x, q.y, q.z); this.nr.push(_n.x, _n.y, _n.z); }
    const v = this.v;
    this.ix.push(v, v + 1, v + 2, v, v + 2, v + 3);
    this.v += 4;
  }
  // Quad whose front must face away from `inner`.
  quadOut(a, b, c, d, inner) {
    _n.crossVectors(_a.subVectors(b, a), _b.subVectors(c, a));
    const dot = _n.x * ((a.x + b.x + c.x + d.x) / 4 - inner.x) + _n.y * ((a.y + b.y + c.y + d.y) / 4 - inner.y) + _n.z * ((a.z + b.z + c.z + d.z) / 4 - inner.z);
    if (dot < 0) this.quad(d, c, b, a); else this.quad(a, b, c, d);
  }
  // Prism from a to b with a w x h section and no end caps (8 triangles).
  bar(a, b, w, h) {
    if (this.keep && !this.keep(a, b, Math.max(w, h) / 2)) return;
    const d = b.clone().sub(a).normalize();
    const ref = Math.abs(d.y) > 0.9 ? V(0, 0, 1) : V(0, 1, 0);
    const s1 = d.clone().cross(ref).normalize().multiplyScalar(w / 2);
    const s2 = s1.clone().cross(d).normalize().multiplyScalar(h / 2);
    const off = [s1.clone().add(s2), s1.clone().sub(s2), s1.clone().negate().sub(s2), s1.clone().negate().add(s2)];
    const A = off.map((o) => a.clone().add(o));
    const B = off.map((o) => b.clone().add(o));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; this.quadOut(A[k], B[k], B[j], A[j], mid); }
  }
  // Flat strip from a to b, `w` wide, lying in the plane with normal `n` (for a double-sided material).
  ribbon(a, b, w, n) {
    if (this.keep && !this.keep(a, b, w / 2)) return;
    const d = b.clone().sub(a).normalize();
    const s = d.cross(n).normalize().multiplyScalar(w / 2);
    this.quad(a.clone().add(s), b.clone().add(s), b.clone().sub(s), a.clone().sub(s));
  }
  // Box with its own axes: centre c, unit axes ax (width sx), ay (height sy), az (length sz).
  obox(c, ax, ay, az, sx, sy, sz, skipBottom = false) {
    const P = (i, j, k) => c.clone().addScaledVector(ax, i * sx / 2).addScaledVector(ay, j * sy / 2).addScaledVector(az, k * sz / 2);
    const faces = [
      [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)], [P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), P(-1, -1, 1)],
      [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)], [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)],
      [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)],
    ];
    faces.forEach((f, i) => { if (!(skipBottom && i === 3)) this.quadOut(f[0], f[1], f[2], f[3], c); });
  }
  box(cx, cy, cz, sx, sy, sz, skipBottom = false) { this.obox(V(cx, cy, cz), V(1, 0, 0), V(0, 1, 0), V(0, 0, 1), sx, sy, sz, skipBottom); }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nr, 3));
    g.setIndex(this.ix);
    return new THREE.Mesh(g, material);
  }
}

// One steel tower: four battered legs from the pedestal/pier top up to the bottom chord,
// ring struts every ~8.5 m and X lattice on all four faces.
function tower(steel, lattice, c, aTop, aBase, yBase, legW) {
  const yTop = BOT_Y - 0.5;
  const h = yTop - yBase;
  if (h < 1.5) return;
  const xBase = TRUSS_X + 0.13 * h;
  const corner = (f, sx, sz) => V(sx * (xBase + (TRUSS_X - xBase) * f), yBase + h * f, c + sz * (aBase + (aTop - aBase) * f));
  const order = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [sx, sz] of order) steel.bar(corner(0, sx, sz), corner(1, sx, sz), legW, legW);
  const n = Math.max(1, Math.ceil(h / 8.5));
  for (let i = 0; i < n; i++) {
    const C0 = order.map(([sx, sz]) => corner(i / n, sx, sz));
    const C1 = order.map(([sx, sz]) => corner((i + 1) / n, sx, sz));
    for (let k = 0; k < 4; k++) {
      const j = (k + 1) % 4;
      steel.bar(C0[k], C0[j], 0.45, 0.45);
      const nrm = C0[j].clone().sub(C0[k]).cross(C1[k].clone().sub(C0[k])).normalize();
      lattice.ribbon(C0[k], C1[j], 0.45, nrm);
      lattice.ribbon(C0[j], C1[k], 0.45, nrm);
    }
  }
}

// Concrete river pier: tapered six-sided shaft with pointed noses across the flow, and
// a platform the steel tower stands on.
function riverPier(conc, c, yBase) {
  const shape = [[-12.5, 0], [-9, -5], [9, -5], [12.5, 0], [9, 5], [-9, 5]];
  const ring = (y, s) => shape.map(([x, z]) => V(x * s, y, c + z * s));
  const lo = ring(yBase, 1.12), hi = ring(PIER_TOP, 1.0);
  const inner = V(0, (yBase + PIER_TOP) / 2, c);
  for (let k = 0; k < 6; k++) { const j = (k + 1) % 6; conc.quadOut(lo[k], lo[j], hi[j], hi[k], inner); }
  const top = V(0, PIER_TOP, c);
  for (let k = 0; k < 6; k++) { const j = (k + 1) % 6; conc.quadOut(top, hi[k], hi[j], hi[j].clone().lerp(hi[k], 0.5), V(0, PIER_TOP - 1, c)); }
  conc.box(0, PIER_TOP + 0.5, c, 26, 1.0, 11, true);
}

function buildHighLevel(ctx, steel, lattice, conc, walk, deckDark, rail, roadHalf = 4) {
  // Panel points: every support (abutments, tower legs, pier legs) plus ~8.8 m panels between.
  const sup = [T0, T1];
  for (const c of BENTS_N) sup.push(c - 3.5, c + 3.5);
  for (const c of PIERS) sup.push(c - 3.6, c + 3.6);
  for (const c of TOWERS_S) sup.push(c - 7.17, c + 7.17);
  sup.sort((a, b) => a - b);
  const points = [T0];
  const diagonals = []; // [tTop, tBottom]
  for (let i = 0; i < sup.length - 1; i++) {
    const s0 = sup[i], s1 = sup[i + 1], len = s1 - s0;
    const n = Math.max(1, Math.round(len / 8.8));
    const towerSpan = len < 16;
    for (let k = 0; k < n; k++) {
      const a = s0 + len * k / n, b = s0 + len * (k + 1) / n;
      points.push(b);
      const mid = (n - 1) / 2;
      if (towerSpan || k === mid) { diagonals.push([a, b], [b, a]); } // X
      else if (k < mid) diagonals.push([a, b]);                      // Pratt: down toward mid-span
      else diagonals.push([b, a]);
    }
  }
  const mid = (T0 + T1) / 2, L = T1 - T0;
  for (const sx of [-1, 1]) {
    const x = sx * TRUSS_X;
    steel.bar(V(x, BOT_Y, T0), V(x, BOT_Y, T1), 0.7, 1.0);
    steel.bar(V(x, TOP_Y, T0), V(x, TOP_Y, T1), 0.7, 1.0);
    for (const t of points) steel.bar(V(x, BOT_Y + 0.5, t), V(x, TOP_Y - 0.5, t), 0.6, 0.6);
    for (const [ta, tb] of diagonals) steel.bar(V(x, TOP_Y - 0.5, ta), V(x, BOT_Y + 0.5, tb), 0.5, 0.5);
  }
  for (const t of points) {
    steel.bar(V(-TRUSS_X, TOP_Y - 0.1, t), V(TRUSS_X, TOP_Y - 0.1, t), 0.6, 0.8); // upper deck floor beam, y 50.0 .. 50.8
    steel.bar(V(-TRUSS_X, BOT_Y - 1.1, t), V(TRUSS_X, BOT_Y - 1.1, t), 0.6, 0.8); // lower deck floor beam, y 39.9 .. 40.7
  }
  // Upper (streetcar) deck: dark floor, a centred track, lattice-high parapets.
  deckDark.box(0, TOP_Y + 0.45, mid, 11.9, 0.3, L);
  for (const x of [-0.75, 0.75]) rail.bar(V(x, TOP_Y + 0.7, T0), V(x, TOP_Y + 0.7, T1), 0.15, 0.2);
  for (const x of [-5.75, 5.75]) steel.bar(V(x, TOP_Y + 1.05, T0), V(x, TOP_Y + 1.05, T1), 0.12, 0.9);
  // Lower deck: walkway strips between the game's road edge and the trusses (if they fit).
  const w0 = roadHalf + 0.3, w1 = TRUSS_X - 0.45;
  if (w1 - w0 > 0.5) for (const sx of [-1, 1]) walk.box(sx * (w0 + w1) / 2, ROAD_Y - 0.175, mid, w1 - w0, 0.45, L);

  // Supports.
  for (const c of PIERS) {
    const yb = Math.min(groundAt(c), 0) - 3;
    riverPier(conc, c, yb);
    tower(steel, lattice, c, 3.6, 4.2, PIER_TOP + 1.0, 0.95);
  }
  const pedestals = (c, aBase, yBase) => {
    const h = BOT_Y - 0.5 - yBase;
    const xb = TRUSS_X + 0.13 * h;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) conc.box(sx * xb, yBase - 2.25, c + sz * aBase, 2.2, 4.5, 2.2, true);
  };
  for (const c of BENTS_N) { const yB = groundAt(c) + 2.0; pedestals(c, 4.0, yB); tower(steel, lattice, c, 3.5, 4.0, yB, 0.7); }
  for (const c of TOWERS_S) { const yB = groundAt(c) + 2.0; pedestals(c, 7.9, yB); tower(steel, lattice, c, 7.17, 7.9, yB, 0.8); }
  // Abutments, mostly buried in the valley rims.
  conc.box(0, BOT_Y - 5.5, T0 - 5, 17, 12, 10, true);
  conc.box(0, BOT_Y - 5.5, T1 + 5, 17, 12, 10, true);
}

// Dudley B. Menzies Bridge: pale concrete box girder on slim piers following the Capital
// Line's curve, with the glass pedestrian tube hung underneath. Built in world space.
function buildMenzies(ctx, lrtConc, lrtPier, glass) {
  const pts = LRT.map(([lo, la]) => { const [x, z] = ctx.local(lo, la); return new THREE.Vector2(x, z); });
  const ext = (p, q, len) => p.clone().add(p.clone().sub(q).normalize().multiplyScalar(len));
  pts.unshift(ext(pts[0], pts[1], 85));                        // south portal in the bank
  pts.push(ext(pts[pts.length - 1], pts[pts.length - 2], 60)); // north portal in the bank
  const n = pts.length;
  const dirs = [];
  for (let i = 0; i < n - 1; i++) dirs.push(pts[i + 1].clone().sub(pts[i]).normalize());
  const perp = (d) => new THREE.Vector2(-d.y, d.x); // right of travel
  const M = pts.map((p, i) => {
    const p0 = perp(dirs[Math.max(0, i - 1)]), p1 = perp(dirs[Math.min(n - 2, i)]);
    return p0.clone().add(p1).divideScalar(Math.max(0.3, 1 + p0.dot(p1)));
  });
  const P = (i, w, y) => V(pts[i].x + M[i].x * w, y, pts[i].y + M[i].y * w);
  const loft = (B, ring) => {
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < ring.length; j++) {
      const k = (j + 1) % ring.length;
      B.quad(P(i, ring[j][0], ring[j][1]), P(i, ring[k][0], ring[k][1]), P(i + 1, ring[k][0], ring[k][1]), P(i + 1, ring[j][0], ring[j][1]));
    }
  };
  const DECK = 40.0, GIRDER = 35.5;
  // Trapezoid box girder with 1 m parapets.
  loft(lrtConc, [[-5, DECK], [-5, DECK + 1], [-4.6, DECK + 1], [-4.6, DECK], [4.6, DECK], [4.6, DECK + 1], [5, DECK + 1], [5, DECK], [2.8, GIRDER], [-2.8, GIRDER]]);
  // Spine, glass tube and its floor slab below the girder.
  loft(lrtConc, [[-0.6, 34.4], [-0.6, GIRDER + 0.1], [0.6, GIRDER + 0.1], [0.6, 34.4]]);
  loft(glass, [[-1.75, 31.7], [-1.75, 34.5], [1.75, 34.5], [1.75, 31.7]]);
  loft(lrtConc, [[-1.95, 31.3], [-1.95, 31.7], [1.95, 31.7], [1.95, 31.3]]);
  // Piers at set distances along the line; they reach below the river bed so every one
  // meets the ground somewhere.
  const cum = [0];
  for (let i = 0; i < n - 1; i++) cum.push(cum[i] + pts[i].distanceTo(pts[i + 1]));
  for (const d of [70, 170, 290, 410, 500, 580, 660, 740]) {
    let i = 0;
    while (i < n - 2 && cum[i + 1] < d) i++;
    const f = (d - cum[i]) / (cum[i + 1] - cum[i]);
    const c = pts[i].clone().lerp(pts[i + 1], f);
    const az = V(dirs[i].x, 0, dirs[i].y), ax = V(-dirs[i].y, 0, dirs[i].x);
    const yTop = GIRDER + 0.1, yBot = -6;
    lrtPier.obox(V(c.x, (yTop + yBot) / 2, c.y), ax, V(0, 1, 0), az, 7.0, yTop - yBot, 2.4, true);
    lrtPier.obox(V(c.x, yTop - 0.7, c.y), ax, V(0, 1, 0), az, 9.5, 1.4, 3.2, true);
  }
  // Portals: concrete blocks the girder disappears into.
  for (const [i, dir] of [[0, dirs[0]], [n - 1, dirs[n - 2]]]) {
    const az = V(dir.x, 0, dir.y), ax = V(-dir.y, 0, dir.x);
    lrtPier.obox(V(pts[i].x, 36, pts[i].y), ax, V(0, 1, 0), az, 13, 10.5, 10, true);
  }
}

export function build(ctx) {
  const g = new THREE.Group();
  // The trestle's axis from OpenStreetMap; truss-local z runs south along it, x to the right.
  const [ax, az] = ctx.local(...HLB_N);
  const [bx, bz] = ctx.local(...HLB_S);
  const len = Math.hypot(bx - ax, bz - az);
  let ux = (bx - ax) / len, uz = (bz - az) / len;        // southbound direction
  const k = -(ax * ux + az * uz);                        // foot of the origin on the road line
  let ox = ax + ux * k, oz = az + uz * k;                // world position of truss-local t = 0
  let oy = 0, tilt = 0;
  // In the game, fit the trestle to the road the car actually drives (its line and height
  // differ a little from OSM), so the car runs between the trusses on the lower deck.
  let roadHalf = 4;
  if (ctx.route) {
    const fit = [];
    for (let t = T0 + 40; t <= T1 - 40; t += 20) {
      const r = ctx.route(ox + ux * t, oz + uz * t);
      if (r && Math.abs(r.lat) < 8) fit.push({ t, lat: r.lat, y: r.y, half: Math.max(r.right, -r.left) });
    }
    if (fit.length >= 4) {
      const line = (key) => {
        const n = fit.length, mt = fit.reduce((a, f) => a + f.t, 0) / n, mv = fit.reduce((a, f) => a + f[key], 0) / n;
        let num = 0, den = 0;
        for (const f of fit) { num += (f.t - mt) * (f[key] - mv); den += (f.t - mt) ** 2; }
        const slope = den ? num / den : 0;
        return (t) => mv + slope * (t - mt);
      };
      const latAt = line('lat'), yAt = line('y');
      // Points on the road line at both ends of the fitted stretch (the right normal of the
      // southbound direction is (-uz, ux); lat > 0 means the point is right of the road).
      const t0 = fit[0].t, t1 = fit[fit.length - 1].t;
      const q0 = [ox + ux * t0 + uz * latAt(t0), oz + uz * t0 - ux * latAt(t0)];
      const q1 = [ox + ux * t1 + uz * latAt(t1), oz + uz * t1 - ux * latAt(t1)];
      const l2 = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
      ux = (q1[0] - q0[0]) / l2; uz = (q1[1] - q0[1]) / l2;
      ox = q0[0] - ux * t0; oz = q0[1] - uz * t0;
      tilt = Math.atan((yAt(t1) - yAt(t0)) / (t1 - t0));
      oy = yAt(0) - ROAD_Y;
      roadHalf = Math.max(...fit.map((f) => f.half));
    }
  }
  const hlb = new THREE.Group();
  hlb.rotation.order = 'YXZ';
  hlb.rotation.set(-tilt, Math.atan2(ux, uz), 0);
  hlb.position.set(ox, oy, oz);
  hlb.updateMatrix();
  // Leave out any part that would stand on the road, from just above it up to 4.6 m, where
  // the road curves in and out of the straight trestle at its ends.
  const _p = new THREE.Vector3();
  const keep = ctx.route ? (a, b, r0) => {
    for (const f of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      _p.copy(a).lerp(b, f).applyMatrix4(hlb.matrix);
      const r = ctx.route(_p.x, _p.z);
      if (!r || _p.y < r.y + 0.05 - r0 || _p.y > r.y + 4.6 + r0) continue;
      if (r.lat > r.left - 0.3 - r0 && r.lat < r.right + 0.3 + r0) return false;
    }
    return true;
  } : null;
  const steel = new Builder(keep), lattice = new Builder(keep), conc = new Builder(), walk = new Builder();
  const deckDark = new Builder(), rail = new Builder(), lrtConc = new Builder(), lrtPier = new Builder(), glass = new Builder();

  buildHighLevel(ctx, steel, lattice, conc, walk, deckDark, rail, roadHalf);
  hlb.add(
    steel.mesh(ctx.mat(0x1e1e1e)),
    lattice.mesh(ctx.mat(0x1e1e1e, 'matte', { side: THREE.DoubleSide })),
    conc.mesh(ctx.mat(0x9a9890)),
    walk.mesh(ctx.mat(0x6e6c67)),
    deckDark.mesh(ctx.mat(0x2b2b2b)),
    rail.mesh(ctx.mat(0x8d8d8d, 'metal')),
  );
  g.add(hlb);

  buildMenzies(ctx, lrtConc, lrtPier, glass);
  g.add(lrtConc.mesh(ctx.mat(0xc8c6bf)), lrtPier.mesh(ctx.mat(0xb6b4ad)), glass.mesh(ctx.mat(0x9db4c4, 'glass')));
  return g;
}
