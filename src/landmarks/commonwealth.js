import * as THREE from 'three';
import { Parts, walls, cap, box, offsetPlan, tris, bar, lowestGround, clearOfRoute } from './_kit.js';

// Commonwealth Stadium (1978), home of the Edmonton Elks, at Stadium Road and 112 Ave: a
// 56,000-seat concrete bowl of green and gold seats. Low curved stands close the north and
// south ends; along the east and west sides an upper deck climbs to about 21 m on tall
// concrete frames, each side under a cantilevered roof with the floodlights along its edge.
// Long concourse buildings (the east and west food courts) line the outside of the side stands
// and a big video board stands at the south end. The bowl is lofted between the stadium's OSM
// outlines (relation 6360585: the outer edge and the edge of the field), the field from the
// OSM pitch, heights from the City rooflines (19.1 m) and photos. The real field is sunk below
// the street; here it sits at street level because the game's ground has no pit.
// Origin = the stadium's OSM centroid; the field's middle is 15 m east of it.
export const sink = 0;

const CX = 15.3, CZ = 2.4; // middle of the field
// Outer edge of the stands and the edge of the field area (OSM, simplified to 1 m).
const OUTER = [[-67.1, -116.5], [-60.7, -109.1], [-39.2, -116.5], [-20.8, -119.3], [3.2, -120.6], [48.4, -120.1], [72.9, -116.2], [96.6, -108.3], [102.9, -114], [112.8, -104.1], [119.1, -95.3], [124.9, -80], [129.6, -59.6], [129.6, 49.5], [126.9, 69.2], [118.9, 90.4], [101, 113.2], [83.8, 104], [45.8, 106.1], [46, 113.6], [-6.9, 113], [-7.1, 108.5], [-28.3, 107.8], [-28.2, 105], [-49.6, 102.9], [-52.2, 101], [-63.2, 106.2], [-67.8, 112], [-73, 108.1], [-79.7, 99.8], [-89.6, 81.3], [-95.5, 61.8], [-96.7, 41.7], [-95.3, -57.4], [-91.2, -77.5], [-86.2, -89.8], [-78.7, -102.7]];
const INNER = [[10.1, -91.9], [-12.3, -83.7], [-26.4, -72], [-35.7, -72.1], [-36.9, 75.3], [-31.2, 85.4], [-16.5, 96.3], [-11.9, 87.6], [9.4, 94.5], [22.9, 94.2], [30.7, 92.1], [33.9, 99.7], [47.8, 99.2], [41.3, 87.9], [53.2, 76.4], [58.3, 67.4], [63.4, 46.2], [61.9, -47.5], [60.3, -59.3], [56, -68.9], [50.2, -76.6], [40.8, -84.1], [31.5, -89.3]];
const PITCH = { x0: -15.2, x1: 45.6, z0: -66.4, z1: 71.2 };
// Concourse buildings outside the side stands (OSM food courts).
const WEST_HALL = [[-129.4, -69.8], [-130.6, 64.4], [-108.7, 65], [-105.8, 77.5], [-92.7, 72.3], [-95.5, 61.8], [-96.7, 41.7], [-95.9, -47.7], [-94, -66.5], [-91.2, -77.5], [-104.9, -82.1], [-108.5, -69.8]];
const EAST_HALL = [[162.7, 66.8], [142.2, 66.8], [138.8, 79.2], [125.1, 75], [129.6, 49.5], [130.5, -49.5], [125.9, -76.4], [140.2, -80.4], [142.9, -67.7], [164.3, -67.7]];

const N = 120; // points around the bowl
const LOW_TOP = 10, UPPER_BASE = 11.5, UPPER_TOP = 19.5, END_TOP = 12.5;

// Where a ray from the field's middle at angle a leaves a polygon (its farthest crossing).
function rayHit(poly, a) {
  const dx = Math.cos(a), dz = Math.sin(a);
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
    const ex = x2 - x1, ez = z2 - z1, den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((x1 - CX) * ez - (z1 - CZ) * ex) / den, u = ((x1 - CX) * dz - (z1 - CZ) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
  }
  return [CX + dx * best, CZ + dz * best];
}

