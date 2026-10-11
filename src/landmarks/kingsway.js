import * as THREE from 'three';
import { Parts, walls, cap, box, offsetPlan, tileTexture, deckMaterials, parkingDeck, lowestGround, clearOfRoute } from './_kit.js';

// Kingsway Mall (1976) at 109 St and Princess Elizabeth Ave: a long north-south mall of brown
// brick and beige panels with taller department-store blocks at its north end and in the
// south half, skylights along its spine, a long two-storey parking deck down its east side
// and a tall KINGSWAY pylon sign by the 109 St entrance. Outline from OpenStreetMap (way
// 23238874), the parking deck from the City rooflines; the store heights are estimated from
// the aerial. Origin = the Nominatim point of the mall.
export const sink = 0;

const MALL = [[107.3, 272.8], [107.7, 300.4], [103.3, 306.2], [73.9, 304.6], [56.3, 308.4], [46.6, 304.9], [16.9, 305.3], [12.7, 301.5], [10.4, 278.7], [12.7, 232], [16.3, 227.6], [20.9, 227.5], [21.3, 218.3], [41.9, 218.4], [41.7, 171.3], [30.4, 171.3], [30.4, 183.7], [-63.1, 182.5], [-62.3, 123.4], [-47.4, 124], [-46.7, 109.1], [-38.4, 108.7], [-38.5, 101.8], [-34.6, 101.3], [-34.4, 97.4], [-41.7, 97.8], [-57.3, 82.4], [-59.5, 62.3], [-65.4, 62.3], [-66.2, 17.1], [-59.6, 17.1], [-63.4, 15.6], [-63.3, -18.7], [-58.8, -18.8], [-58.5, -25.4], [-64.3, -25.2], [-67.3, -40.4], [-64, -56.8], [-50.3, -56.9], [-50.5, -70.2], [-53.1, -70.4], [-52.3, -111.1], [-48.2, -111.1], [-48.1, -114.8], [-52.3, -114.6], [-52.3, -124.8], [-37.2, -125], [-37.3, -122.3], [-33.7, -122.1], [-33.7, -127.6], [42.2, -127.6], [42.2, -135.5], [60.5, -135.3], [62.7, -127.2], [62, -57.6], [56, -50.7], [55.9, -44.9], [56, -37.8], [60.8, -32.9], [58.1, -19.4], [63.2, -14.9], [61.5, 62.6], [75.9, 73.6], [73.5, 76.4], [77.8, 77.7], [89.7, 91.8], [93.9, 92.8], [94, 189], [96.9, 191.2], [93.9, 193.2], [93.7, 204.4], [96.9, 207.2], [94, 210.7], [100.1, 212.3], [104.2, 219.7], [100.5, 221.6], [100.3, 227.6], [107.5, 232.2], [107.6, 260.6], [104.8, 262.9]];
// Department-store blocks (aerial): north end, south-west, far south.
const STORES = [
  { plan: [[-48, -125], [60, -125], [60, -62], [-48, -62]], h: 14.5, roof: 0xb7b3ab },
  { plan: [[-60, 120], [40, 120], [40, 182], [-60, 182]], h: 13.5, roof: 0xc9c7c2 },
  { plan: [[14, 228], [106, 228], [106, 303], [14, 303]], h: 13, roof: 0xb2aea6 },
];
const DECK = [[120.3, 309.6], [120.2, 217.4], [108.2, 203.4], [107.2, 92.4], [74.9, 57.8], [73.9, -128.6], [147.9, -128.4], [147.5, 16.6], [133.2, 18.5], [133.6, 54.4], [142.3, 55], [142.2, 68.1], [148, 68.2], [148.2, 182.7], [142.6, 182.7], [143.1, 199.8], [148.3, 199.9], [148.3, 218.8], [170.4, 236.1], [170.2, 307.7]];

export function build(ctx) {
  const P = new Parts();
  const brickTex = tileTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#8a5a44'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7a4d39'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    g.fillStyle = '#d9cdb6'; g.fillRect(0, 0, w, 14); // beige band at the top
  });
  const M = {
    brick: new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.9 }),
    beige: ctx.mat(0xd6cab3),
    roof: ctx.mat(0xa6a199),
    glass: ctx.mat(0x7fa2b2, 'glossy'),
    entry: ctx.mat(0x3f5966, 'glossy'),
    pylon: ctx.mat(0x2d3a52, 'glossy'),
  };
  const D = deckMaterials(ctx);
  const g0 = Math.min(0, lowestGround(ctx, MALL, 0));

  // ---- the mall: brick walls under a beige band, flat roof, skylights along the spine ----
  P.add(M.brick, walls(MALL, g0 - 1.5, 9, [12, 9.5]));
  P.add(M.beige, walls(offsetPlan(MALL, 0.2), 9, 9.8), cap(offsetPlan(MALL, 0.2), 9.8));
  for (const S of STORES) {
    P.add(M.brick, walls(S.plan, 9.5, S.h - 0.8, [12, 9.5]));
    P.add(M.beige, walls(offsetPlan(S.plan, 0.2), S.h - 0.8, S.h));
    P.add(ctx.mat(S.roof), cap(offsetPlan(S.plan, 0.2), S.h));
  }
  for (const [z0, z1] of [[-50, -10], [5, 45], [60, 100], [190, 220]]) {
    P.add(M.glass, box(-3, 7, 9.8, 11.6, z0, z1));
  }

  // ---- the east parking deck (two storeys) ----
  {
    const p = offsetPlan(DECK, -0.5).filter(([x, z]) => clearOfRoute(ctx, x, z, 2));
    if (p.length >= 3) parkingDeck(P, D, p, 2, lowestGround(ctx, p, 0), lowestGround(ctx, p, 0) - 1.5);
  }

  // ---- entrances on the west side (109 St) with KINGSWAY over the doors ----
  const word = (text, w, h) => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 192;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.font = 'bold 150px Georgia, serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText(text).width;
    g.save(); g.translate(512, 100); g.scale(Math.min(1, 980 / tw), 1); g.fillText(text, 0, 0); g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { mat: new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, roughness: 0.5 }), w, h };
  };
  const kw = word('KINGSWAY', 16, 3);
  for (const z of [-2, 145]) {
    const x = z < 0 ? -64.2 : -63.6;
    P.add(M.entry, box(x - 4, x + 0.5, g0 - 1, 6.5, z - 8, z + 8));
    P.add(M.pylon, box(x - 4.6, x + 0.5, 6.5, 11.5, z - 9, z + 9));
    P.add(kw.mat, new THREE.PlaneGeometry(kw.w, kw.h).rotateY(-Math.PI / 2).translate(x - 4.65, 9.0, z));
  }

  // ---- the pylon sign by the 109 St entrance ----
  {
    const px = -150, pz = -10;
    if (clearOfRoute(ctx, px, pz, 3) && !ctx.onRoad(px, pz)) {
      const gp = ctx.ground(px, pz) ?? 0;
      P.add(M.pylon, box(px - 1.2, px + 1.2, gp - 0.5, gp + 18, pz - 3.5, pz + 3.5));
      const vw = word('KINGSWAY', 6.2, 1.2);
      for (const s of [-1, 1]) {
        const g = new THREE.PlaneGeometry(13, 2.4).rotateZ(Math.PI / 2);
        if (s < 0) g.rotateY(Math.PI);
        P.add(vw.mat, g.rotateY(Math.PI / 2).translate(px + s * 1.25, gp + 10.5, pz));
      }
    }
  }
  return P.group();
}
