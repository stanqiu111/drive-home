import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Enbridge Edmonton Terminal: the tank farm north of Baseline Rd at the Henday. Origin =
// the OSM site centroid; the fenced site covers x -471..322 (east) and z -553..367 (south),
// Baseline Rd runs ~390 m south of the origin. Every tank sits on its OpenStreetMap
// footprint (36 tanks, 32-64 m across) inside grass berms; the pump station with its small
// buildings is at the south-west corner, as mapped.
//
// The model is pinned to the terrain at the origin only, so bases follow this least-squares
// plane through the NRCan terrain over the site (rms 1 m) and are carried BURY m below it.
const C0 = -0.19, A = 0.00278, B = 0.00476;
const gy = (x, z) => C0 + A * x + B * z;
const BURY = 5;
const N = new THREE.Vector3(-A, 1, -B).normalize();

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

function groundFrame(cx, cz, dx, dz, yOff = 0) {
  const u = new THREE.Vector3(dx, A * dx + B * dz, dz).normalize();
  const w = new THREE.Vector3().crossVectors(u, N).normalize();
  return new THREE.Matrix4().makeBasis(u, N, w).setPosition(cx, gy(cx, cz) + yOff, cz);
}
function groundBox(list, cx, cz, lenX, lenZ, h, top) {
  list.push(new THREE.BoxGeometry(lenX, h, lenZ).translate(0, -h / 2, 0).applyMatrix4(groundFrame(cx, cz, 1, 0, top)));
}
function alongGround(list, x0, z0, x1, z1, w, h, top) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  list.push(new THREE.BoxGeometry(L, h, w).translate(0, -h / 2, 0).applyMatrix4(groundFrame((x0 + x1) / 2, (z0 + z1) / 2, dx, dz, top)));
}
function pipeAlong(list, x0, z0, x1, z1, r, y) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  list.push(new THREE.CylinderGeometry(r, r, L, 6, 1, true).rotateZ(Math.PI / 2).applyMatrix4(groundFrame((x0 + x1) / 2, (z0 + z1) / 2, dx, dz, y)));
}
function block(list, x, z, w, d, h) {
  list.push(new THREE.BoxGeometry(w, h + BURY, d).translate(x, gy(x, z) + (h - BURY) / 2, z));
}
function instanced(geo, mat, items) {
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    _p.set(it.x, it.y, it.z);
    _q.setFromEuler(_e.set(it.rx || 0, it.ry || 0, it.rz || 0));
    _s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    im.setMatrixAt(i, _m.compose(_p, _q, _s));
  });
  return im;
}
const merged = (list, mat) => (list.length ? new THREE.Mesh(mergeGeometries(list, false), mat) : null);
const uCylOpen = (seg) => new THREE.CylinderGeometry(1, 1, 1, seg, 1, true).translate(0, 0.5, 0);
const uDisc = (seg) => new THREE.CircleGeometry(1, seg).rotateX(-Math.PI / 2);
const uBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

