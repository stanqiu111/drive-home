import * as THREE from 'three';
import { Parts, walls, cap, box, tris, tileTexture, fixOutward, offsetPlan, inside, clearOfRoute, boxUV } from './_kit.js';

// Edmonton Convention Centre (1983) on the river bank below Jasper Ave at 97 St: built into
// the valley wall, most of it buried. From Jasper Ave only a glass entrance pavilion shows;
// from Grierson Hill Road and across the river it is a stack of concrete terraces with dark
// glass bands and trees, a dark glass exhibition hall on top to the east, and its signature:
// a long glazed atrium that steps down the slope like a greenhouse. Plans from OpenStreetMap
// (ways 1288944253, 451264538, 323689443, 323689494), heights from the City rooflines (hall
// roof 671.8 m, atrium top 680.4 m, Jasper Ave about 666.5 m); the atrium's four steps are
// from photos. Every part stands on the game's terrain where it is (the 30 m elevation grid
// smooths the valley wall), so the terraces step with the ground. The building grid is turned
// 30 degrees: u runs along the slope (east-north-east), v down it (south-south-east).
// Origin = the Nominatim point of the centre.
export const sink = 0;

const TH = 30 * Math.PI / 180, CT = Math.cos(TH), ST = Math.sin(TH);
const toXZ = (u, v) => [u * CT + v * ST, -u * ST + v * CT];
const toUV = (x, z) => [x * CT - z * ST, x * ST + z * CT];
// Grierson Hill Road's north edge plus a sidewalk, as v (down the slope) along u.
const ROAD = [[60, 2.5], [39, 9], [26, 13], [-19, 29], [-29, 33], [-80, 52]];
function roadLimit(u) {
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [ua, va] = ROAD[i], [ub, vb] = ROAD[i + 1];
    if (u <= ua && u >= ub) return va + ((vb - va) * (u - ua)) / (ub - ua);
  }
  return u > ROAD[0][0] ? ROAD[0][1] : ROAD[ROAD.length - 1][1];
}
// Pull plan points that reach over the road back to its edge.
const clampToRoad = (plan) => plan.map(([x, z]) => { const [u, v] = toUV(x, z); return v > roadLimit(u) ? toXZ(u, roadLimit(u)) : [x, z]; });

// OSM plans (x east, z south).
const MIDDLE = [[-7.7, -32.9], [7.6, -41.6], [12.3, -33.4], [39.8, -48.5], [47.2, -51.4], [49.9, -47.2], [52.7, -48.7], [56.1, -43.2], [48.1, -38.9], [50.2, -35.1], [42.2, -31], [44.5, -27.1], [28.5, -18.2], [30.4, -14.9], [22.2, -10], [24.4, -6.4], [16.4, -1.8], [18.2, 1.4], [6.7, 7.9], [7.6, 9.4], [-16.3, 23], [-16.9, 21.8], [-21.4, 24.4], [-28.7, 11.6], [-40.6, 18.3], [-42.7, 14.5], [-68.9, 29.4], [-75.2, 17.9], [-39.3, -2.6], [-44.2, -11.2], [-29.3, -19.5], [-14.5, 5], [7.1, -7.1]];
// The low deck along Grierson Hill Road (OSM draws its east end bridging the road; here it
// stops at the sidewalk).
const LOWER = clampToRoad([[48.2, 7.5], [37, -12.2], [40.6, -14.3], [39.5, -16.2], [43.7, -18.6], [42.8, -20.2], [47, -22.6], [44.5, -27.1], [28.5, -18.2], [30.4, -14.9], [22.2, -10], [24.4, -6.4], [16.4, -1.8], [18.2, 1.4], [6.7, 7.9], [7.6, 9.4], [-16.3, 23], [-16.9, 21.8], [-21.4, 24.4], [-28.7, 11.6], [-40.6, 18.3], [-42.7, 14.5], [-68.9, 29.4], [-52.4, 58.4], [-24.3, 42.5], [-26.6, 38.5], [21.4, 11.3], [20.8, 10.2], [34.2, 2.6], [39.7, 12.3]]);
const ATRIUM = { u0: -16, u1: 10, v0: -63.5, v1: -3 };
const HALL = [[68.7, -58], [39.8, -48.5], [12.3, -33.4], [7.6, -41.6], [1.6, -38.2], [-15.6, -67.7], [45.6, -103.1], [48.6, -98.3], [51.7, -100.2], [59, -87.3], [52.1, -83.3], [53.9, -80.6], [57, -83.1]];
const PAVILION = { u0: -20, u1: 14, v0: -72, v1: -58 }; // entrance on Jasper Ave (its curb is at v = -78)

