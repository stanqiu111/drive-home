import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Suncor Edmonton Refinery: the second forest of columns, stacks and a flare behind the
// Enbridge tanks, 2 km north of Baseline Rd, so it only ever reads as a skyline. Origin =
// the OSM process-area centroid (x -339..214, z -228..199); the tank farm south of it sits
// on OpenStreetMap footprints. No map's terrain grid reaches it yet, so the ground is flat.
const BURY = 4;
const gy = () => 0;

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
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
const uCone = (seg) => new THREE.ConeGeometry(1, 1, seg, 1, true).translate(0, 0.5, 0);
function block(list, x, z, w, d, h) {
  list.push(new THREE.BoxGeometry(w, h + BURY, d).translate(x, gy(x, z) + (h - BURY) / 2, z));
}
function boxAlong(list, x0, z0, x1, z1, w, h, top) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  list.push(new THREE.BoxGeometry(L, h, w).translate(0, -h / 2, 0).rotateY(Math.atan2(-dz, dx)).translate((x0 + x1) / 2, top, (z0 + z1) / 2));
}

export function build(ctx) {
  const g = new THREE.Group();
  const M = {
    white: ctx.mat(0xe8e8e6, 'matte'),
    tankTop: ctx.mat(0xa4a7a9, 'matte'),
    tankBand: ctx.mat(0x7d8083, 'matte'),
    column: ctx.mat(0xaeb3b8, 'glossy'),
    steel: ctx.mat(0x8c8f91, 'matte'),
    dark: ctx.mat(0x5a5e62, 'matte'),
    building: ctx.mat(0x9a9ea2, 'matte'),
    heater: ctx.mat(0x7f8488, 'matte'),
    red: ctx.mat(0xc8362e, 'matte'),
    earth: ctx.mat(0x8d9552, 'matte'),
    flame: ctx.mat(0xff8a2a, 'glow'),
    flameHaze: ctx.mat(0xffb060, 'glow', { transparent: true, opacity: 0.35, depthWrite: false }),
    plume: ctx.mat(0xf4f4f2, 'matte', { transparent: true, opacity: 0.4, depthWrite: false }),
    lattice: ctx.mat(0x8c8f91, 'matte', { wireframe: true }),
  };
  const L = { white: [], steel: [], dark: [], building: [], heater: [], red: [], earth: [], flame: [], flameHaze: [], plume: [], lattice: [], column: [], tankTop: [], tankBand: [] };

  // ---- Tanks (OSM footprints): [x, z, diameter, height] -------------------------------
  const tanks = [[-229, 313, 38, 15], [-173, 315, 38, 15], [-117, 315, 38, 15], [-334, 336, 38, 15], [-19, 353, 53, 17], [82, 353, 53, 17], [186, 353, 53, 17],
    [-344, 425, 53, 17], [-227, 425, 53, 17], [-133, 425, 53, 17], [84, 480, 53, 17], [182, 480, 53, 17], [-413, -28, 77, 18], [135, 110, 52, 17]];
  const tBody = [], tTop = [], tBand = [];
  for (const [x, z, dia, h] of tanks) {
    const r = dia / 2, y = gy(x, z);
    tBody.push({ x, y: y - BURY, z, sx: r, sy: h + BURY, sz: r });
    tTop.push({ x, y: y + h + 0.05, z, sx: r * 1.03, sy: 1, sz: r * 1.03 });
    tBand.push({ x, y: y + h - 1.1, z, sx: r * 1.025, sy: 1.15, sz: r * 1.025 });
  }
  g.add(instanced(uCylOpen(12), M.white, tBody), instanced(uDisc(12), M.tankTop, tTop), instanced(uCylOpen(12), M.tankBand, tBand));
  // Berm around the south tank farm with a divider between the two rows.
  for (const [cx, cz, lx, lz] of [[-80, 285, 608, 8], [-80, 515, 608, 8], [-384, 400, 8, 230], [224, 400, 8, 230], [-80, 390, 600, 8]]) {
    L.earth.push(new THREE.BoxGeometry(lx, 2.5 + BURY, lz).translate(cx, (2.5 - BURY) / 2, cz));
  }

  // ---- Columns: [x, z, radius, height] -------------------------------------------------
  const columns = [[-200, -120, 3.8, 96], [-200, -70, 3.2, 78], [-200, -20, 2.6, 60], [-130, -120, 3.0, 70], [-130, -70, 2.6, 56], [-130, -20, 2.2, 46],
    [-60, -100, 3.4, 84], [-60, -50, 2.8, 62], [-60, 0, 2.4, 48], [10, -100, 2.6, 56], [10, -50, 2.2, 44], [80, -80, 2.8, 66], [80, -30, 2.4, 50], [-150, 60, 2.4, 42], [-80, 60, 2.0, 38]];
  const cBody = [], cCap = [], cPlat = [];
  for (const [x, z, r, h] of columns) {
    const y = gy(x, z);
    cBody.push({ x, y: y - BURY, z, sx: r, sy: h + BURY, sz: r });
    cCap.push({ x, y: y + h, z, sx: r, sy: r * 0.45, sz: r });
    if (h >= 60) for (let i = 0; i < 2; i++) cPlat.push({ x, y: y + h * (0.4 + 0.3 * i), z, ry: i % 2 ? Math.PI / 4 : 0, sx: r * 2.7, sy: 0.5, sz: r * 2.7 });
  }
  g.add(instanced(uCylOpen(12), M.column, cBody), instanced(uCone(12), M.column, cCap), instanced(uBox(), M.steel, cPlat));

  // ---- Stacks --------------------------------------------------------------------------
  const stack = (x, z, h, rb, rt, banded) => {
    const y = gy(x, z);
    if (!banded) L.steel.push(new THREE.CylinderGeometry(rt, rb, h + BURY, 12, 1, true).translate(x, y + (h - BURY) / 2, z));
    else {
      const n = 8, seg = h / n;
      for (let i = 0; i < n; i++) {
        const y0 = i * seg, y1 = y0 + seg, r0 = rb + (rt - rb) * (y0 / h), r1 = rb + (rt - rb) * (y1 / h), ext = i === 0 ? BURY : 0;
        (i % 2 ? L.red : L.white).push(new THREE.CylinderGeometry(r1, r0, seg + ext, 12, 1, true).translate(x, y + (y0 + y1) / 2 - ext / 2, z));
      }
    }
    L.dark.push(new THREE.CylinderGeometry(rt * 1.25, rt * 1.25, 2.2, 12).translate(x, y + h, z));
  };
  stack(-260, -170, 100, 3.6, 2.4, true);
  stack(-100, -170, 85, 3.0, 2.0, false);
  stack(40, -150, 72, 2.8, 1.9, false);
  stack(150, -60, 65, 2.5, 1.8, false);
  stack(-20, 120, 60, 2.4, 1.7, false);

  // ---- Flare ---------------------------------------------------------------------------
  {
    const x = 170, z = 120, h = 95, y = gy(x, z);
    L.lattice.push(new THREE.CylinderGeometry(1.5, 5, h + BURY, 4, 9, true).rotateY(Math.PI / 4).translate(x, y + (h - BURY) / 2, z));
    L.steel.push(new THREE.CylinderGeometry(0.9, 0.9, h + BURY + 1, 6, 1, true).translate(x, y + (h - BURY + 1) / 2, z));
    for (const [ax, az] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const leg = new THREE.CylinderGeometry(0.35, 0.5, h + BURY, 4, 1, true).translate(0, (h + BURY) / 2, 0);
      const dxl = ax * (1.05 - 3.5), dzl = az * (1.05 - 3.5), tilt = Math.atan2(Math.hypot(dxl, dzl), h + BURY), ang = Math.atan2(dxl, dzl);
      leg.rotateX(tilt * Math.cos(ang)).rotateZ(-tilt * Math.sin(ang)).translate(x + ax * 3.5, y - BURY, z + az * 3.5);
      L.steel.push(leg);
    }
    L.dark.push(new THREE.CylinderGeometry(1.7, 1.4, 4, 8).translate(x, y + h + 1, z));
    L.flame.push(new THREE.ConeGeometry(2.8, 11, 8, 1, true).translate(x, y + h + 8.5, z));
    L.flameHaze.push(new THREE.ConeGeometry(4, 15, 8, 1, true).translate(x + 0.8, y + h + 10, z));
    for (const [k, r, dy] of [[0, 6, 18], [1, 9.5, 29], [2, 13, 43]]) L.plume.push(new THREE.SphereGeometry(1, 8, 6).scale(r * 1.3, r, r).translate(x + 4 + 8 * k, y + h + dy, z - 2 - 3 * k));
  }

  // ---- Cooling tower, furnaces, buildings ---------------------------------------------
  {
    const x = -300, z = 20, len = 90, wid = 18, h = 14;
    block(L.heater, x, z, wid, len, h);
    block(L.dark, x, z, wid + 3, len + 3, 1.2);
    for (let i = 0; i < 5; i++) {
      const fz = z - len / 2 + len / 10 + (len / 5) * i, y = gy(x, fz) + h;
      L.dark.push(new THREE.CylinderGeometry(4.2, 4.2, 2.4, 8, 1, true).translate(x, y + 1.2, fz));
      L.plume.push(new THREE.SphereGeometry(1, 6, 4).scale(5.5, 4, 5.5).translate(x + 3, y + 8, fz));
    }
  }
  for (const [x, z, w, d, h] of [[-240, -60, 14, 10, 18], [-30, -150, 14, 10, 18]]) block(L.heater, x, z, w, d, h);
  for (const [x, z, w, d, h] of [[-280, -100, 30, 16, 9], [-20, 60, 40, 20, 10], [120, 20, 28, 16, 8], [120, 55, 16, 16, 8], [120, 151, 22, 22, 8], [-230, 120, 24, 14, 7], [-300, -180, 20, 12, 6]]) {
    block(L.building, x, z, w, d, h);
    block(L.dark, x + w * 0.2, z - d * 0.15, Math.min(6, w * 0.3), Math.min(4, d * 0.3), h + 1.6);
  }

  // ---- Pipe racks ----------------------------------------------------------------------
  const frameGeo = (() => {
    const H = 8.6 + BURY, parts = [];
    for (const s of [-1.4, 1.4]) parts.push(new THREE.BoxGeometry(0.45, H, 0.45).translate(0, H / 2, s));
    parts.push(new THREE.BoxGeometry(0.45, 0.45, 3.3).translate(0, 6.0 + BURY, 0));
    parts.push(new THREE.BoxGeometry(0.45, 0.45, 3.3).translate(0, 8.4 + BURY, 0));
    return mergeGeometries(parts, false);
  })();
  const frames = [];
  const rack = (x0, z0, x1, z1) => {
    boxAlong(L.steel, x0, z0, x1, z1, 3.0, 0.4, 6.4);
    boxAlong(L.steel, x0, z0, x1, z1, 2.2, 0.35, 8.8);
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), n = Math.max(2, Math.round(len / 50)), yaw = Math.atan2(-dz, dx);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; frames.push({ x: x0 + dx * t, y: -BURY, z: z0 + dz * t, ry: yaw }); }
  };
  rack(-300, -130, 150, -130);
  rack(-100, -180, -100, 160);
  g.add(instanced(frameGeo, M.steel, frames));

  for (const [k, list] of Object.entries(L)) { const m = merged(list, M[k]); if (m) g.add(m); }
  return g;
}
