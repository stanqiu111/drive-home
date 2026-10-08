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

// Muttart Conservatory: four glass pyramids around a low concrete core on a grass terrace.
// Layout from the City of Edmonton roofline outline: the complex stands about 57 m east
// and 3 m south of the listed point and is turned 45° to the street grid, so the large
// pyramids (29 m base, 24 m tall) point true north and south and the small ones (23 m
// base, 18 m tall) east and west. Work is done in the complex's own frame (p east,
// q south before the 45° turn) and the whole site is rotated at the end.
export const sink = 0;

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Thin square bar from a to b (a mullion or frame member).
function bar(a, b, t) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.BoxGeometry(t, d.length(), t);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

// Axis-aligned box from extents.
const box = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

// Flat-shaded square pyramid: base half-size B at height y0, apex H above it.
function pyramid(B, y0, H) {
  const c = [[-B, -B], [-B, B], [B, B], [B, -B]];
  const pos = [];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = c[i], [x1, z1] = c[(i + 1) % 4];
    pos.push(x0, y0, z0, x1, y0, z1, 0, y0 + H, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Flat-topped mound: top rectangle at yTop, foot widened by m at yBot (grass banks).
function terrace([x0, x1, z0, z1], yTop, m, yBot) {
  const T = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const Bt = [[x0 - m, z0 - m], [x1 + m, z0 - m], [x1 + m, z1 + m], [x0 - m, z1 + m]];
  const pos = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const a = [Bt[i][0], yBot, Bt[i][1]], b = [Bt[j][0], yBot, Bt[j][1]];
    const c = [T[j][0], yTop, T[j][1]], d = [T[i][0], yTop, T[i][1]];
    pos.push(...b, ...a, ...d, ...b, ...d, ...c);
  }
  pos.push(T[0][0], yTop, T[0][1], T[3][0], yTop, T[3][1], T[2][0], yTop, T[2][1]);
  pos.push(T[0][0], yTop, T[0][1], T[2][0], yTop, T[2][1], T[1][0], yTop, T[1][1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function build(ctx) {
  const g = new THREE.Group();
  const glass = ctx.mat(0x7f9a9a, 'glass');
  const frame = ctx.mat(0xe4e8e5, 'glossy');
  const concrete = ctx.mat(0xbcb7ac, 'matte');
  const concreteDark = ctx.mat(0x8f8a81, 'matte');
  const grass = ctx.mat(0x8aa14e, 'matte');
  const paving = ctx.mat(0xcdc8bc, 'matte');
  const doorGlass = ctx.mat(0x334448, 'glossy');

  // Grass terrace in the true frame (the site is ~1.5 m above the listed point and the
  // ground east of it; the banks hide any mismatch with the map's terrain).
  const TOP = 1.75;
  g.add(new THREE.Mesh(terrace([4, 110, -58, 66], TOP, 4.5, -3), grass));

  // Everything else lives in the complex's own 45° frame.
  const site = new THREE.Group();
  site.position.set(57.1, TOP, 3.4);
  site.rotation.y = Math.PI / 4;
  g.add(site);

  // Pyramids: centre (p, q), base half-size, apex height above the plaza.
  const PYR = [
    { p: 24.85, q: -24.75, B: 14.45, H: 24 }, // large, true north
    { p: -24.75, q: 24.7, B: 14.45, H: 24 }, // large, true south
    { p: -22.75, q: -23.1, B: 11.5, H: 18 }, // small, true west
    { p: 22.95, q: 22.8, B: 11.5, H: 18 }, // small, true east
  ];
  const glassGeos = [], barGeos = [], plinthGeos = [], paveGeos = [];
  const PLINTH = 1.0;
  for (const { p, q, B, H } of PYR) {
    const y0 = PLINTH, Hg = H - PLINTH;
    const bb = B + 0.5;
    plinthGeos.push(box(p - bb, p + bb, 0, y0, q - bb, q + bb));
    paveGeos.push(box(p - bb - 1.5, p + bb + 1.5, 0, 0.12, q - bb - 1.5, q + bb + 1.5));
    glassGeos.push(pyramid(B, y0, Hg).translate(p, 0, q));
    // Hip edges and base frame.
    const apex = V(p, y0 + Hg, q);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of corners) barGeos.push(bar(V(p + sx * B, y0, q + sz * B), apex, 0.45));
    const base = corners.map(([sx, sz]) => V(p + sx * B, y0 + 0.17, q + sz * B));
    for (let i = 0; i < 4; i++) barGeos.push(bar(base[i], base[(i + 1) % 4], 0.35));
    // Horizontal mullion rings every 3 m.
    for (let h = 3; h < Hg - 1.5; h += 3) {
      const w = B * (1 - h / Hg), y = y0 + h;
      barGeos.push(bar(V(p - w, y, q - w), V(p + w, y, q - w), 0.22));
      barGeos.push(bar(V(p - w, y, q + w), V(p + w, y, q + w), 0.22));
      barGeos.push(bar(V(p - w, y, q - w), V(p - w, y, q + w), 0.22));
      barGeos.push(bar(V(p + w, y, q - w), V(p + w, y, q + w), 0.22));
    }
    // Vertical mullions on each face at quarter points; they end where they meet the hips.
    for (let k = -3; k <= 3; k++) {
      const x = k * B / 4, hTop = Hg * (1 - Math.abs(k) / 4), wTop = B * Math.abs(k) / 4;
      barGeos.push(bar(V(p + x, y0, q - B), V(p + x, y0 + hTop, q - wTop), 0.2));
      barGeos.push(bar(V(p + x, y0, q + B), V(p + x, y0 + hTop, q + wTop), 0.2));
      barGeos.push(bar(V(p - B, y0, q + x), V(p - wTop, y0 + hTop, q + x), 0.2));
      barGeos.push(bar(V(p + B, y0, q + x), V(p + wTop, y0 + hTop, q + x), 0.2));
    }
  }

  // Core: central hall with a clerestory, plus flat-roofed links filling the gaps between
  // neighbouring pyramids (their walls tuck ~3 m into the glass so the roofs meet it).
  const coreGeos = [
    box(-11, 11, 0, 4.8, -11, 11),
    box(-14.6, 13.6, 0, 4.6, -19.4, -8), // true north-west link
    box(-13.5, 14.9, 0, 4.6, 8, 19.2), // true south-east link
    box(-19.1, 8, 0, 4.6, -15.1, 13.4), // true south-west link
    box(-8, 31, 0, 4.6, -13.5, 14.7), // entrance hall, towards the car park (true north-east)
    box(31, 34, 0, 4.0, -3.5, 3.5), // entrance vestibule
  ];
  const darkGeos = [
    box(-11.3, 11.3, 6.0, 6.5, -11.3, 11.3), // clerestory roof
    box(30.5, 37.5, 4.0, 4.5, -5.2, 5.2), // entrance canopy
    box(36.8, 37.5, 0, 4.0, -5.2, -4.6), box(36.8, 37.5, 0, 4.0, 4.6, 5.2), // canopy posts
  ];
  glassGeos.push(box(-10.4, 10.4, 4.8, 6.0, -10.4, 10.4)); // clerestory band
  paveGeos.push(box(-13, 13, 0, 0.12, -13, 13), box(31, 46, 0, 0.12, -17, 17));

  site.add(
    new THREE.Mesh(merge(glassGeos), glass),
    new THREE.Mesh(merge(barGeos), frame),
    new THREE.Mesh(merge([...plinthGeos, ...coreGeos]), concrete),
    new THREE.Mesh(merge(darkGeos), concreteDark),
    new THREE.Mesh(merge(paveGeos), paving),
    new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2).rotateY(Math.PI / 2).translate(34.08, 1.9, 0), doorGlass),
  );
  return g;
}