// Quads between two rings (same length, closed, running clockwise seen from above), with
// texture coordinates: u along the ring in metres / uScale, v from 0 (ring A) to vMax (ring B).
// With ring B outside or above ring A the faces point up and in, toward the field; `flip`
// turns them the other way (outer walls).
function band(A, yA, B, yB, uScale, vMax, range = null, flip = false) {
  const pos = [], uv = [];
  const n = A.length, h = (y, i) => (Array.isArray(y) ? y[i] : y);
  let run = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const seg = Math.hypot(A[j][0] - A[i][0], A[j][1] - A[i][1]);
    if (!range || (range(i) && range(j))) {
      const a0 = [A[i][0], h(yA, i), A[i][1]], a1 = [A[j][0], h(yA, j), A[j][1]];
      const b0 = [B[i][0], h(yB, i), B[i][1]], b1 = [B[j][0], h(yB, j), B[j][1]];
      const u0 = run / uScale, u1 = (run + seg) / uScale;
      if (!flip) {
        pos.push(...a0, ...b1, ...b0, ...a0, ...a1, ...b1);
        uv.push(u0, 0, u1, vMax, u0, vMax, u0, 0, u1, 0, u1, vMax);
      } else {
        pos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
        uv.push(u0, 0, u0, vMax, u1, vMax, u0, 0, u1, vMax, u1, 0);
      }
    }
    run += seg;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function build(ctx) {
  const P = new Parts();
  const ground = ctx.ground(CX, CZ) ?? 0;
  const g0 = Math.min(0, lowestGround(ctx, OUTER, 0)) - 1.5;
  const fy = ground + 0.25; // field level

  // Seats in horizontal bands of green and gold (v runs from the front row, 0, to the back, 1),
  // grey aisles between 14 m sections, rows of seats as faint lines.
  const seatTex = (bands) => canvasTex(64, 128, (g, w, h) => {
    let y = h;
    for (const [frac, col] of bands) { const hh = frac * h; g.fillStyle = col; g.fillRect(0, y - hh, w, hh); y -= hh; }
    g.fillStyle = 'rgba(0,0,0,0.2)';
    for (let r = 0; r < h; r += 4) g.fillRect(0, r, w, 1);
    g.fillStyle = '#a3a39b';
    g.fillRect(0, 0, 2, h);
  });
  const GREEN = '#1d6a3c', GOLD = '#d8aa1e';
  const fieldTex = canvasTex(256, 576, (g, w, h) => {
    g.fillStyle = '#3f8f3a'; g.fillRect(0, 0, w, h);
    const yd = h / 150; // 110 yd field + two 20 yd end zones
    g.fillStyle = '#2f6f2e';
    g.fillRect(0, 0, w, 20 * yd); g.fillRect(0, h - 20 * yd, w, 20 * yd);
    g.fillStyle = '#ffffff';
    for (let k = 20; k <= 130; k += 5) g.fillRect(4, k * yd - (k % 10 ? 0.6 : 1.2), w - 8, k % 10 ? 1.2 : 2.4);
    g.fillRect(4, 0, 3, h); g.fillRect(w - 7, 0, 3, h);
    g.fillStyle = '#d8aa1e';
    g.font = 'bold 48px Helvetica, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(w / 2, 10 * yd); g.fillText('ELKS', 0, 0); g.restore();
    g.save(); g.translate(w / 2, h - 10 * yd); g.rotate(Math.PI); g.fillText('ELKS', 0, 0); g.restore();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(w / 2, h / 2, 16, 0, Math.PI * 2); g.fill();
  }, false);
  const M = {
    seatsLow: new THREE.MeshStandardMaterial({ map: seatTex([[0.5, GREEN], [0.5, GOLD]]), roughness: 0.85 }),
    seatsEnd: new THREE.MeshStandardMaterial({ map: seatTex([[0.6, GOLD], [0.4, GREEN]]), roughness: 0.85 }),
    seatsUp: new THREE.MeshStandardMaterial({ map: seatTex([[0.55, GOLD], [0.45, GREEN]]), roughness: 0.85 }),
    field: new THREE.MeshStandardMaterial({ map: fieldTex, roughness: 0.95 }),
    apron: ctx.mat(0x2f6a35),
    concrete: ctx.mat(0xc4beb2),
    concreteDark: ctx.mat(0x9d978b),
    roof: ctx.mat(0xe9eaea, 'glossy'),
    roofUnder: ctx.mat(0x8f9398),
    truss: ctx.mat(0xeceeee, 'glossy'),
    panel: ctx.mat(0x2f6b4f, 'glossy'),
    underside: ctx.mat(0x6b6f70),
    brick: ctx.mat(0x8b4c3b),
    hallGlass: ctx.mat(0x4f6f7a, 'glossy'),
    metal: ctx.mat(0xb9bec2, 'glossy'),
    lamp: ctx.mat(0xfffbe8, 'glow'),
    board: ctx.mat(0x16191c, 'glossy'),
    green: ctx.mat(0x1d6a3c),
  };

  // ---- rings around the bowl ----
  const ang = [];
  for (let k = 0; k < N; k++) ang.push((k / N) * Math.PI * 2);
  const RIN = ang.map((a) => rayHit(INNER, a));
  const ROUT = ang.map((a) => offsetToward(rayHit(OUTER, a), -1.5));
  const lerp = (A, B, f) => A.map((p, i) => [p[0] + (B[i][0] - p[0]) * f, p[1] + (B[i][1] - p[1]) * f]);
  const RMID = lerp(RIN, ROUT, 0.5);
  const RROOF = lerp(RIN, ROUT, 0.76);
  // The side stands (with the upper deck) are where the outer edge runs straight north-south.
  const side = (i) => Math.abs(ROUT[i][1] - CZ) < 78;

  // Field and apron.
  P.add(M.apron, cap(INNER, fy - 0.05));
  const pitch = new THREE.PlaneGeometry(PITCH.x1 - PITCH.x0, PITCH.z1 - PITCH.z0).rotateX(-Math.PI / 2).translate((PITCH.x0 + PITCH.x1) / 2, fy + 0.02, (PITCH.z0 + PITCH.z1) / 2);
  P.add(M.field, pitch);

  // Lower bowl all around, then the low end terraces and the side upper decks.
  P.add(M.seatsLow, band(RIN, fy + 1.2, RMID, LOW_TOP, 14, 1));
  P.add(M.concreteDark, band(RIN, fy - 0.1, RIN, fy + 1.2, 28, 1)); // wall around the field
  P.add(M.seatsEnd, band(RMID, LOW_TOP, ROUT, END_TOP, 14, 1, (i) => !side(i)));
  P.add(M.concrete, band(RMID, LOW_TOP, RMID, UPPER_BASE, 28, 1, side)); // front of the upper deck
  P.add(M.seatsUp, band(RMID, UPPER_BASE, ROUT, UPPER_TOP, 14, 1, side));

  // Outside the ends: a plain concrete wall with frames. Outside the sides: a low green
  // concourse wall, above it the sloping underside of the upper deck on big raking beams, and
  // a parapet at the top row.
  const outerPts = ROUT.map((p) => offsetToward(p, 0.6));
  const RLOW = lerp(RMID, ROUT, 0.42);
  const ends = (i) => !side(i);
  P.add(M.concrete, band(outerPts, g0, outerPts, END_TOP + 1, 28, 1, ends, true));
  P.add(M.concreteDark, band(ROUT, END_TOP + 1, outerPts, END_TOP + 1, 28, 1, ends));
  P.add(M.panel, band(RLOW, g0, RLOW, 7.5, 28, 1, side, true));
  P.add(M.underside, band(RLOW, 7.5, ROUT, UPPER_TOP - 1.2, 28, 1, side, true));
  P.add(M.concrete, band(outerPts, UPPER_TOP - 1.2, outerPts, UPPER_TOP + 1.2, 28, 1, side, true));
  P.add(M.concreteDark, band(ROUT, UPPER_TOP + 1.2, outerPts, UPPER_TOP + 1.2, 28, 1, side));
  // Fill under the side decks between the end walls and the concourse wall (the corners).
  for (let i = 0; i < N; i += 3) {
    const [x, z] = offsetToward(ROUT[i], 1.4);
    const a = Math.atan2(-(z - CZ), x - CX);
    if (side(i)) {
      const [xl, zl] = RLOW[i];
      P.add(M.concrete, bar(new THREE.Vector3(xl, g0, zl), new THREE.Vector3(x, UPPER_TOP - 0.8, z), 1.5));
    } else {
      const h = END_TOP + 1 - g0 + 0.5;
      P.add(M.concreteDark, new THREE.BoxGeometry(2.2, h, 1.2).translate(0, g0 + h / 2, 0).rotateY(a + Math.PI / 2).translate(x, 0, z));
    }
  }

  // ---- roofs over the side upper decks: a thin canopy with floodlights along its front edge
  // and white steel trusses rising over it in a long arch ----
  {
    const sideIdx = [];
    for (let i = 0; i < N; i++) if (side(i)) sideIdx.push(i);
    for (const east of [true, false]) {
      const idx = sideIdx.filter((i) => (ROUT[i][0] > CX) === east);
      if (idx.length < 2) continue;
      idx.sort((a, b) => ROUT[a][1] - ROUT[b][1]);
      const front = idx.map((i) => RROOF[i]), back = idx.map((i) => offsetToward(ROUT[i], 0.8));
      const RF = UPPER_TOP + 2.5, RB = UPPER_TOP + 3.8;
      const pos = [], under = [];
      for (let k = 0; k < idx.length - 1; k++) {
        const f0 = [front[k][0], RF, front[k][1]], f1 = [front[k + 1][0], RF, front[k + 1][1]];
        const b0 = [back[k][0], RB, back[k][1]], b1 = [back[k + 1][0], RB, back[k + 1][1]];
        pos.push(...f0, ...b0, ...b1, ...f0, ...b1, ...f1);
        under.push(...f0, ...b1, ...b0, ...f0, ...f1, ...b1);
      }
      const top = tris(pos), bottom = tris(under);
      if (top.attributes.normal.getY(0) < 0) { P.add(M.roof, bottom); P.add(M.roofUnder, top); } else { P.add(M.roof, top); P.add(M.roofUnder, bottom); }
      for (let k = 0; k < idx.length - 1; k++) {
        const [xa, za] = front[k], [xb, zb] = front[k + 1];
        const len = Math.hypot(xb - xa, zb - za), a = Math.atan2(-(zb - za), xb - xa);
        P.add(M.roof, new THREE.BoxGeometry(len + 0.2, 1.2, 0.4).translate(0, RF, 0).rotateY(a).translate((xa + xb) / 2, 0, (za + zb) / 2));
        P.add(M.lamp, new THREE.BoxGeometry(len * 0.7, 0.6, 0.5).translate(0, RF - 1.0, 0).rotateY(a).translate((xa + xb) / 2, 0, (za + zb) / 2));
      }
      // Trusses: from the front edge up to a mast over the back row; the masts are tallest in
      // the middle of the stand, and a top chord joins their heads.
      const zMid = (ROUT[idx[0]][1] + ROUT[idx[idx.length - 1]][1]) / 2, half = Math.abs(ROUT[idx[idx.length - 1]][1] - zMid) || 1;
      let prev = null;
      for (let k = 0; k < idx.length; k++) {
        const [xf, zf] = front[k], [xbk, zbk] = back[k];
        const f = (zbk - zMid) / half, top = RB + 2.5 + 5 * (1 - f * f);
        const head = new THREE.Vector3(xbk, top, zbk);
        if (k % 2 === 0) P.add(M.truss, bar(new THREE.Vector3(xf, RF + 0.6, zf), head, 0.5), bar(new THREE.Vector3(xbk, RB, zbk), head, 0.6));
        if (prev) P.add(M.truss, bar(prev, head, 0.5));
        prev = head;
      }
    }
  }

  // ---- concourse buildings along the east and west stands ----
  for (const hall of [WEST_HALL, EAST_HALL]) {
    const plan = hall.filter(([x, z]) => clearOfRoute(ctx, x, z, 2));
    if (plan.length < 3) continue;
    P.add(M.brick, walls(plan, g0, 5.5));
    P.add(M.hallGlass, walls(offsetPlan(plan, 0.05), 5.5, 7.5));
    P.add(M.metal, walls(offsetPlan(plan, 0.1), 7.5, 9), cap(offsetPlan(plan, 0.1), 9));
  }

  // ---- video board at the south end, facing the field ----
  {
    const bz = 104, bx = CX + 4;
    P.add(M.concreteDark, box(bx - 12, bx - 10.5, g0, 14, bz - 1, bz + 1), box(bx + 10.5, bx + 12, g0, 14, bz - 1, bz + 1));
    P.add(M.board, box(bx - 16, bx + 16, 14, 26, bz - 0.8, bz + 0.8));
    const scr = canvasTex(256, 96, (g, w, h) => {
      g.fillStyle = '#0f3b23'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d8aa1e';
      g.font = 'bold 44px Helvetica, Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('ELKS 21', w / 2, h * 0.36);
      g.fillStyle = '#ffffff';
      g.font = 'bold 30px Helvetica, Arial, sans-serif';
      g.fillText('VISITORS 17', w / 2, h * 0.76);
    }, false);
    const sm = new THREE.MeshStandardMaterial({ map: scr, emissive: 0xffffff, emissiveMap: scr, emissiveIntensity: 0.6, roughness: 0.6 });
    P.add(sm, new THREE.PlaneGeometry(30, 10.5).rotateY(Math.PI).translate(bx, 20, bz - 0.85));
    P.add(M.green, box(bx - 16, bx + 16, 26, 27.2, bz - 0.9, bz + 0.9));
  }
  return P.group();
}

// Move a point `d` metres away from the field's middle (toward it when negative).
function offsetToward([x, z], d) {
  const dx = x - CX, dz = z - CZ, l = Math.hypot(dx, dz) || 1;
  return [x + (dx / l) * d, z + (dz / l) * d];
}
