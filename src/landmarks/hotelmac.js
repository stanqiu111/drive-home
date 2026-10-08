import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Box/cylinder parts are indexed and hand-built ones aren't; flatten them all so they merge.
function merge(list) {
  return mergeGeometries(list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  }));
}

// Fairmont Hotel Macdonald (1915): L-shaped château of pale limestone, 8 storeys to the
// eaves, under a steep green copper roof with dormer rows, chimneys, corner turrets and a
// big round tower at the inside corner facing the river. The outline follows the OSM
// footprint turned onto the hotel's own grid (5.7° off true north): a 45° entrance
// chamfer at the north-west, a pavilion at the north-east and an octagonal south end.
export const sink = 0;

const ROT = 5.7 * Math.PI / 180; // the hotel's east axis points slightly north of east
const EAVE = 30, RUN = 7.8, RISE = 15.6; // roof: 2:1 slope, truncated at 45.6 m
const TOWER = { p: 0, q: 7.5, r: 7.5 };

// Body outline in the hotel frame (p east, q south), clockwise.
const OUTLINE = [
  [-6, -24.7], [26.1, -24.7], [26.1, -30.2], [41.5, -30.2], [41.7, 4.3], [10, 4.3],
  [-12.2, 26.5], [-12.2, 30.4], [-16.8, 35.2], [-23.3, 35.2], [-28.6, 30.4], [-28.6, 0.2],
  [-12.1, -16.3], [-6, -16.3],
];

const box = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// Edges of a polygon with length, tangent and outward normal.
function edges(poly) {
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const t = [dx / len, dz / len];
    let n = [t[1], -t[0]];
    const mx = (a[0] + b[0]) / 2 + n[0] * 0.3, mz = (a[1] + b[1]) / 2 + n[1] * 0.3;
    if (inside(poly, mx, mz)) n = [-n[0], -n[1]];
    return { a, b, len, t, n };
  });
}

// Polygon shrunk by d (each edge moved inward); vertices from neighbouring offset lines.
function inset(poly, d) {
  const E = edges(poly), out = [];
  for (let i = 0; i < E.length; i++) {
    const e0 = E[(i + E.length - 1) % E.length], e1 = E[i];
    const p0 = [e0.a[0] - e0.n[0] * d, e0.a[1] - e0.n[1] * d], p1 = [e1.a[0] - e1.n[0] * d, e1.a[1] - e1.n[1] * d];
    const den = e0.t[0] * e1.t[1] - e0.t[1] * e1.t[0];
    if (Math.abs(den) < 1e-6) { out.push(p1); continue; }
    const s = ((p1[0] - p0[0]) * e1.t[1] - (p1[1] - p0[1]) * e1.t[0]) / den;
    out.push([p0[0] + e0.t[0] * s, p0[1] + e0.t[1] * s]);
  }
  return out;
}

// Flat-shaded triangles from a flat position list.
function tris(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Extrude a (p, q) polygon from y0 up by h.
function prism(poly, y0, h) {
  const s = new THREE.Shape(poly.map(([p, q]) => new THREE.Vector2(p, -q)));
  return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y0, 0);
}

function flat(poly, y) {
  const s = new THREE.Shape(poly.map(([p, q]) => new THREE.Vector2(p, -q)));
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2).translate(0, y, 0);
}

// Steep roof over a polygon: one sloped face per edge up to the inset top, plus the top.
function roof(poly) {
  const top = inset(poly, RUN), pos = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const P0 = [poly[i][0], EAVE, poly[i][1]], P1 = [poly[j][0], EAVE, poly[j][1]];
    const Q0 = [top[i][0], EAVE + RISE, top[i][1]], Q1 = [top[j][0], EAVE + RISE, top[j][1]];
    pos.push(...P1, ...P0, ...Q0, ...P1, ...Q0, ...Q1);
  }
  return { faces: tris(pos), cap: flat(top, EAVE + RISE), top };
}

// Gabled dormer in a local frame: x along the roof edge, +z outward, origin at the
// bottom centre of the front face (which is sunk below the roof surface).
function dormer(w, hw, hg, d) {
  const L = -w / 2, R = w / 2, A = hw + hg;
  const bl = [L, 0, 0], br = [R, 0, 0], tr = [R, hw, 0], tl = [L, hw, 0], ap = [0, A, 0];
  const blb = [L, 0, -d], brb = [R, 0, -d], trb = [R, hw, -d], tlb = [L, hw, -d], apb = [0, A, -d];
  return tris([
    ...bl, ...br, ...tr, ...bl, ...tr, ...tl, ...tl, ...tr, ...ap, // front
    ...bl, ...tl, ...tlb, ...bl, ...tlb, ...blb, // left wall
    ...br, ...brb, ...trb, ...br, ...trb, ...tr, // right wall
    ...tl, ...ap, ...apb, ...tl, ...apb, ...tlb, // left slope
    ...tr, ...trb, ...apb, ...tr, ...apb, ...ap, // right slope
  ]);
}

