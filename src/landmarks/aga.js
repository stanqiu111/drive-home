import * as THREE from 'three';
import { Parts, walls, cap, offsetPlan, box, bar, ribbon, tileTexture, lowestGround } from './_kit.js';

// Art Gallery of Alberta (Randall Stout, 2010), at 99 St and 102A Ave across from Churchill
// Square: a dark slate-clad block with a slate cube cantilevered over 99 St at its north-west
// corner, a glass atrium latticed with diagonal mullions at the south-west corner, and the
// "Borealis": a brushed-steel ribbon that starts as a blade over the entrance, sweeps around
// the atrium and curls up over the roof to 31.5 m, with a rounded steel crown behind it.
// Outline from OpenStreetMap (way 221525672), height from the City rooflines. The ribbon's
// exact curves are drawn by eye from photos. Origin = the Nominatim point of the gallery.
export const sink = 0;

const OUTLINE = [[7.3, -20.4], [7.8, -17.5], [13.6, -18], [14.4, -12.1], [17.9, -12.5], [18.3, -5.3], [25.7, -6], [25.5, -7.5], [29.7, -7.9], [32.9, 21.2], [23.1, 22.2], [23.7, 25.4], [16.4, 26.2], [16.2, 24.6], [-16.3, 28.4], [-23.6, 24.3], [-27.1, 5.5], [-30.9, 5.3], [-30.2, -14.3], [-13.4, -13.6], [-13.2, -18.2]];
// Slate-clad block (everything east of the atrium) and the glass atrium at the south-west.
const BLOCK = [[7.3, -20.4], [7.8, -17.5], [13.6, -18], [14.4, -12.1], [17.9, -12.5], [18.3, -5.3], [25.7, -6], [25.5, -7.5], [29.7, -7.9], [32.9, 21.2], [23.1, 22.2], [23.7, 25.4], [16.4, 26.2], [16.2, 24.6], [8, 25.5], [8, 4], [-6, 4], [-6, -13.7], [-13.4, -13.6], [-13.2, -18.2]];
const ATRIUM = [[-6, 4], [8, 4], [8, 25.5], [-16.3, 28.4], [-23.6, 24.3], [-27.1, 5.5], [-27.1, 4]];
const CUBE = { x0: -34, x1: -5, z0: -17, z1: 4.5, y0: 8, y1: 24 };