export function build(ctx) {
  const g = new THREE.Group();
  const M = {
    white: ctx.mat(0xe8e8e6, 'matte'),
    tankTop: ctx.mat(0xa4a7a9, 'matte'),
    tankBand: ctx.mat(0x7d8083, 'matte'),
    steel: ctx.mat(0x8c8f91, 'matte'),
    dark: ctx.mat(0x5a5e62, 'matte'),
    building: ctx.mat(0x9a9ea2, 'matte'),
    earth: ctx.mat(0x8d9552, 'matte'),
    fence: ctx.mat(0xc9ccce, 'matte', { transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
  };
  const L = { white: [], steel: [], dark: [], building: [], earth: [], fence: [], tankTop: [], tankBand: [] };

  // ---- Tanks on their OSM footprints: [x, z, diameter, height] -----------------------
  const tanks = [
    [-430, -483, 39, 15], [-238, -475, 53, 17], [-153, -455, 60, 18], [-28, -457, 63, 18], [83, -455, 63, 18], [208, -455, 63, 18], [-317, -450, 55, 17],
    [-220, -351, 38, 15], [-89, -341, 60, 18], [220, -338, 60, 18], [-11, -317, 60, 18], [-281, -314, 44, 16], [-158, -314, 43, 16], [139, -273, 60, 18],
    [-243, -128, 46, 16], [-111, -127, 46, 16], [22, -127, 46, 16], [130, -129, 39, 15], [220, -130, 39, 15],
    [-243, 3, 46, 16], [-110, 5, 46, 16], [23, 2, 46, 16], [131, 3, 39, 15],
    [-395, 35, 50, 16], [-210, 82, 64, 18], [-11, 83, 64, 18], [-108, 96, 38, 15], [193, 96, 46, 16],
    [116, 159, 46, 16], [-21, 206, 46, 16], [-134, 236, 38, 15], [-111, 184, 32, 14],
  ];
  const tBody = [], tTop = [], tBand = [], tStair = [];
  for (const [x, z, dia, h] of tanks) {
    const r = dia / 2, y = gy(x, z);
    tBody.push({ x, y: y - BURY, z, sx: r, sy: h + BURY, sz: r });
    tTop.push({ x, y: y + h + 0.05, z, sx: r * 1.03, sy: 1, sz: r * 1.03 });
    tBand.push({ x, y: y + h - 1.1, z, sx: r * 1.025, sy: 1.15, sz: r * 1.025 });
    const th = ((x * 7 + z * 3) % 360) * Math.PI / 180, len = Math.min(h / Math.sin(0.6), r * 2.2);
    tStair.push({ x: x + (r + 0.7) * Math.cos(th), y: y + h / 2, z: z + (r + 0.7) * Math.sin(th), ry: -th - Math.PI / 2, rz: 0.6, sx: len, sy: 1.1, sz: 1.3 });
  }
  g.add(instanced(uCylOpen(16), M.white, tBody), instanced(uDisc(16), M.tankTop, tTop),
    instanced(uCylOpen(16), M.tankBand, tBand), instanced(new THREE.BoxGeometry(1, 1, 1), M.dark, tStair));

  // Small booster tanks and the pump-station buildings (OSM footprints), south-west corner.
  for (const [x, z, dia, h] of [[-452, 210, 29, 10], [-403, 234, 29, 10], [-393, 101, 27, 10], [-235, 224, 26, 10], [-198, 193, 30, 10]]) {
    const r = dia / 2, y = gy(x, z);
    L.white.push(new THREE.CylinderGeometry(r, r, h + BURY, 12, 1, true).translate(x, y + (h - BURY) / 2, z));
    L.tankTop.push(new THREE.CircleGeometry(r * 1.03, 12).rotateX(-Math.PI / 2).translate(x, y + h + 0.05, z));
  }
  for (const [x, z, w, d, h] of [[-338, 15, 12, 10, 5], [-336, 46, 9, 9, 4], [-411, 94, 10, 10, 4], [-417, 169, 10, 10, 4], [-421, -338, 13, 11, 5], [-406, -332, 11, 9, 4],
    [-261, 147, 17, 15, 6], [-301, 167, 13, 11, 5], [-242, 185, 18, 14, 6], [-288, 227, 15, 13, 5], [-401, 298, 14, 12, 5], [-320, 110, 36, 16, 8], [-200, 160, 8, 7, 4]]) {
    block(L.building, x, z, w, d, h);
  }
  block(L.dark, -320, 110, 8, 5, 10); // pump house vent stack... a squat tower

  // ---- Grass berms: rows of tanks share an enclosure, 8 m wide, 2.5 m high -----------
  const berm = (x0, x1, z0, z1) => {
    groundBox(L.earth, (x0 + x1) / 2, z0, x1 - x0 + 8, 8, 2.5 + BURY, 2.5);
    groundBox(L.earth, (x0 + x1) / 2, z1, x1 - x0 + 8, 8, 2.5 + BURY, 2.5);
    groundBox(L.earth, x0, (z0 + z1) / 2, 8, z1 - z0, 2.5 + BURY, 2.5);
    groundBox(L.earth, x1, (z0 + z1) / 2, 8, z1 - z0, 2.5 + BURY, 2.5);
  };
  berm(-465, 255, -515, -240); groundBox(L.earth, -105, -398, 728, 8, 2.5 + BURY, 2.5);
  berm(-275, 255, -162, 30); groundBox(L.earth, -10, -62, 538, 8, 2.5 + BURY, 2.5);
  berm(-300, 230, 45, 268);
  berm(-432, -358, 2, 68);

  // Manifold pipes along the berms and a trunk line to the pump station.
  pipeAlong(L.steel, -465, -232, 255, -232, 0.5, 1.2);
  pipeAlong(L.steel, -275, 38, 255, 38, 0.5, 1.2);
  pipeAlong(L.steel, -300, 276, 230, 276, 0.5, 1.2);
  pipeAlong(L.steel, -350, -515, -350, 300, 0.6, 1.2);
  pipeAlong(L.steel, -350, 300, -250, 300, 0.6, 1.2);

  // ---- Perimeter chain-link fence on the OSM boundary ----------------------------------
  const ring = [[-471, -553], [311, -553], [322, -81], [316, 17], [277, 108], [240, 155], [190, 202], [136, 234], [-70, 297], [-311, 362], [-469, 367], [-471, -553]];
  const posts = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[i + 1];
    alongGround(L.fence, x0, z0, x1, z1, 0.12, 2.4 + BURY, 2.4);
    if (z0 < -500 && z1 < -500) continue; // no posts on the far north side
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 60));
    for (let k = 0; k <= n; k++) { const t = k / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; posts.push({ x, y: gy(x, z) - BURY, z, sx: 0.22, sy: 2.6 + BURY, sz: 0.22 }); }
  }
  g.add(instanced(uBox(), M.dark, posts));
  // Gate and gatehouse on the south-west fence, toward Baseline Rd.
  block(L.white, -330, 350, 7, 4, 3.2);

  for (const [k, list] of Object.entries(L)) { const m = merged(list, M[k]); if (m) g.add(m); }
  return g;
}
