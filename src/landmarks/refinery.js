import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Imperial Oil Strathcona Refinery ("Refinery Row"). Origin = the OSM site centroid; the
// site covers x -790..846 (east) and z -407..936 (south) and Baseline Rd runs along z ≈ 959.
// Storage tanks sit where OpenStreetMap maps them (the SW and centre-south farms and the
// small tanks north of centre); the rest is laid out to read well from the road: the
// process forest in the south-west, tank farms either side, flares and stacks behind.
//
// The ground rises ~10 m/km to the south-east and falls into the river valley to the north,
// while the game pins the model to the terrain at the origin only. So every base follows
// this least-squares plane through the NRCan terrain over the site (rms 2.2 m) and is
// carried BURY metres below it so bumps never show a floating footing.
// In the game, ctx.ground gives the real terrain, which replaces the plane for heights (long
// pieces are split into short runs so each follows it); the plane still sets their tilt.
const C0 = 5.0, A = 0.00544, B = 0.00968;
let terrain = null;
const gy = (x, z) => terrain?.(x, z) ?? C0 + A * x + B * z;
const PIECE = 50; // max length of one ground-following piece (m)
const pieces = (len) => (terrain ? Math.max(1, Math.ceil(len / PIECE)) : 1);
const BURY = 6;
const N = new THREE.Vector3(-A, 1, -B).normalize(); // ground normal

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

// Frame lying on the ground plane at (cx, cz), x axis along (dx, dz), y axis = ground normal.
function groundFrame(cx, cz, dx, dz, yOff = 0) {
  const u = new THREE.Vector3(dx, A * dx + B * dz, dz).normalize();
  const w = new THREE.Vector3().crossVectors(u, N).normalize();
  return new THREE.Matrix4().makeBasis(u, N, w).setPosition(cx, gy(cx, cz) + yOff, cz);
}
// Box lenX × lenZ (ground-aligned) whose top face is `top` metres above the ground plane.
function groundBox(list, cx, cz, lenX, lenZ, h, top) {
  const nx = pieces(lenX), nz = pieces(lenZ), wx = lenX / nx, wz = lenZ / nz;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = cx - lenX / 2 + (i + 0.5) * wx, z = cz - lenZ / 2 + (j + 0.5) * wz;
      list.push(new THREE.BoxGeometry(wx, h, wz).translate(0, -h / 2, 0).applyMatrix4(groundFrame(x, z, 1, 0, top)));
    }
  }
}
// Box of width w and height h from (x0,z0) to (x1,z1) following the ground, top at `top`.
function alongGround(list, x0, z0, x1, z1, w, h, top) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), n = pieces(L);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    list.push(new THREE.BoxGeometry(L / n, h, w).translate(0, -h / 2, 0).applyMatrix4(groundFrame(x0 + dx * t, z0 + dz * t, dx, dz, top)));
  }
}
// Horizontal pipe of radius r from (x0,z0) to (x1,z1) at height y above ground, offset sideways.
function pipeAlong(list, x0, z0, x1, z1, r, y, side = 0) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), n = pieces(L);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const g = new THREE.CylinderGeometry(r, r, L / n, 6, 1, true).rotateZ(Math.PI / 2).translate(0, 0, side);
    list.push(g.applyMatrix4(groundFrame(x0 + dx * t, z0 + dz * t, dx, dz, y)));
  }
}
// Vertical box footprint w × d at (x, z), height h above ground, optional yaw.
function block(list, x, z, w, d, h, yaw = 0) {
  const g = new THREE.BoxGeometry(w, h + BURY, d).translate(0, (h + BURY) / 2 - BURY, 0);
  if (yaw) g.rotateY(yaw);
  list.push(g.translate(x, gy(x, z), z));
}
function instanced(geo, mat, items) {
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    if (it.m) { im.setMatrixAt(i, it.m); return; }
    _p.set(it.x, it.y, it.z);
    _q.setFromEuler(_e.set(it.rx || 0, it.ry || 0, it.rz || 0));
    _s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    im.setMatrixAt(i, _m.compose(_p, _q, _s));
  });
  return im;
}
const merged = (list, mat) => (list.length ? new THREE.Mesh(mergeGeometries(list, false), mat) : null);

