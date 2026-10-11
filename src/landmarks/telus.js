import * as THREE from 'three';
import { Parts, walls, cap, offsetPlan, tileTexture, bar, lowestGround } from './_kit.js';

// TELUS World of Science (Douglas Cardinal, 1984) in Coronation Park at 142 St and 111 Ave:
// a white, ribbed-metal "spaceship". A round drum holding the planetarium dome theatre rises
// out of a ring that floats on a glass base, the ring's rounded ribbed face banded with dark
// stripes and bristling with pointed blades along its top; the drum's top is a big black disk
// tilted toward the south. A fan-shaped lobby faces the park to the north, larger white blocks
// (the galleries and IMAX) stand to the west, and a tall lattice radio mast stands beside it.
// Outline from OpenStreetMap (way 27697119), the 33.4 m top from the City rooflines; the drum,
// ring and blades are sized from photos and the aerial. Origin = the Nominatim point.
export const sink = 0;

const OUTLINE = [[82.6, -48.8], [45.9, -23.3], [44.8, -24.9], [39.1, -21], [40.1, -19.4], [25.1, -8.9], [33.5, 3.1], [47.6, -3.7], [62.7, -5.8], [78, -3.1], [91.6, 4.2], [71.4, 32.3], [73.2, 35], [84.4, 27.5], [88.5, 35.8], [88.9, 49.6], [82.6, 61.9], [71.1, 69.5], [62, 71], [52.9, 69.4], [44.8, 64.9], [38.7, 57.9], [35.3, 49.3], [35.9, 35.5], [40.1, 27.3], [42.6, 25.5], [38.9, 21.3], [37.4, 22.6], [35.9, 21.3], [28.8, 29.7], [-6.5, 43.2], [-23.9, 57], [-39.6, 25.3], [-42.4, 13.8], [-34.1, 7], [-36.3, 4.2], [-4.2, -22.7], [-3.1, -21.4], [4.9, -28.1], [4.9, -33.8], [28, -42.9], [67.5, -70.4]];
const WEST = [[-36.3, 4.2], [-4.2, -22.7], [25.1, -8.9], [28.8, 29.7], [-6.5, 43.2], [-23.9, 57], [-39.6, 25.3], [-42.4, 13.8]];
const LOBBY = [[33.5, 3.1], [47.6, -3.7], [62.7, -5.8], [78, -3.1], [91.6, 4.2], [80, 22], [44, 22]];
const C = { x: 62, z: 44.5 }; // middle of the drum
const DRUM_R = 20, DRUM_LOW = 23, DRUM_HIGH = 33.4; // the top tilts down to the south
const RING_R = 33, RING_Y0 = 3.2, RING_Y1 = 11.6, BASE = 7.5;