// Round turret: cylinder with a conical cap (and a corbelled foot when it hangs off a wall).
function turret(p, q, r, y0, y1, capH, corbel) {
  const parts = [
    new THREE.CylinderGeometry(r, r, y1 - y0, 14, 1, true).translate(p, (y0 + y1) / 2, q),
  ];
  if (corbel) parts.push(new THREE.CylinderGeometry(r, r * 0.25, corbel, 14, 1, true).translate(p, y0 - corbel / 2, q));
  const cap = new THREE.ConeGeometry(r + 0.4, capH, 14, 1, true).translate(p, y1 + capH / 2, q);
  return { body: merge(parts), cap };
}

export function build(ctx) {
  const g = new THREE.Group();
  const stone = ctx.mat(0xcfc9ba, 'matte');
  const stoneDark = ctx.mat(0xa9a394, 'matte');
  const copper = ctx.mat(0x6e8b74, 'matte');
  const copperLight = ctx.mat(0x7c9a84, 'matte');
  const glassDark = ctx.mat(0x2b3440, 'glossy');
  const trim = ctx.mat(0x5a544c, 'matte');

  const hotel = new THREE.Group();
  hotel.rotation.y = ROT;
  g.add(hotel);

  const stoneGeos = [], copperGeos = [], copperLightGeos = [], glassGeos = [], darkGeos = [], trimGeos = [];

  // Terrace plinth: buried deep because the ground falls away to the river on the south
  // and east; its exposed sides read as retaining walls, its top as the terrace.
  const TER = [[-31, -32], [44, -32], [44, 20], [20, 46], [-31, 46]];
  darkGeos.push(prism(TER, -16, 16.35));
  // Balustrade along the terrace edges above the river.
  const bal = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const b = new THREE.BoxGeometry(len, 1.1, 0.5).translate(0, 0.9, 0);
    b.rotateY(-Math.atan2(z1 - z0, x1 - x0));
    b.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    stoneGeos.push(b);
  };
  bal(43.7, 4.6, 43.7, 19.8); bal(43.7, 19.8, 20.2, 45.7); bal(20.2, 45.7, -30.7, 45.7); bal(-30.7, 45.7, -30.7, 36);

  // Limestone body.
  stoneGeos.push(prism(OUTLINE, 0, EAVE));
  // Stone band at the eave (cornice) and above the ground floor.
  const E = edges(OUTLINE);
  for (const e of E) {
    for (const [y, h, out] of [[EAVE - 0.9, 0.9, 0.35], [4.6, 0.5, 0.2]]) {
      const b = new THREE.BoxGeometry(e.len + out * 2, h, out).translate(0, y + h / 2, out / 2);
      b.rotateY(Math.atan2(e.n[0], e.n[1])); // local +z (outward) onto the edge normal
      b.translate((e.a[0] + e.b[0]) / 2, 0, (e.a[1] + e.b[1]) / 2);
      stoneGeos.push(b);
    }
  }

  // Punched windows: ground floor tall, upper floors regular, 3.3 m bays.
  const floors = [{ y: 1.0, w: 2.0, h: 3.0 }];
  for (let i = 1; i < 8; i++) floors.push({ y: 4.6 + (i - 1) * 3.6 + 0.9, w: 1.5, h: 2.1 });
  const pane = (x, y, z, nx, nz, w, h) => {
    const q = new THREE.PlaneGeometry(w, h).rotateY(Math.atan2(nx, nz)).translate(x + nx * 0.07, y, z + nz * 0.07);
    glassGeos.push(q);
  };
  for (const e of E) {
    if (e.len < 3) continue;
    const n = Math.max(1, Math.floor((e.len - 1.4) / 3.3));
    const step = e.len / n;
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) * step;
      const x = e.a[0] + e.t[0] * s, z = e.a[1] + e.t[1] * s;
      for (const f of floors) pane(x, f.y + f.h / 2, z, e.n[0], e.n[1], f.w, f.h);
    }
  }

  // Main entrance on the chamfer: door and porte-cochère.
  const ch = E[11]; // (-28.6, 0.2) -> (-12.1, -16.3)
  const cx = (ch.a[0] + ch.b[0]) / 2, cz = (ch.a[1] + ch.b[1]) / 2;
  pane(cx, 2.0, cz, ch.n[0], ch.n[1], 4.5, 3.8);
  {
    const ang = Math.atan2(ch.n[0], ch.n[1]);
    const canopy = new THREE.BoxGeometry(12, 0.6, 6).translate(0, 5.0, 3.2).rotateY(ang).translate(cx, 0, cz);
    stoneGeos.push(canopy);
    for (const sx of [-4.8, 4.8]) {
      const col = new THREE.BoxGeometry(0.8, 4.7, 0.8).translate(sx, 2.35, 5.6).rotateY(ang).translate(cx, 0, cz);
      stoneGeos.push(col);
    }
  }

  // Roof: steep copper faces over the outline, flat top, dormer rows, chimneys.
  const R = roof(OUTLINE);
  copperGeos.push(R.faces, R.cap);
  const lower = dormer(3.0, 3.6, 1.5, 4.5), upper = dormer(2.2, 2.6, 1.2, 3.5);
  const placeDormer = (proto, e, s, yb, target, win) => {
    const ins = yb * RUN / RISE - 0.35; // horizontal distance in from the eave
    const x = e.a[0] + e.t[0] * s - e.n[0] * ins, z = e.a[1] + e.t[1] * s - e.n[1] * ins;
    const ang = Math.atan2(e.n[0], e.n[1]);
    const d = proto.clone().rotateY(ang).translate(x, EAVE + yb - 1.0, z);
    target.push(d);
    glassGeos.push(new THREE.PlaneGeometry(win[0], win[1]).translate(0, win[2], 0.04).rotateY(ang).translate(x, EAVE + yb - 1.0, z));
  };
  for (const e of E) {
    if (e.len < 9) continue;
    const n = Math.floor((e.len - 7) / 5.2) + 1, step = (e.len - 7) / Math.max(1, n - 1);
    for (let k = 0; k < n; k++) {
      const s = n === 1 ? e.len / 2 : 3.5 + k * step;
      placeDormer(lower, e, s, 0.3, stoneGeos, [1.4, 1.9, 2.2]);
      if (k < n - 1 && e.len >= 14) placeDormer(upper, e, s + step / 2, 8.0, copperLightGeos, [1.1, 1.3, 1.9]);
    }
  }
  // Chimneys straddling the edge of the flat top.
  const chim = (p, q) => {
    stoneGeos.push(box(p - 1.2, p + 1.2, 40, 48.3, q - 0.8, q + 0.8));
    trimGeos.push(box(p - 1.35, p + 1.35, 48.3, 48.9, q - 0.95, q + 0.95));
  };
  for (const p of [8, 19, 30]) chim(p, -16.9);
  for (const p of [13, 25]) chim(p, -3.5);
  chim(-20.4, 8); chim(-20.4, 22);

  // Round tower at the inside corner (river side) with a tall conical roof.
  {
    const t = turret(TOWER.p, TOWER.q, TOWER.r, 0, EAVE + 1.5, 15.5, 0);
    stoneGeos.push(t.body);
    copperGeos.push(t.cap);
    stoneGeos.push(new THREE.CylinderGeometry(TOWER.r + 0.35, TOWER.r + 0.35, 0.9, 14).translate(TOWER.p, EAVE + 1.05, TOWER.q));
    for (const deg of [-10, 15, 40, 65, 90]) {
      const a = deg * Math.PI / 180, nx = Math.cos(a), nz = Math.sin(a);
      for (const f of floors) pane(TOWER.p + nx * TOWER.r, f.y + f.h / 2, TOWER.q + nz * TOWER.r, nx, nz, f.w * 0.8, f.h);
    }
  }
  // Corner turrets (bartizans) corbelled out from the upper floors.
  for (const [p, q] of [[41.5, -30.2], [41.7, 4.3], [-28.6, 0.2], [-12.1, -16.3], [-12.2, 30.4], [-28.6, 30.4]]) {
    const t = turret(p, q, 2.0, 22, 33.5, 5.5, 2.2);
    stoneGeos.push(t.body);
    copperGeos.push(t.cap);
  }

  hotel.add(
    new THREE.Mesh(merge(stoneGeos), stone),
    new THREE.Mesh(merge(darkGeos), stoneDark),
    new THREE.Mesh(merge(copperGeos), copper),
    new THREE.Mesh(merge(copperLightGeos), copperLight),
    new THREE.Mesh(merge(glassGeos), glassDark),
    new THREE.Mesh(merge(trimGeos), trim),
  );
  return g;
}
