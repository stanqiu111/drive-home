import * as THREE from 'three';
import { Parts, walls, cap, offsetPlan, box, bar, tris, lowestGround } from './_kit.js';

// Edmonton City Hall (Gene Dub, 1992) on the north side of Sir Winston Churchill Square: a
// three-storey block of rough beige concrete under two steel-and-glass pyramids (the big one
// 43 m to its peak over the atrium, a smaller one over the council chamber), a south front of
// red granite piers and glass facing the square, and the 60 m Friendship Tower with its green
// diamond clock and open carillon cage. Outline and pyramid plans from OpenStreetMap (way
// 35008768 and its parts); heights from Wikipedia and the City rooflines. The building's grid
// is turned 6 degrees off north. Origin = the Nominatim point of the building.
export const sink = 0;

const BASE = 15; // three storeys
// OSM outline, shifted to the origin (x east, z south).
const OUTLINE = [[28.3, -64.5], [30.6, -38.6], [15.7, -37.2], [18.4, -12.3], [37.2, -14.4], [39.9, 5.2], [36.7, 5.7], [37.2, 9.5], [40.4, 9.2], [40.5, 10.7], [-23.1, 17.6], [-22.8, 20.5], [-20.6, 20.2], [-15.7, 66.3], [-21.8, 66.9], [-21.6, 69.2], [-20.1, 69], [-19.6, 74.2], [-24.8, 74.8], [-25.5, 68.4], [-31.5, 69], [-36, 19.2], [-40.7, 19.7], [-40.8, 18.1], [-32.8, 17], [-33.2, 13.8], [-37.6, 14.3], [-39.8, -5.3], [-21.5, -7.2], [-22.9, -20.5], [-38, -19.1], [-41.9, -56.3], [-24.5, -58.1], [-23.8, -50.3], [-20.5, -50.6], [-21.7, -63.9], [7.3, -67.2], [8.6, -53.5], [11.6, -53.8], [10.8, -62.6]];
// Main block without the long west arm (the arm is lower).
const MAIN = [[28.3, -64.5], [30.6, -38.6], [15.7, -37.2], [18.4, -12.3], [37.2, -14.4], [39.9, 5.2], [36.7, 5.7], [37.2, 9.5], [40.4, 9.2], [40.5, 10.7], [-23.1, 17.6], [-32.8, 17], [-33.2, 13.8], [-37.6, 14.3], [-39.8, -5.3], [-21.5, -7.2], [-22.9, -20.5], [-38, -19.1], [-41.9, -56.3], [-24.5, -58.1], [-23.8, -50.3], [-20.5, -50.6], [-21.7, -63.9], [7.3, -67.2], [8.6, -53.5], [11.6, -53.8], [10.8, -62.6]];
const ARM = [[-20.6, 20.2], [-15.7, 66.3], [-21.8, 66.9], [-21.6, 69.2], [-20.1, 69], [-19.6, 74.2], [-24.8, 74.8], [-25.5, 68.4], [-31.5, 69], [-36, 19.2]];
// Big pyramid base corners (OSM part), small pyramid centre and size, clock tower centre.
const PYR = [[-16.3, 9.5], [-21, -33.7], [13.5, -37.4], [18, 5.9]];
const PYR_TOP = 43;
const SMALL = { x: -6.2, z: -52.3, half: 11.8, top: 30 };
const TOWER = { x: 29.7, z: 32.2, w: 6, h: 50, cage: 10 };
const GRID = 6.2 * Math.PI / 180;

// Glass pyramid over a quadrilateral base (y0) up to an apex, with a diamond lattice of
// mullions: on each face, lines parallel to its two hip edges.
function pyramid(base, y0, apexY, n, glassList, barList, t) {
  const cx = base.reduce((s, p) => s + p[0], 0) / 4, cz = base.reduce((s, p) => s + p[1], 0) / 4;
  const T = new THREE.Vector3(cx, apexY, cz);
  const pos = [];
  for (let i = 0; i < 4; i++) {
    const a = base[i], b = base[(i + 1) % 4];
    const A = new THREE.Vector3(a[0], y0, a[1]), B = new THREE.Vector3(b[0], y0, b[1]);
    pos.push(A.x, A.y, A.z, B.x, B.y, B.z, T.x, T.y, T.z);
    barList.push(bar(A, T, t * 1.6), bar(A, B, t * 1.6));
    for (let k = 1; k < n; k++) {
      const f = k / n;
      const P = A.clone().lerp(B, f);
      const Q = B.clone().multiplyScalar(f).addScaledVector(T, 1 - f); // on B-T, parallel to A-T
      const R = A.clone().multiplyScalar(1 - f).addScaledVector(T, f); // on A-T, parallel to B-T
      barList.push(bar(P, Q, t), bar(P, R, t));
    }
  }
  const g = tris(pos);
  // Faces outward (away from the base centre, upward).
  const nrm = g.attributes.normal;
  if (nrm.getY(0) < 0) {
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const s = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = s; }
    g.computeVertexNormals();
  }
  glassList.push(g);
}