// Unit geometries (radius 1, base at y = 0, top at y = 1) scaled per instance.
const uCylOpen = (seg) => new THREE.CylinderGeometry(1, 1, 1, seg, 1, true).translate(0, 0.5, 0);
const uDisc = (seg) => new THREE.CircleGeometry(1, seg).rotateX(-Math.PI / 2);
const uBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const uCone = (seg) => new THREE.ConeGeometry(1, 1, seg, 1, true).translate(0, 0.5, 0);

export function build(ctx) {
  terrain = ctx.ground && ctx.ground(0, 0) != null ? ctx.ground : null;
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
    gravel: ctx.mat(0x9b9890, 'matte'),
    flame: ctx.mat(0xff8a2a, 'glow'),
    flameHaze: ctx.mat(0xffb060, 'glow', { transparent: true, opacity: 0.35, depthWrite: false }),
    plume: ctx.mat(0xf4f4f2, 'matte', { transparent: true, opacity: 0.4, depthWrite: false }),
    fence: ctx.mat(0xc9ccce, 'matte', { transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
    lattice: ctx.mat(0x8c8f91, 'matte', { wireframe: true }),
    sphere: ctx.mat(0xe8e8e6, 'glossy'),
  };
  // Static geometry lists, one per material.
  const L = { white: [], steel: [], dark: [], building: [], heater: [], red: [], earth: [], gravel: [], flame: [], flameHaze: [], plume: [], fence: [], lattice: [], sphere: [], column: [], tankTop: [] };

  // ---- Storage tanks ------------------------------------------------------------------
  // [x, z, diameter, height]; the first groups are OpenStreetMap footprints.
  const tanks = [
    // SW tank farm (mapped + filled in)
    [-628, 551, 37, 15], [-708, 552, 37, 15], [-707, 639, 67, 18], [-626, 700, 67, 18],
    [-707, 760, 60, 18], [-630, 820, 60, 18], [-722, 862, 50, 16], [-545, 600, 37, 15],
    [-545, 520, 37, 15], [-760, 480, 37, 15], [-540, 700, 45, 16], [-540, 790, 45, 16],
    // centre-south farm (mapped + 2)
    [227, 542, 60, 18], [215, 654, 46, 16], [92, 678, 46, 16], [245, 725, 61, 18], [120, 580, 46, 16], [330, 640, 46, 16],
    // mapped tanks north of centre
    [400, -33, 37, 14], [316, -6, 37, 14], [426, 36, 37, 14], [-152, 66, 55, 16], [50, 183, 35, 14],
    [432, 179, 37, 14], [639, 217, 37, 14], [439, 280, 37, 14], [221, 291, 37, 14], [296, 291, 37, 14], [646, 283, 37, 14],
    // SE tank farm
    [490, 390, 60, 18], [590, 390, 60, 18], [690, 390, 60, 18], [490, 490, 60, 18], [590, 490, 60, 18], [690, 490, 60, 18],
    [490, 590, 60, 18], [590, 590, 60, 18], [490, 690, 60, 18], [590, 690, 60, 18], [490, 790, 60, 18], [590, 790, 60, 18],
  ];
  const tBody = [], tTop = [], tBand = [], tStair = [];
  for (const [x, z, dia, h] of tanks) {
    const r = dia / 2, y = gy(x, z);
    tBody.push({ x, y: y - BURY, z, sx: r, sy: h + BURY, sz: r });
    tTop.push({ x, y: y + h + 0.05, z, sx: r * 1.03, sy: 1, sz: r * 1.03 });
    tBand.push({ x, y: y + h - 1.1, z, sx: r * 1.025, sy: 1.15, sz: r * 1.025 });
    // A straight stair ramp standing in for the spiral stair, tangent to the shell.
    const th = ((x * 7 + z * 3) % 360) * Math.PI / 180, len = Math.min(h / Math.sin(0.6), r * 2.2);
    tStair.push({ x: x + (r + 0.7) * Math.cos(th), y: y + h / 2, z: z + (r + 0.7) * Math.sin(th), ry: -th - Math.PI / 2, rz: 0.6, sx: len, sy: 1.1, sz: 1.3 });
  }
  g.add(instanced(uCylOpen(16), M.white, tBody), instanced(uDisc(16), M.tankTop, tTop),
    instanced(uCylOpen(16), M.tankBand, tBand), instanced(new THREE.BoxGeometry(1, 1, 1), M.dark, tStair));

  // Earth berms around the tank farms: [x0, x1, z0, z1] rectangles, 8 m wide, 3 m high.
  const berm = (x0, x1, z0, z1) => {
    groundBox(L.earth, (x0 + x1) / 2, z0, x1 - x0 + 8, 8, 3 + BURY, 3);
    groundBox(L.earth, (x0 + x1) / 2, z1, x1 - x0 + 8, 8, 3 + BURY, 3);
    groundBox(L.earth, x0, (z0 + z1) / 2, 8, z1 - z0, 3 + BURY, 3);
    groundBox(L.earth, x1, (z0 + z1) / 2, 8, z1 - z0, 3 + BURY, 3);
  };
  berm(-786, -494, 444, 900);
  berm(50, 370, 500, 770);
  berm(280, 470, -72, 72);
  berm(190, 680, 148, 322);
  // SE farm: L shape
  groundBox(L.earth, 595, 345, 298, 8, 3 + BURY, 3); // N
  groundBox(L.earth, 740, 442, 8, 195, 3 + BURY, 3); // E upper
  groundBox(L.earth, 690, 540, 108, 8, 3 + BURY, 3); // step
  groundBox(L.earth, 640, 688, 8, 295, 3 + BURY, 3); // E lower
  groundBox(L.earth, 545, 835, 198, 8, 3 + BURY, 3); // S
  groundBox(L.earth, 450, 590, 8, 490, 3 + BURY, 3); // W

  // Gravel pads under the process units (only show where the terrain dips below the plane).
  groundBox(L.gravel, -370, 680, 200, 400, 6, -0.3);
  groundBox(L.gravel, -175, 660, 190, 440, 6, -0.3);
  groundBox(L.gravel, 40, 400, 260, 240, 6, -0.3);
  groundBox(L.gravel, -430, 360, 80, 130, 6, -0.3);

  // ---- Distillation columns ------------------------------------------------------------
  // [x, z, radius, height]
  const columns = [
    // Unit A (crude / vacuum)
    [-400, 600, 4.0, 82], [-400, 650, 3.6, 70], [-400, 700, 3.0, 55], [-330, 610, 3.2, 62], [-330, 660, 2.6, 48], [-330, 720, 2.2, 42],
    // Unit B (conversion)
    [-200, 560, 3.5, 66], [-200, 610, 3.0, 52], [-140, 560, 2.8, 46], [-140, 610, 2.4, 40],
    [-200, 680, 5.5, 34], [-140, 680, 5.0, 30], [-170, 740, 2.6, 58], [-220, 800, 2.4, 44], [-120, 800, 2.0, 38],
    // Unit C
    [-60, 360, 2.8, 48], [-60, 410, 2.4, 40], [-60, 460, 2.2, 36], [0, 360, 3.0, 54], [0, 420, 2.4, 44], [0, 480, 2.0, 36],
    // Unit D
    [100, 330, 2.6, 44], [100, 380, 2.2, 38], [150, 330, 2.0, 36],
  ];
  const cBody = [], cCap = [], cPlat = [], cLadder = [];
  for (const [x, z, r, h] of columns) {
    const y = gy(x, z);
    cBody.push({ x, y: y - BURY, z, sx: r, sy: h + BURY, sz: r });
    cCap.push({ x, y: y + h, z, sx: r, sy: r * 0.45, sz: r });
    const n = h >= 60 ? 3 : h >= 44 ? 2 : 1;
    for (let i = 0; i < n; i++) cPlat.push({ x, y: y + h * (0.35 + 0.28 * i), z, ry: i % 2 ? Math.PI / 4 : 0, sx: r * 2.7, sy: 0.5, sz: r * 2.7 });
    cLadder.push({ x: x + r + 0.5, y: y - 1, z, sx: 0.7, sy: h + 1, sz: 0.7 });
  }
  g.add(instanced(uCylOpen(12), M.column, cBody), instanced(uCone(12), M.column, cCap),
    instanced(uBox(), M.steel, cPlat), instanced(uBox(), M.steel, cLadder));

  // Horizontal drums on saddles: [x, z, radius, length, yaw]
  for (const [x, z, r, len, yaw] of [[-400, 760, 2.2, 14, 0], [-400, 790, 2.0, 12, 0], [-440, 650, 1.8, 16, Math.PI / 2], [30, 505, 1.8, 12, 0], [-30, 505, 1.8, 12, 0], [-240, 640, 2.0, 14, Math.PI / 2], [-90, 640, 1.8, 12, Math.PI / 2]]) {
    const y = gy(x, z);
    L.column.push(new THREE.CylinderGeometry(r, r, len, 8).rotateZ(Math.PI / 2).rotateY(yaw).translate(x, y + 2.5 + r, z));
    block(L.dark, x, z, yaw ? r * 1.6 : len * 0.6, yaw ? len * 0.6 : r * 1.6, 2.5);
  }
  // LPG spheres on a stub support.
  for (const [x, z, r] of [[-30, 790, 9], [-30, 832, 9], [12, 811, 9]]) {
    const y = gy(x, z);
    L.sphere.push(new THREE.SphereGeometry(r, 12, 8).translate(x, y + r + 3, z));
    L.steel.push(new THREE.CylinderGeometry(r * 0.3, r * 0.3, r + 3 + BURY, 8, 1, true).translate(x, y + (r + 3 - BURY) / 2, z));
  }

  // ---- Furnaces, buildings -------------------------------------------------------------
  for (const [x, z, w, d, h] of [[-370, 545, 16, 12, 20], [-322, 545, 16, 12, 20], [-200, 500, 14, 10, 18], [-110, 700, 12, 10, 16]]) block(L.heater, x, z, w, d, h);
  const buildings = [[-440, 840, 30, 14, 9], [-330, 800, 24, 16, 8], [-20, 300, 40, 18, 10], [120, 440, 30, 20, 9], [-470, 760, 18, 40, 7], [300, 420, 24, 14, 7], [-700, 420, 20, 12, 6], [720, 320, 16, 12, 6], [-180, 880, 60, 16, 7], [160, 870, 36, 18, 11]];
  for (const [x, z, w, d, h] of buildings) {
    block(L.building, x, z, w, d, h);
    block(L.dark, x + w * 0.2, z - d * 0.15, Math.min(6, w * 0.3), Math.min(4, d * 0.3), h + 1.6); // rooftop unit
  }
  // Control building by the gate, white.
  block(L.white, -210, 905, 36, 14, 4.5);

  // Cooling tower: long cell block with fan rings and steam.
  {
    const x = -430, z = 360, len = 110, wid = 20, h = 15;
    block(L.heater, x, z, wid, len, h);
    block(L.dark, x, z, wid + 3, len + 3, 1.2); // basin skirt
    for (let i = 0; i < 6; i++) {
      const fz = z - len / 2 + len / 12 + (len / 6) * i, y = gy(x, fz) + h;
      L.dark.push(new THREE.CylinderGeometry(4.5, 4.5, 2.4, 8, 1, true).translate(x, y + 1.2, fz));
      L.plume.push(new THREE.SphereGeometry(1, 6, 4).scale(5.5, 4, 5.5).translate(x + 3, y + 8, fz));
    }
  }

  // ---- Chimney stacks -----------------------------------------------------------------
  const stack = (x, z, h, rb, rt, banded) => {
    const y = gy(x, z);
    if (!banded) { L.steel.push(new THREE.CylinderGeometry(rt, rb, h + BURY, 12, 1, true).translate(x, y + (h - BURY) / 2, z)); }
    else {
      const n = 8, seg = h / n;
      for (let i = 0; i < n; i++) {
        const y0 = i * seg, y1 = y0 + seg, r0 = rb + (rt - rb) * (y0 / h), r1 = rb + (rt - rb) * (y1 / h);
        (i % 2 ? L.red : L.white).push(new THREE.CylinderGeometry(r1, r0, seg + (i === 0 ? BURY : 0), 12, 1, true).translate(x, y + (y0 + y1) / 2 - (i === 0 ? BURY / 2 : 0), z));
      }
    }
    L.dark.push(new THREE.CylinderGeometry(rt * 1.25, rt * 1.25, 2.2, 12).translate(x, y + h, z));
  };
  stack(-345, 505, 90, 3.4, 2.2, true);
  stack(-240, 475, 75, 2.9, 2.0, false);
  stack(-90, 740, 60, 2.4, 1.7, false);

  // ---- Flare stacks (lattice towers, 100 m) --------------------------------------------
  const flare = (x, z, h, wind) => {
    const y = gy(x, z);
    L.lattice.push(new THREE.CylinderGeometry(1.5, 5, h + BURY, 4, 9, true).rotateY(Math.PI / 4).translate(x, y + (h - BURY) / 2, z));
    L.steel.push(new THREE.CylinderGeometry(0.9, 0.9, h + BURY + 1, 6, 1, true).translate(x, y + (h - BURY + 1) / 2, z));
    L.dark.push(new THREE.CylinderGeometry(1.7, 1.4, 4, 8).translate(x, y + h + 1, z));
    // guy-like corner legs read better than wire alone at distance
    for (const [ax, az] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const leg = new THREE.CylinderGeometry(0.35, 0.5, h + BURY, 4, 1, true);
      leg.translate(0, (h + BURY) / 2, 0);
      // lean from base corner (±3.5) to top corner (±1.0)
      const dxl = ax * (1.05 - 3.5), dzl = az * (1.05 - 3.5), tilt = Math.atan2(Math.hypot(dxl, dzl), h + BURY);
      const ang = Math.atan2(dxl, dzl);
      leg.rotateX(tilt * Math.cos(ang)).rotateZ(-tilt * Math.sin(ang));
      leg.translate(x + ax * 3.5, y - BURY, z + az * 3.5);
      L.steel.push(leg);
    }
    L.flame.push(new THREE.ConeGeometry(2.6, 10, 8, 1, true).translate(x, y + h + 3 + 5, z));
    L.flameHaze.push(new THREE.ConeGeometry(3.8, 14, 8, 1, true).translate(x + wind * 0.8, y + h + 2.5 + 7, z));
    for (const [k, r, dy] of [[0, 6, 17], [1, 9, 27], [2, 12.5, 40]]) L.plume.push(new THREE.SphereGeometry(1, 8, 6).scale(r * 1.15, r, r).translate(x + wind * (4 + 7 * k), y + h + dy, z - 2 - 3 * k));
  };
  flare(-470, 230, 100, 1);
  flare(-250, 200, 94, 1);
  flare(350, 120, 86, 1);

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
    alongGround(L.steel, x0, z0, x1, z1, 3.0, 0.4, 6.4);
    alongGround(L.steel, x0, z0, x1, z1, 2.2, 0.35, 8.8);
    for (const side of [-0.9, 0, 0.9]) pipeAlong(L.column, x0, z0, x1, z1, 0.32, 6.75, side);
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), n = Math.max(2, Math.round(len / 36));
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; frames.push({ m: groundFrame(x0 + dx * t, z0 + dz * t, dx, dz, -BURY) }); }
  };
  rack(-470, 470, 160, 470);
  rack(-260, 240, -260, 880);
  rack(-70, 300, -70, 880);
  rack(-470, 885, 60, 885);
  g.add(instanced(frameGeo, M.steel, frames));

  // ---- South edge: berm, chain-link fence, gate ----------------------------------------
  const fz = 925;
  groundBox(L.earth, (-790 + -112) / 2, fz, -112 + 790, 9, 1.4 + BURY, 1.4); // low, so the plant shows over it
  groundBox(L.earth, (-88 + 846) / 2, fz, 846 + 88, 9, 1.4 + BURY, 1.4);
  groundBox(L.fence, (-790 + -112) / 2, fz + 6, -112 + 790, 0.12, 2.4 + BURY, 2.4);
  groundBox(L.fence, (-88 + 846) / 2, fz + 6, 846 + 88, 0.12, 2.4 + BURY, 2.4);
  const posts = [];
  for (let x = -790; x <= 846; x += 40) { if (x > -118 && x < -82) continue; posts.push({ x, y: gy(x, fz + 6) - BURY, z: fz + 6, sx: 0.22, sy: 2.6 + BURY, sz: 0.22 }); }
  g.add(instanced(uBox(), M.dark, posts));
  block(L.dark, -113, fz + 6, 0.8, 0.8, 3.2); block(L.dark, -87, fz + 6, 0.8, 0.8, 3.2); // gate pillars
  block(L.white, -124, 912, 8, 5, 3.5); // guardhouse
  block(L.dark, -100, 912, 26, 7, 0.3); // gate canopy slab... kept low: a paved apron
  // apron through the gap
  groundBox(L.dark, -100, fz, 24, 20, 2, 0.05);

  // ---- Merge the static lists -----------------------------------------------------------
  for (const [k, list] of Object.entries(L)) { const m = merged(list, M[k]); if (m) g.add(m); }
  return g;
}