export function build(ctx) {
  const P = new Parts();
  const concreteTex = tileTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#d8d2c4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c9c2b3';
    for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1);
  });
  const hallTex = tileTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#34495a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#4f6678'; for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 1, h);
    g.fillStyle = '#e29aab'; g.fillRect(0, 20, w, 2); g.fillRect(0, 44, w, 2); // pink lines
  });
  // Greenhouse glazing: pale sky-blue panes in a white frame grid (one tile = 3 m x 3 m).
  const paneTex = tileTexture(64, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#b9d6e6'); grd.addColorStop(1, '#94b9cf');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2f4f5'; g.fillRect(0, 0, w, 4); g.fillRect(0, 0, 4, h); g.fillRect(0, 31, w, 2);
  });
  // Terrace fronts: a concrete band over dark glass (one tile = one 4.5 m storey).
  const storeyTex = tileTexture(32, 64, (g, w, h) => {
    g.fillStyle = '#26323b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d6d0c2'; g.fillRect(0, 0, w, 24);
    g.fillStyle = '#c4bdae'; g.fillRect(0, 23, w, 1);
    g.fillStyle = '#3c4c57'; g.fillRect(0, 24, 1, h);
  });
  const M = {
    concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.85 }),
    storey: new THREE.MeshStandardMaterial({ map: storeyTex, roughness: 0.5, metalness: 0.15 }),
    concreteFlat: ctx.mat(0xd3cdbf),
    hall: new THREE.MeshStandardMaterial({ map: hallTex, roughness: 0.3, metalness: 0.1 }),
    white: ctx.mat(0xeceeec),
    glass: new THREE.MeshStandardMaterial({ map: paneTex, roughness: 0.15, metalness: 0.1, emissive: 0x2a3d4a, side: THREE.DoubleSide }),
    frame: ctx.mat(0x6c7f8d, 'glossy'),
    green: ctx.mat(0x4f7a3a),
    leaf: ctx.mat(0x3f6b33),
    canopy: ctx.mat(0x3a3530),
  };
  // Without terrain (the studio) the slope is taken as the real one: Jasper Ave (v = -80)
  // 22 m above Grierson Hill Road (v = +30).
  const fallback = (x, z) => { const v = x * ST + z * CT; return 22 * Math.min(1, Math.max(0, (30 - v) / 110)) - 2; };
  const gAt = (x, z) => ctx.ground(x, z) ?? fallback(x, z);
  const maxG = (plan) => plan.reduce((m, [x, z]) => Math.max(m, gAt(x, z)), -Infinity);
  const minG = (plan) => plan.reduce((m, [x, z]) => Math.min(m, gAt(x, z)), Infinity);
  const rectXZ = ({ u0, u1, v0, v1 }) => [toXZ(u0, v0), toXZ(u1, v0), toXZ(u1, v1), toXZ(u0, v1)];
  const STOREY = [6, 4.5];

  // A terrace: storeys of dark glass under concrete bands, a paved roof with trees on it.
  const trees = [];
  const terrace = (plan, top) => {
    P.add(M.storey, walls(plan, minG(plan) - 1.5, top - 0.6, STOREY));
    P.add(M.concrete, walls(offsetPlan(plan, 0.15), top - 0.6, top + 0.9, [6, 6]));
    P.add(M.concreteFlat, cap(offsetPlan(plan, 0.15), top + 0.9));
    // Trees in planters near the front edge, every ~14 m.
    const inner = offsetPlan(plan, -4);
    for (let i = 0; i < inner.length; i++) {
      const [ax, az] = inner[i], [bx, bz] = inner[(i + 1) % inner.length];
      const n = Math.floor(Math.hypot(bx - ax, bz - az) / 14);
      for (let k = 1; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / (n + 1), z = az + ((bz - az) * k) / (n + 1);
        const [tu, tv] = toUV(x, z);
        if (inside(plan, x, z) && !(tu > ATRIUM.u0 - 8 && tu < ATRIUM.u1 + 8 && tv < ATRIUM.v1 + 10)) trees.push([x, top + 0.9, z]);
      }
    }
  };
  const lower = LOWER.filter(([x, z]) => clearOfRoute(ctx, x, z, 3));
  const topMid = maxG(MIDDLE) + 1.2;
  const topLow = Math.min(maxG(lower) + 1.0, topMid - 4.5);
  terrace(MIDDLE, topMid);
  if (lower.length >= 3) terrace(lower, topLow);

  // ---- the sign on the low deck facing Grierson Hill Road ----
  {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#22272b'; g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#ffffff';
    g.font = 'bold 34px Helvetica, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const text = 'EDMONTON CONVENTION CENTRE', w = g.measureText(text).width;
    g.save(); g.translate(256, 34); g.scale(Math.min(1, 480 / w), 1); g.fillText(text, 0, 0); g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    // On the front edge facing the road, west of the middle.
    const [ax, az] = toXZ(-30, roadLimit(-30) - 0.3), [bx, bz] = toXZ(-60, roadLimit(-60) - 0.3);
    if (clearOfRoute(ctx, (ax + bx) / 2, (az + bz) / 2, 3)) {
      const yaw = Math.atan2(bx - ax, bz - az) - Math.PI / 2; // face away from the building
      const sign = new THREE.PlaneGeometry(20, 2.5).rotateY(yaw).translate((ax + bx) / 2 + 0.25 * Math.cos(yaw + Math.PI / 2), topLow - 1.2, (az + bz) / 2 - 0.25 * Math.sin(yaw + Math.PI / 2));
      P.add(new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }), sign);
    }
  }

  // ---- the exhibition hall: dark glass with pink lines toward the river, white top band ----
  const jasper = maxG(HALL);
  {
    const top = jasper + 5.3;
    P.add(M.hall, walls(HALL, Math.min(minG(HALL), topMid) - 1.5, top - 2.4, [8, 8]));
    P.add(M.white, walls(offsetPlan(HALL, 0.1), top - 2.4, top), cap(offsetPlan(HALL, 0.1), top));
  }

  // ---- the glass atrium: one long gable roof sloping down the hill in four steps ----
  {
    const { u0, u1, v0, v1 } = ATRIUM;
    const steps = 4, len = (v1 - v0) / steps, um = (u0 + u1) / 2;
    const topN = jasper + 15, topS = topMid + 8, RISE = 6; // ridge heights; ridge above the eaves
    const ridgeAt = (v) => topN + ((topS - topN) * (v - v0)) / (v1 - v0);
    const glassG = [], frameG = [], wallG = [];
    for (let k = 0; k < steps; k++) {
      const a = v0 + k * len, b = a + len;
      // Each section's roof slopes with the hill and sits 1.5 m above the next one down.
      const rA = ridgeAt(a) + 0.75, rB = ridgeAt(b) + 0.75;
      const eA = rA - RISE, eB = rB - RISE;
      const plan = rectXZ({ u0, u1, v0: a, v1: b });
      const foot = minG(plan) - 1.5;
      const P3 = (u, v, y) => { const [x, z] = toXZ(u, v); return [x, y, z]; };
      const q = (p1, p2, p3, p4) => [...p1, ...p2, ...p3, ...p1, ...p3, ...p4];
      glassG.push(fixOutward(tris([
        ...q(P3(u0, a, eA), P3(um, a, rA), P3(um, b, rB), P3(u0, b, eB)),
        ...q(P3(um, a, rA), P3(u1, a, eA), P3(u1, b, eB), P3(um, b, rB)),
      ]), () => [0, 1, 0]));
      // The step at the top of the section: a glass riser up to the section above.
      const above = k > 0 ? ridgeAt(a) + 0.75 + 1.5 : rA;
      if (k > 0) {
        const [dx, dz] = toXZ(0, -1);
        glassG.push(fixOutward(tris([
          ...q(P3(u0, a, eA), P3(u0, a, eA + 1.5), P3(um, a, above), P3(um, a, rA)),
          ...q(P3(um, a, rA), P3(um, a, above), P3(u1, a, eA + 1.5), P3(u1, a, eA)),
        ]), () => [dx, 0, dz]));
      }
      // Gable end at the bottom of the lowest section.
      if (k === steps - 1) {
        const [dx, dz] = toXZ(0, 1);
        glassG.push(fixOutward(tris([...P3(u0, b, eB), ...P3(um, b, rB), ...P3(u1, b, eB)]), () => [dx, 0, dz]));
      }
      // Side walls: glass above the terrace roof, concrete below it.
      const sideTop = Math.min(eA, eB);
      glassG.push(walls(plan, Math.max(foot, topMid - 1), sideTop));
      for (const u of [u0, u1]) {
        const [ax, az] = toXZ(u, a), [bx, bz] = toXZ(u, b);
        glassG.push(fixOutward(tris([ax, sideTop, az, bx, sideTop, bz, bx, eB, bz, ax, sideTop, az, bx, eB, bz, ax, eA, az]), () => { const [dx, dz] = toXZ(u === u0 ? -1 : 1, 0); return [dx, 0, dz]; }));
      }
      if (topMid - 1 > foot) wallG.push(walls(plan, foot, topMid - 1));
      // Rafters every ~2.5 m, the ridge and the eaves.
      for (let s = 0; s <= 6; s++) {
        const v = a + ((b - a) * s) / 6, r = rA + ((rB - rA) * s) / 6, e = r - RISE;
        frameG.push(barXYZ(...P3(u0, v, e), ...P3(um, v, r), 0.25), barXYZ(...P3(um, v, r), ...P3(u1, v, e), 0.25));
      }
      frameG.push(barXYZ(...P3(um, a, rA), ...P3(um, b, rB), 0.45), barXYZ(...P3(u0, a, eA), ...P3(u0, b, eB), 0.35), barXYZ(...P3(u1, a, eA), ...P3(u1, b, eB), 0.35));
    }
    P.add(M.glass, ...glassG.map((g) => boxUV(g, 3)));
    P.add(M.frame, ...frameG);
    if (wallG.length) P.add(M.concrete, ...wallG);
  }

  // ---- the entrance pavilion on Jasper Ave: glass walls, hipped glass roof, canopy ----
  {
    const plan = rectXZ(PAVILION), g = maxG(plan), top = g + 9;
    P.add(M.glass, boxUV(walls(plan, minG(plan) - 1, top), 3));
    const { u0, u1, v0, v1 } = PAVILION, du = 6, dv = 3.5;
    const inner = [toXZ(u0 + du, v0 + dv), toXZ(u1 - du, v0 + dv), toXZ(u1 - du, v1 - dv), toXZ(u0 + du, v1 - dv)];
    const pos = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      pos.push(plan[i][0], top, plan[i][1], plan[j][0], top, plan[j][1], inner[j][0], top + 4, inner[j][1], plan[i][0], top, plan[i][1], inner[j][0], top + 4, inner[j][1], inner[i][0], top + 4, inner[i][1]);
    }
    P.add(M.glass, boxUV(fixOutward(tris(pos), () => [0, 1, 0]), 3), boxUV(cap(inner, top + 4), 3));
    P.add(M.frame, walls(offsetPlan(plan, 0.1), top - 0.4, top + 0.2));
    // Canopy over the doors and the sidewalk (not the street), with a dark fascia.
    const cplan = rectXZ({ u0: u0 - 4, u1: u1 + 10, v0: v0 - 4.5, v1: v0 });
    if (cplan.every(([x, z]) => clearOfRoute(ctx, x, z, 1))) {
      P.add(M.canopy, walls(cplan, g + 4.2, g + 5.4), cap(cplan, g + 5.4), cap(cplan, g + 4.2, true));
      for (const u of [u0 - 3, u1 + 9]) { const [x, z] = toXZ(u, v0 - 4); P.add(M.frame, box(x - 0.25, x + 0.25, g - 0.5, g + 4.2, z - 0.25, z + 0.25)); }
    }
  }

  // Low-poly trees on the terraces.
  if (trees.length) {
    const crown = new THREE.IcosahedronGeometry(2.4, 0).translate(0, 4.2, 0);
    const trunk = new THREE.CylinderGeometry(0.25, 0.3, 2.4, 5).translate(0, 1.2, 0);
    const t = (geo, list) => list.map(([x, y, z]) => geo.clone().translate(x, y, z));
    P.add(M.leaf, ...t(crown, trees));
    P.add(M.canopy, ...t(trunk, trees));
  }
  return P.group();
}

function barXYZ(ax, ay, az, bx, by, bz, t) {
  const d = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const g = new THREE.BoxGeometry(t, d.length(), t);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  return g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
}