export function build(ctx) {
  const P = new Parts();
  const M = {
    stone: ctx.mat(0xcab69a),
    stoneDark: ctx.mat(0xa8957b),
    granite: ctx.mat(0x8a4232, 'glossy'),
    curtain: ctx.mat(0x557480, 'glossy', { metalness: 0.3, roughness: 0.2 }),
    canopy: ctx.mat(0x3f8a6e, 'glossy'),
    winGreen: ctx.mat(0x4f7d6e, 'glossy'),
    pyramid: ctx.mat(0x97b6cf, 'glossy', { metalness: 0.3, roughness: 0.2 }),
    mullion: ctx.mat(0xe4e7e8, 'glossy'),
    clock: ctx.mat(0x79b39b, 'glossy'),
    hands: ctx.mat(0x1d2124),
    cage: ctx.mat(0xf0f0ee, 'glossy'),
    roof: ctx.mat(0x8f8d88),
  };
  const g0 = Math.min(0, lowestGround(ctx, OUTLINE, 0)) - 1.5;

  // ---- the three-storey block: rough beige concrete, recessed glazed ground floor, a band of
  // green windows under the cornice ----
  P.add(M.curtain, walls(offsetPlan(MAIN, -0.8), g0, 4.2));
  P.add(M.stone, walls(MAIN, 4.2, 9.6), walls(MAIN, 12.2, BASE - 0.8));
  P.add(M.winGreen, walls(offsetPlan(MAIN, -0.25), 9.6, 12.2));
  P.add(M.stoneDark, walls(offsetPlan(MAIN, 0.3), BASE - 0.8, BASE + 0.3), cap(offsetPlan(MAIN, 0.3), BASE + 0.3));
  // Piers along the recessed ground floor, every ~6 m.
  for (let i = 0; i < MAIN.length; i++) {
    const a = MAIN[i], b = MAIN[(i + 1) % MAIN.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 12) continue;
    const n = Math.round(len / 6.5);
    const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    for (let k = 1; k < n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n;
      P.add(M.stone, new THREE.BoxGeometry(1.4, 4.2 - g0, 1.4).translate(0, (4.2 + g0) / 2, 0).rotateY(yaw).translate(x, 0, z));
    }
  }
  // The long west arm: a slightly lower wing with a band of windows, an arcade of stone
  // pillars and a green glass canopy along the square.
  P.add(M.curtain, walls(offsetPlan(ARM, -1.2), g0, 4));
  P.add(M.stone, walls(ARM, 4, 7.5), walls(ARM, 10, 12.5), cap(ARM, 12.5));
  P.add(M.winGreen, walls(offsetPlan(ARM, -0.25), 7.5, 10));
  for (let k = 0; k < 8; k++) {
    const f = (k + 0.5) / 8, x = -20.6 + (-15.7 + 20.6) * f + 1.2, z = 20.2 + (66.3 - 20.2) * f;
    P.add(M.stone, box(x - 0.6, x + 0.6, g0, 4, z - 0.6, z + 0.6));
  }
  P.add(M.canopy, box(-17.5, -13.5, 3.6, 3.9, 21, 66));

  // ---- south front on the square: red granite piers over a glass wall, centred under the
  // pyramid ----
  {
    const a = [-23.1, 17.6], b = [40.5, 10.7];
    const tx = (b[0] - a[0]) / 64, tz = (b[1] - a[1]) / 64, nx = -tz, nz = tx; // outward = south
    const at = (s, out) => [a[0] + tx * s + nx * out, a[1] + tz * s + nz * out];
    const yaw = Math.atan2(nx, nz);
    const [cx, cz] = at(22, 0.6);
    P.add(M.curtain, new THREE.BoxGeometry(31, BASE - 1, 0.4).translate(0, (BASE - 1) / 2, 0).rotateY(yaw).translate(cx, 0, cz));
    for (let k = 0; k <= 5; k++) {
      const [x, z] = at(7 + k * 6, 1.2);
      P.add(M.granite, new THREE.BoxGeometry(1.9, BASE + 0.8 - g0, 1.4).translate(0, (BASE + 0.8 + g0) / 2, 0).rotateY(yaw).translate(x, 0, z));
    }
    const [hx, hz] = at(22, 1.1);
    P.add(M.stoneDark, new THREE.BoxGeometry(33, 1.0, 2.2).translate(0, BASE + 0.3, 0).rotateY(yaw).translate(hx, 0, hz));
  }

  // ---- the pyramids ----
  const glassG = [], bars = [];
  pyramid(PYR, BASE + 0.3, PYR_TOP, 9, glassG, bars, 0.22);
  const s = SMALL, c = Math.cos(GRID), sn = Math.sin(GRID);
  const sq = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [s.x + (u * c + v * sn) * s.half, s.z + (-u * sn + v * c) * s.half]);
  pyramid(sq, BASE + 0.3, s.top, 6, glassG, bars, 0.2);
  P.add(M.pyramid, ...glassG);
  P.add(M.mullion, ...bars);
  // Low rooftop plant housings beside the pyramids.
  P.add(M.roof, box(20, 30, BASE, BASE + 3, -30, -20), box(-34, -26, BASE, BASE + 2.5, -50, -40));

  // ---- Friendship Tower: slender concrete shaft, green diamond clock, open carillon cage ----
  {
    const { x, z, w, h, cage } = TOWER;
    const yaw = GRID;
    const at = (g) => g.rotateY(yaw).translate(x, 0, z);
    P.add(M.stone, at(box(-w / 2, w / 2, g0, h, -w / 2, w / 2)));
    // Vertical grooves on the shaft.
    for (const u of [-1.2, 1.2]) for (const [sx, sz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const gx = sx ? sx * (w / 2 + 0.05) : u, gz = sz ? sz * (w / 2 + 0.05) : u;
      P.add(M.stoneDark, at(box(gx - (sx ? 0.08 : 0.2), gx + (sx ? 0.08 : 0.2), 2, h - 2, gz - (sz ? 0.08 : 0.2), gz + (sz ? 0.08 : 0.2))));
    }
    // Clock faces: a green diamond (square turned 45 degrees) on the south and north faces.
    for (const sgn of [1, -1]) {
      const face = new THREE.PlaneGeometry(4.2, 4.2).rotateZ(Math.PI / 4);
      if (sgn < 0) face.rotateY(Math.PI);
      face.translate(0, 36, sgn * (w / 2 + 0.12));
      P.add(M.clock, at(face));
      P.add(M.hands, at(box(-0.12, 0.12, 36, 37.8, sgn * (w / 2 + 0.2) - 0.05, sgn * (w / 2 + 0.2) + 0.05)), at(box(-1.5, 0, 35.9, 36.1, sgn * (w / 2 + 0.2) - 0.05, sgn * (w / 2 + 0.2) + 0.05)));
    }
    // The cage: corner posts, rings and a grid of openings, with the bells inside.
    const cw = w / 2 + 0.2;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.add(M.cage, at(box(sx * cw - 0.35, sx * cw + 0.35, h, h + cage, sz * cw - 0.35, sz * cw + 0.35)));
    for (let k = 0; k <= 4; k++) {
      const y = h + (cage * k) / 4;
      P.add(M.cage, at(box(-cw, cw, y - 0.2, y + 0.2, -cw, -cw + 0.3)), at(box(-cw, cw, y - 0.2, y + 0.2, cw - 0.3, cw)),
        at(box(-cw, -cw + 0.3, y - 0.2, y + 0.2, -cw, cw)), at(box(cw - 0.3, cw, y - 0.2, y + 0.2, -cw, cw)));
    }
    for (const u of [-cw / 3, cw / 3]) {
      P.add(M.cage, at(box(u - 0.15, u + 0.15, h, h + cage, -cw, -cw + 0.3)), at(box(u - 0.15, u + 0.15, h, h + cage, cw - 0.3, cw)),
        at(box(-cw, -cw + 0.3, h, h + cage, u - 0.15, u + 0.15)), at(box(cw - 0.3, cw, h, h + cage, u - 0.15, u + 0.15)));
    }
    P.add(M.hands, at(box(-1.6, 1.6, h + 2, h + 7, -1.6, 1.6)));
    // Sloped cap (the OSM tower has a skillion roof).
    P.add(M.cage, at(tris([-cw, h + cage, -cw, cw, h + cage, -cw, cw, h + cage + 1.2, cw, -cw, h + cage, -cw, cw, h + cage + 1.2, cw, -cw, h + cage + 1.2, cw])));
  }
  return P.group();
}
