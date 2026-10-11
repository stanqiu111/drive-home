import * as THREE from 'three';
import {
  Parts, walls, cap, prism, loft, offsetPlan, resamplePlan, planArea, glass, lowestGround, clearOfRoute, box,
} from './_kit.js';

// Rogers Place (2016), the Oilers' arena between 104 Ave and 105 Ave: an "oil drop" plan, big
// and round to the north, its tail at the south-east reaching over 104 Ave (the Winter Garden)
// to the Ford Hall entrance by the Ice District plaza. A brushed stainless shell of swooping
// bands leans out over a glass concourse; dark glass bands sweep around it; the roof is white.
// Outline from OpenStreetMap (way 448626254), height from the City rooflines (42.9 m). The
// casino and community rink east of it are a lower white box. Origin = the arena's middle.
export const sink = 0;

// Arena body north of 104 Ave (OSM outline, tail cut off at z = 56).
const BODY = [[9.3, 48.8], [-70.2, 47.5], [-76.3, 45.1], [-80.7, 39.6], [-81.6, -21.4], [-78.5, -40.5], [-71.5, -54.2], [-60.8, -66.5], [-37.7, -79.3], [-20.4, -81.9], [32.2, -81.7], [45.8, -80], [64.5, -70.6], [75.4, -56.9], [79.5, -47.9], [82.4, -33.9], [82.2, 22.9], [79.1, 56], [24.4, 56], [14.3, 49.9]];
// The tail: over 104 Ave (the Winter Garden, z 56-84) and on to Ford Hall (z 84-124).
const BRIDGE = [[24.4, 56], [79.1, 56], [77.4, 84], [40.4, 84], [33.9, 67.4], [25.7, 56.8]];
const HALL = [[40.4, 84], [77.4, 84], [76.7, 90], [68.6, 121.8], [65.2, 123.7], [56, 123.3], [49.7, 121.3], [47.1, 118.5], [39.8, 117.3], [40.1, 94.6]];
// Casino and community rink.
const ANNEX = [[82.2, 48.6], [82.4, -33.9], [79.5, -47.9], [75.4, -56.9], [64.5, -70.6], [78.7, -84.8], [141.8, -84.3], [141.3, 50.3]];

const TOP = 39; // top of the shell; the roof rises to 42.9 m
const BASE = 9.5; // the shell starts above the glass concourse