export function build(ctx) {
  const P = new Parts();
  const ribsH = tileTexture(32, 64, (g, w, h) => { // horizontal ribs
    for (let y = 0; y < h; y += 4) { g.fillStyle = (y / 4) % 2 ? '#f3f6f8' : '#e0e5e9'; g.fillRect(0, y, w, 4); }
  });
  const ribsV = tileTexture(64, 32, (g, w, h) => { // vertical ribs, a seam every panel
    for (let x = 0; x < w; x += 4) { g.fillStyle = (x / 4) % 2 ? '#f4f6f8' : '#e2e6ea'; g.fillRect(x, 0, 4, h); }
    g.fillStyle = '#a9afb4'; g.fillRect(0, 0, 2, h);
  });
  // The ring's face: ribs with two dark stripes, as a band texture (v from bottom to top).
  const ringTex = (() => {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 128;
    const g = c.getContext('2d');
    for (let y = 0; y < 128; y += 4) { g.fillStyle = (y / 4) % 2 ? '#f3f6f8' : '#e0e5e9'; g.fillRect(0, y, 16, 4); }
    g.fillStyle = '#2b3036'; g.fillRect(0, 34, 16, 5); g.fillRect(0, 76, 16, 3);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  })();
  const M = {
    ribsH: new THREE.MeshStandardMaterial({ map: ribsH, roughness: 0.5, metalness: 0.2 }),
    ribsV: new THREE.MeshStandardMaterial({ map: ribsV, roughness: 0.5, metalness: 0.2 }),
    ring: new THREE.MeshStandardMaterial({ map: ringTex, roughness: 0.5, metalness: 0.2 }),
    roofRib: new THREE.MeshStandardMaterial({ map: ribsV, roughness: 0.45, metalness: 0.25 }),
    white: ctx.mat(0xf0f3f5, 'glossy'),
    black: ctx.mat(0x1f2225, 'glossy'),
    glass: ctx.mat(0x3e5560, 'glossy'),
    flat: ctx.mat(0xa7a9a8),
    mast: ctx.mat(0x9da3a8, 'glossy'),
  };
  const g0 = Math.min(0, lowestGround(ctx, OUTLINE, 0)) - 1;
  const RIB_UV = [3, 3];

  // ---- low base under everything: glass ground floor, white ribbed walls, flat roof ----
  P.add(M.glass, walls(offsetPlan(OUTLINE, -0.4), g0, RING_Y0));
  P.add(M.ribsH, walls(OUTLINE, RING_Y0, BASE, RIB_UV));
  P.add(M.flat, cap(OUTLINE, BASE));

  // ---- west galleries: a taller white block ----
  P.add(M.ribsV, walls(WEST, BASE, 16, RIB_UV));
  P.add(M.white, walls(offsetPlan(WEST, 0.2), 16, 16.8));
  P.add(M.flat, cap(offsetPlan(WEST, 0.2), 16.8));

  // ---- the lobby fan to the north, its ribbed roof rising toward the drum ----
  {
    const top = 11.5;
    P.add(M.ribsH, walls(LOBBY, BASE, 9.5, RIB_UV));
    // Sloping roof: from the north edge at 9.5 m up to the drum side at `top`.
    const pos = [];
    const n = LOBBY.length;
    const yAt = ([x, z]) => 9.5 + (top - 9.5) * Math.min(1, Math.max(0, (z + 6) / 28));
    const cx = LOBBY.reduce((s, p) => s + p[0], 0) / n, cz = LOBBY.reduce((s, p) => s + p[1], 0) / n;
    for (let i = 0; i < n; i++) {
      const a = LOBBY[i], b = LOBBY[(i + 1) % n];
      pos.push(cx, yAt([cx, cz]), cz, b[0], yAt(b), b[1], a[0], yAt(a), a[1]);
    }
    const roof = new THREE.BufferGeometry();
    roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    roof.computeVertexNormals();
    P.add(M.white, fixUp(roof));
    // Walls under the sloped roof edge.
    for (let i = 0; i < n; i++) {
      const a = LOBBY[i], b = LOBBY[(i + 1) % n];
      if (yAt(a) <= 9.6 && yAt(b) <= 9.6) continue;
      P.add(M.ribsH, wallQuad(a, b, 9.5, yAt(a), yAt(b)));
    }
  }

  // ---- the ring: a rounded ribbed band floating on the glass base, its roof sloping up to the
  // drum, with blades along its top edge ----
  {
    const prof = [[RING_R - 3.2, RING_Y0 - 0.2], [RING_R - 1.2, RING_Y0 + 0.6], [RING_R - 0.2, RING_Y0 + 2.2], [RING_R + 0.2, RING_Y0 + 4.2], [RING_R, RING_Y1 - 1.2], [RING_R - 0.5, RING_Y1]];
    const face = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48);
    face.translate(C.x, 0, C.z);
    P.add(M.ring, fixOut(face, C));
    const roof = new THREE.LatheGeometry([new THREE.Vector2(RING_R - 0.5, RING_Y1), new THREE.Vector2(DRUM_R, RING_Y1 + 3)].map((v) => v), 48);
    roof.translate(C.x, 0, C.z);
    P.add(M.roofRib, fixUpward(roof));
    const under = new THREE.RingGeometry(DRUM_R - 1, RING_R - 3.2, 48).rotateX(Math.PI / 2).translate(C.x, RING_Y0 - 0.2, C.z);
    P.add(M.white, under);
    // Blades: flat spikes pointing out and slightly up, every 15 degrees (not over the lobby).
    const blade = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, -1.3), new THREE.Vector2(9, 0), new THREE.Vector2(0, 1.3)]), { depth: 0.35, bevelEnabled: false });
    blade.rotateX(-Math.PI / 2).translate(0, 0, 0); // shape (x, y) -> (x, 0, -y); depth up
    blade.rotateZ(0.14);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + 0.13;
      const dx = Math.cos(a), dz = Math.sin(a);
      if (dz < -0.55) continue; // the lobby side
      const b = blade.clone().translate(RING_R - 1.5, 0, 0).rotateY(-a).translate(C.x, RING_Y1 - 0.4, C.z);
      P.add(M.white, b);
      // The V-shaped dark seam under each blade.
      const tipV = new THREE.Vector3(C.x + dx * (RING_R + 0.3), RING_Y0 + 4.4, C.z + dz * (RING_R + 0.3));
      for (const s of [-1, 1]) {
        const b2 = a + s * 0.045;
        P.add(M.black, bar(new THREE.Vector3(C.x + Math.cos(b2) * (RING_R + 0.2), RING_Y1 - 0.7, C.z + Math.sin(b2) * (RING_R + 0.2)), tipV, 0.22));
      }
    }
    // Pilotis under the ring.
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = C.x + Math.cos(a) * (RING_R - 4.2), z = C.z + Math.sin(a) * (RING_R - 4.2);
      P.add(M.white, new THREE.CylinderGeometry(0.4, 0.4, RING_Y0 - g0, 8).translate(x, (RING_Y0 + g0) / 2, z));
    }
  }

  // ---- the drum: vertical ribs, its top a black disk tilted down to the south ----
  {
    const N = 48, bottom = RING_Y1 + 2.5, mid = (DRUM_LOW + DRUM_HIGH) / 2, half = (DRUM_HIGH - DRUM_LOW) / 2;
    const top = (a) => mid - half * Math.sin(a); // sin a = -1 on the north side
    const pos = [], uv = [], disk = [];
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      const x0 = C.x + Math.cos(a0) * DRUM_R, z0 = C.z + Math.sin(a0) * DRUM_R, x1 = C.x + Math.cos(a1) * DRUM_R, z1 = C.z + Math.sin(a1) * DRUM_R;
      const t0 = top(a0), t1 = top(a1);
      pos.push(x0, bottom, z0, x0, t0, z0, x1, t1, z1, x0, bottom, z0, x1, t1, z1, x1, bottom, z1);
      const u0 = (k / N) * (2 * Math.PI * DRUM_R) / 3, u1 = ((k + 1) / N) * (2 * Math.PI * DRUM_R) / 3;
      uv.push(u0, bottom / 3, u0, t0 / 3, u1, t1 / 3, u0, bottom / 3, u1, t1 / 3, u1, bottom / 3);
      disk.push(C.x, mid, C.z, x1, t1, z1, x0, t0, z0);
    }
    const wall = new THREE.BufferGeometry();
    wall.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wall.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    wall.computeVertexNormals();
    P.add(M.ribsV, fixOut(wall, C));
    const d = new THREE.BufferGeometry();
    d.setAttribute('position', new THREE.Float32BufferAttribute(disk, 3));
    d.computeVertexNormals();
    P.add(M.black, fixUpward(d));
    // Rim around the disk and two tall blade fins framing a dark window on the south side.
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      P.add(M.white, bar(new THREE.Vector3(C.x + Math.cos(a0) * (DRUM_R + 0.2), top(a0) + 0.2, C.z + Math.sin(a0) * (DRUM_R + 0.2)), new THREE.Vector3(C.x + Math.cos(a1) * (DRUM_R + 0.2), top(a1) + 0.2, C.z + Math.sin(a1) * (DRUM_R + 0.2)), 0.5));
    }
    for (const s of [-1, 1]) {
      const a = Math.PI / 2 + s * 0.22, x = C.x + Math.cos(a) * DRUM_R, z = C.z + Math.sin(a) * DRUM_R;
      const fin = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(4.5, 0), new THREE.Vector2(0, 11)]), { depth: 0.4, bevelEnabled: false });
      fin.translate(0, 0, -0.2).rotateY(-a).translate(x, bottom, z);
      P.add(M.white, fin);
    }
    P.add(M.black, new THREE.PlaneGeometry(4.5, 5).translate(0, 2.5, 0).rotateY(0).translate(C.x, bottom + 1, C.z + DRUM_R + 0.15));
  }

  // ---- lattice radio mast beside the building ----
  {
    const mx = 100, mz = 16, H = 46, w = 1.2;
    const legs = [[-w, -w], [w, -w], [w, w], [-w, w]];
    const gm = ctx.ground(mx, mz) ?? 0;
    for (const [lx, lz] of legs) P.add(M.mast, bar(new THREE.Vector3(mx + lx, gm - 0.5, mz + lz), new THREE.Vector3(mx + lx * 0.5, gm + H, mz + lz * 0.5), 0.18));
    for (let y = 3; y < H; y += 3) {
      const f = 1 - (y / H) * 0.5;
      for (let i = 0; i < 4; i++) {
        const [ax, az] = legs[i], [bx, bz] = legs[(i + 1) % 4];
        P.add(M.mast, bar(new THREE.Vector3(mx + ax * f, gm + y, mz + az * f), new THREE.Vector3(mx + bx * f, gm + y + 3, mz + bz * f), 0.08));
      }
    }
    P.add(M.mast, bar(new THREE.Vector3(mx - 7, gm + H, mz), new THREE.Vector3(mx + 7, gm + H, mz), 0.15), bar(new THREE.Vector3(mx, gm + H, mz - 5), new THREE.Vector3(mx, gm + H, mz + 5), 0.12));
    for (const t of [-5, -2.5, 0, 2.5, 5]) P.add(M.mast, bar(new THREE.Vector3(mx + t, gm + H, mz - 2.5), new THREE.Vector3(mx + t, gm + H, mz + 2.5), 0.06));
  }
  return P.group();
}