export function build(ctx) {
  const P = new Parts();
  // Large blue-grey slate tiles in staggered courses (tile = 6 m x 3 m).
  const slateTex = tileTexture(96, 48, (g, w, h) => {
    const shades = ['#808992', '#848d95', '#7c858d', '#879098'];
    for (let r = 0; r < 2; r++) {
      for (let c = -1; c < 4; c++) {
        g.fillStyle = shades[(r * 3 + c + 8) % 4];
        g.fillRect(c * 32 + (r % 2) * 16, r * 24, 31, 23);
      }
    }
    g.fillStyle = '#6c747b';
    for (let r = 0; r < 2; r++) g.fillRect(0, r * 24 + 23, w, 1);
  });
  const M = {
    slate: new THREE.MeshStandardMaterial({ map: slateTex, roughness: 0.7, metalness: 0.15 }),
    slateFlat: ctx.mat(0x6f7881),
    glass: ctx.mat(0x6e8c9a, 'glossy', { metalness: 0.35, roughness: 0.15 }),
    mullion: ctx.mat(0xe9ebec, 'glossy'),
    steel: ctx.mat(0xd8e0e7, 'glossy', { roughness: 0.25, metalness: 0.3, side: THREE.DoubleSide }),
    steelSolid: ctx.mat(0xd8e0e7, 'glossy', { roughness: 0.25, metalness: 0.3 }),
    roof: ctx.mat(0x7c7d7c),
    dark: ctx.mat(0x2a3036),
    stair: ctx.mat(0xb9b4aa),
  };
  const g0 = Math.min(0, lowestGround(ctx, OUTLINE, 0)) - 1;
  const SLATE_UV = [6, 3];

  // ---- slate block: glass ground floor, slate walls, flat roof ----
  P.add(M.glass, walls(offsetPlan(BLOCK, -0.5), g0, 5));
  P.add(M.slate, walls(BLOCK, 5, 20, SLATE_UV));
  P.add(M.slateFlat, walls(offsetPlan(BLOCK, 0.15), 20, 20.8), cap(offsetPlan(BLOCK, 0.15), 20.8));
  P.add(M.roof, box(12, 24, 20.8, 23, 0, 14));

  // ---- the cube: slate box on a glass base, cantilevered over 99 St, with a square window ----
  {
    const { x0, x1, z0, z1, y0, y1 } = CUBE;
    P.add(M.glass, box(-30.4, x1, g0, y0, -14, z1 - 0.5));
    const cube = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    P.add(M.slate, walls(cube, y0, y1, SLATE_UV), cap(cube, y1));
    P.add(M.slateFlat, cap(cube, y0, true));
    P.add(M.dark, box(x0 - 0.05, x0 + 0.6, y1 - 7.5, y1 - 3, z0 + 4, z0 + 9.5)); // the window cut-out
    for (const x of [-26, -16]) P.add(M.mullion, box(x - 0.2, x + 0.2, g0, y0, z1 - 0.7, z1 - 0.3));
  }

  // ---- glass atrium with a diagonal lattice ----
  {
    const top = 22;
    P.add(M.glass, walls(ATRIUM, g0, top), cap(ATRIUM, top));
    const bars = [];
    for (const i of [2, 3, 4]) { // the south and west fronts (the rest backs onto the block)
      const a = ATRIUM[i], b = ATRIUM[(i + 1) % ATRIUM.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      // Outward normal (the plan runs clockwise seen from above).
      const nx = tz, nz = -tx;
      const V = (s, y) => new THREE.Vector3(a[0] + tx * s + nx * 0.15, y, a[1] + tz * s + nz * 0.15);
      const step = 4.5, slope = 1.25;
      for (let s0 = -top / slope; s0 < len; s0 += step) {
        // Two families of diagonals, clipped to the wall rectangle.
        for (const dir of [1, -1]) {
          let sA = s0, yA = 0, sB = s0 + dir * top / slope, yB = top;
          if (dir < 0) { sA = s0 + top / slope; sB = s0; }
          const clip = (s, y, s2, y2) => {
            // Clip the segment to 0 <= s <= len.
            const k0 = s < 0 ? (0 - s) / (s2 - s) : s > len ? (len - s) / (s2 - s) : 0;
            const k1 = s2 > len ? (len - s) / (s2 - s) : s2 < 0 ? (0 - s) / (s2 - s) : 1;
            if (k0 >= k1) return null;
            return [s + (s2 - s) * k0, y + (y2 - y) * k0, s + (s2 - s) * k1, y + (y2 - y) * k1];
          };
          const c = clip(sA, yA, sB, yB);
          if (c && Math.abs(c[2] - c[0]) > 0.5) bars.push(bar(V(c[0], c[1]), V(c[2], c[3]), 0.25));
        }
      }
      bars.push(bar(V(0, top), V(len, top), 0.4), bar(V(0, 0), V(0, top), 0.35));
    }
    P.add(M.mullion, ...bars);
  }

  // ---- the Borealis ribbon ----
  // Lower band: out of the cube's south face, along the west front over 99 St, ending in a
  // cantilevered point over the entrance at the south-west corner.
  P.add(M.steel, ribbon(
    [[-30, 16.5, -2], [-33, 14, 8], [-34, 12.5, 18], [-31, 12, 28], [-26, 12.5, 36]],
    [[-0.35, 0.94, 0], [-0.4, 0.92, 0], [-0.4, 0.9, 0.15], [-0.3, 0.9, 0.3], [-0.2, 0.85, 0.5]],
    [6, 8, 8.5, 6.5, 1.5], 40));
  // Big swoop: from the corner along the south front, rising and curling back over the roof.
  P.add(M.steel, ribbon(
    [[-22, 14, 31], [-8, 17, 33.5], [6, 21, 31], [15, 26, 22], [12, 30.5, 9], [0, 31, 3], [-12, 28, 8], [-20, 24, 16]],
    [[0, 0.9, 0.4], [0, 0.88, 0.45], [0.15, 0.9, 0.4], [0.5, 0.85, 0.1], [0.4, 0.9, -0.3], [0, 0.9, -0.4], [-0.3, 0.9, -0.2], [-0.4, 0.9, 0.1]],
    [5, 8, 9, 9, 8.5, 8, 7, 5], 56));
  // Rounded steel crown behind the curl (the top of the gallery, 31.5 m).
  const crown = new THREE.SphereGeometry(7.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.25, 0.8).translate(10, 22, 4);
  P.add(M.steelSolid, crown);

  // ---- entrance steps at the corner ----
  for (let k = 0; k < 4; k++) P.add(M.stair, box(-24 + k * 0.3, 8, g0, 0.3 + k * 0.3, 28.5 + (3 - k) * 0.9, 29.4 + (3 - k) * 0.9));
  return P.group();
}