export function build(ctx) {
  const P = new Parts();
  const M = {
    steel: ctx.mat(0xcfdbe7, 'glossy', { roughness: 0.22, metalness: 0.25 }),
    steelDark: ctx.mat(0xa7b4c1, 'glossy', { roughness: 0.3, metalness: 0.25 }),
    band: glass(ctx, 0x2b3a46),
    bronze: ctx.mat(0x80604a, 'glossy', { roughness: 0.4, metalness: 0.2 }),
    concourse: glass(ctx, 0x4d6674),
    roof: ctx.mat(0xeceeed),
    roofGrey: ctx.mat(0xb8bcbf),
    annex: ctx.mat(0xe2e3e1),
    annexGlass: glass(ctx, 0x37505e),
    soffit: ctx.mat(0x5a5048),
    screen: ctx.mat(0x22262b, 'glossy'),
  };
  const g0 = Math.min(0, lowestGround(ctx, BODY, 0)) - 1;

  // ---- the shell, lofted ring by ring around a finely resampled outline ----
  const ring = resamplePlan(BODY, 3);
  const n = ring.length;
  const perim = [0];
  for (let i = 1; i < n; i++) perim.push(perim[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const total = perim[n - 1] + Math.hypot(ring[0][0] - ring[n - 1][0], ring[0][1] - ring[n - 1][1]);
  const t = perim.map((p) => p / total);
  // Swooping dark glass band: low over the south-west corner, high around the north-east.
  const sw0 = t.map((u) => 21 + 8.5 * Math.sin(2 * Math.PI * (u + 0.12)));
  const sw1 = t.map((u, i) => sw0[i] + 4.2 + 1.8 * Math.sin(4 * Math.PI * u + 1));
  const at = (d) => offsetPlan(ring, d);
  const R0 = at(-3.5), R1 = at(0), R2 = at(1.6), R3 = at(2.2), R4 = at(1.4), R5 = at(-1.5), R6 = at(-4);
  // Glass concourse (set back under the shell) and the shell's soffit.
  P.add(M.concourse, loft(R0, g0, R0, BASE - 1.2));
  P.add(M.soffit, loft(R0, BASE - 1.2, R1, BASE));
  // Stainless shell leaning out as it rises, the dark band, then curving in to the roof.
  const lerp = (A, B, k) => A.map((p, i) => [p[0] + (B[i][0] - p[0]) * k, p[1] + (B[i][1] - p[1]) * k]);
  const yAt = (k) => sw0.map((y) => BASE + (y - BASE) * k);
  P.add(M.steel, loft(R1, BASE, lerp(R1, R2, 0.5), yAt(0.5)), loft(lerp(R1, R2, 0.5), yAt(0.5), R2, sw0));
  P.add(M.band, loft(R2, sw0, R2, sw1));
  P.add(M.steel, loft(R2, sw1, R3, sw1.map((y) => (y + TOP - 4) / 2)), loft(R3, sw1.map((y) => (y + TOP - 4) / 2), R4, TOP - 3));
  P.add(M.steelDark, loft(R4, TOP - 3, R5, TOP));
  P.add(M.roof, loft(R5, TOP, R6, TOP + 1.2), cap(R6, TOP + 1.2));
  // Raised middle of the roof (over the bowl) and a grey ring around it.
  const inner = offsetPlan(ring, -14);
  P.add(M.roofGrey, walls(inner, TOP + 1.2, 42.9 - 0.4));
  P.add(M.roof, cap(inner, 42.9 - 0.4));
  // Thin bronze lines along the band's edges, and seams between the shell's swooping panels.
  P.add(M.bronze, loft(at(1.7), sw0.map((y) => y - 0.35), at(1.7), sw0), loft(at(1.7), sw1, at(1.7), sw1.map((y) => y + 0.35)));
  const seam = (ys, d) => P.add(M.steelDark, loft(at(d), ys.map((y) => y - 0.25), at(d), ys.map((y) => y + 0.25)));
  seam(sw0.map((y) => BASE + (y - BASE) * 0.5), 0.9);
  seam(sw1.map((y) => y + (TOP - 3 - y) * 0.45), 2.3);

  // ---- the tail: Winter Garden over 104 Ave (glass, deck 8 m up) and Ford Hall ----
  {
    const deck = 8.5;
    P.add(M.soffit, prism(BRIDGE, deck, deck + 1.2, true));
    P.add(M.concourse, walls(offsetPlan(BRIDGE, -0.5), deck + 1.2, 24));
    P.add(M.steel, walls(BRIDGE, 24, 27.5), cap(BRIDGE, 27.5));
    // Ford Hall: glass base, the bronze-clad drum cantilevered over it with silver edges.
    const hall = resamplePlan(HALL, 3);
    P.add(M.concourse, walls(offsetPlan(hall, -3), lowestGround(ctx, HALL, 0) - 1, deck + 1));
    P.add(M.steel, loft(offsetPlan(hall, -3), deck + 1, hall, deck + 2.2));
    P.add(M.bronze, walls(hall, deck + 2.2, 25));
    P.add(M.steel, walls(offsetPlan(hall, 0.4), 15.5, 16.6), walls(offsetPlan(hall, 0.5), 25, 26.6), cap(offsetPlan(hall, 0.5), 26.6));
    // (No columns: the bridge spans 104 Ave between the arena and Ford Hall.)
  }

  // ---- casino and community rink: white box with a glass band and a screen on 104 Ave ----
  {
    const plan = offsetPlan(ANNEX, -0.8).filter(([x, z]) => clearOfRoute(ctx, x, z, 2));
    if (plan.length >= 3 && planArea(plan) !== 0) {
      const ga = lowestGround(ctx, plan, 0) - 1;
      P.add(M.annexGlass, walls(offsetPlan(plan, -0.3), ga, 6));
      P.add(M.annex, walls(plan, 6, 15), cap(plan, 15));
      P.add(M.annexGlass, walls(offsetPlan(plan, 0.05), 9.5, 11));
      P.add(M.screen, box(96, 128, 7, 14, 50.4, 51.2));
    }
  }

  // ---- red ROGERS PLACE lettering with the ring logo, high on the west and north shell ----
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const g2 = c.getContext('2d');
  g2.fillStyle = '#d3212d';
  g2.strokeStyle = '#d3212d';
  g2.lineWidth = 15;
  g2.beginPath();
  g2.arc(64, 64, 42, 0.35, Math.PI * 2 - 0.35);
  g2.stroke();
  g2.fillRect(64, 56, 46, 16); // the logo's ring opens with a bar into its middle
  g2.font = 'bold 100px Arial, Helvetica, sans-serif';
  g2.textBaseline = 'middle';
  const w = g2.measureText('ROGERS PLACE').width;
  g2.save();
  g2.translate(130, 68);
  g2.scale(Math.min(1, 880 / w), 1);
  g2.fillText('ROGERS PLACE', 0, 0);
  g2.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const signMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
  const sign = (x, z, nx, nz, y, w = 34) => {
    const g = new THREE.PlaneGeometry(w, w / 8).rotateY(Math.atan2(nx, nz)).translate(x, y, z);
    P.add(signMat, g);
  };
  sign(-84.1, -5, -1, 0, 28.5); // west, over 104 St
  sign(-8, -84.1, 0, -1, 30); // north, over 105 Ave
  sign(57, 120.5, -0.15, 0.99, 6.4, 16); // over the Ford Hall doors
  return P.group();
}