// One wall quad from a to b, bottom at y0, top at ya/yb, facing away from the plan's middle
// (only used on the lobby, whose outline runs clockwise: the outside is on the left).
function wallQuad(a, b, y0, ya, yb) {
  const pos = [b[0], y0, b[1], a[0], y0, a[1], a[0], ya, a[1], b[0], y0, b[1], a[0], ya, a[1], b[0], yb, b[1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Flip triangles whose normals point away from what `want` says.
function orient(geo, want) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array;
  const uv = g.attributes.uv?.array;
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const c = [(p[i] + p[i + 3] + p[i + 6]) / 3, (p[i + 1] + p[i + 4] + p[i + 7]) / 3, (p[i + 2] + p[i + 5] + p[i + 8]) / 3];
    const w = want(c);
    if (n[0] * w[0] + n[1] * w[1] + n[2] * w[2] < 0) {
      for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
      if (uv) { const j = (i / 9) * 6; for (let k = 0; k < 2; k++) { const t = uv[j + 2 + k]; uv[j + 2 + k] = uv[j + 4 + k]; uv[j + 4 + k] = t; } }
    }
  }
  g.attributes.position.needsUpdate = true;
  if (g.attributes.normal) g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}
const fixOut = (g, c) => orient(g, ([x, , z]) => [x - c.x, 0, z - c.z]);
const fixUp = (g) => orient(g, () => [0, 1, 0]);
const fixUpward = fixUp;
