import * as THREE from 'three';
import { Parts, walls, cap, box, offsetPlan, tileTexture, deckMaterials, parkingDeck, lowestGround, clearOfRoute } from './_kit.js';

// Southgate Centre (1970, rebuilt 2011) at 111 St and 51 Ave: a big mall of beige precast and
// metal panels with taller anchor stores at its north and south ends, three-storey parking
// decks along its west side and a two-storey deck along its east side. From 111 St and the
// LRT station the sign everyone knows stands over the west entrance: big dark SOUTHGATE
// letters on a white wall of vertical metal panels. Outline from the City rooflines (17.5 m),
// parking decks from OpenStreetMap; the anchors' heights are estimated from the aerial and the
// entrance block from photos. Origin = the Nominatim point of the mall.
export const sink = 0;

// The mall itself (the rooflines outline east of the west parking decks).
const MALL = [[5, -106.6], [5.6, -108.1], [18.6, -108.1], [18.6, -146.5], [16.8, -146.5], [18.5, -173.3], [66.9, -173.3], [66.9, -175.2], [79.2, -175.2], [79.2, -173.3], [117.3, -173.3], [117.4, -137.1], [113.8, -137.1], [113.8, -108.1], [122.5, -108.1], [122.6, -33], [116.7, -33], [117.1, -28.5], [120.4, -28.5], [120.4, -14.9], [116.7, -14.1], [116.8, 35.2], [107.1, 35.2], [107.1, 58.9], [116.8, 58.9], [116.8, 83.9], [120.4, 84.9], [120.4, 98.6], [117.2, 98.6], [116.8, 102.8], [122.7, 102.8], [122.8, 178], [7.5, 178], [5, 176]];
const NORTH_ANCHOR = [[18.6, -108.1], [18.6, -146.5], [16.8, -146.5], [18.5, -173.3], [117.3, -173.3], [117.4, -137.1], [113.8, -137.1], [113.8, -108.1]];
const SOUTH_ANCHOR = [[22, 104], [116.8, 104], [116.8, 176], [22, 176]];
// Parking decks: west (two, 3 storeys) and east (2 storeys).
const DECKS = [
  { decks: 3, plan: [[-116.6, 174.1], [-64, 175], [-64, 169], [-59.3, 169], [-60.7, 58], [-65.8, 58], [-65.8, 8], [-60.7, 8.1], [-60.7, -101.9], [-64.6, -102], [-64.7, -106.8], [-116.4, -107]] },
  { decks: 3, plan: [[-51, 176], [5, 176], [5, -106.6], [-23.4, -104.9], [-23.4, -108.4], [-42.4, -108.4], [-42.4, -100.7], [-58.5, -100.8], [-58.5, 168.8], [-51, 168.8]] },
  { decks: 2, plan: [[131.6, 180.1], [131.5, -97.4], [187.3, -96.9], [187.8, 170.9], [184.9, 170.5], [184.9, 178.4]] },
];
// The west entrance block, rising through the west deck where the LRT pedway lands.
const ENTRANCE = { x0: -119, x1: -64, z0: 22, z1: 58 };

export function build(ctx) {
  const P = new Parts();
  const panelTex = tileTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#cdbfa7'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#b9ab93'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h);
    g.fillStyle = '#ddd2bf'; g.fillRect(0, 10, w, 3);
  });
  const finTex = tileTexture(64, 64, (g, w, h) => { // white vertical metal panels
    for (let x = 0; x < w; x += 8) { g.fillStyle = (x / 8) % 2 ? '#f1f2f2' : '#dcdfe1'; g.fillRect(x, 0, 8, h); }
  });
  const M = {
    panel: new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.85 }),
    fins: new THREE.MeshStandardMaterial({ map: finTex, roughness: 0.4, metalness: 0.2 }),
    cream: ctx.mat(0xe2d9c6),
    roof: ctx.mat(0xa29d95),
    roofDark: ctx.mat(0x5f5a55),
    glass: ctx.mat(0x557685, 'glossy'),
    letters: ctx.mat(0x2b2e33, 'glossy'),
  };
  const D = deckMaterials(ctx);
  const g0 = Math.min(0, lowestGround(ctx, MALL, 0));

  // ---- the mall: glazed ground floor at the entrances, beige panels, flat roofs ----
  P.add(M.panel, walls(MALL, g0 - 1.5, 10.5, [12, 6]));
  P.add(M.cream, walls(offsetPlan(MALL, 0.2), 10.5, 11.5), cap(offsetPlan(MALL, 0.2), 11.5));
  for (const [plan, top, roof] of [[NORTH_ANCHOR, 15.5, M.roofDark], [SOUTH_ANCHOR, 15, M.roof]]) {
    P.add(M.panel, walls(plan, 11, top - 1, [12, 6]));
    P.add(M.cream, walls(offsetPlan(plan, 0.2), top - 1, top));
    P.add(roof, cap(offsetPlan(plan, 0.2), top));
  }
  // Raised skylit centre court (the 17.5 m top of the rooflines).
  P.add(M.glass, walls([[40, -60], [95, -60], [95, 40], [40, 40]], 11.5, 16));
  P.add(M.cream, walls([[39.7, -60.3], [95.3, -60.3], [95.3, 40.3], [39.7, 40.3]], 16, 17.5), cap([[39.7, -60.3], [95.3, -60.3], [95.3, 40.3], [39.7, 40.3]], 17.5));

  // ---- parking decks ----
  for (const { decks, plan } of DECKS) {
    const p = offsetPlan(plan, -0.5).filter(([x, z]) => clearOfRoute(ctx, x, z, 2));
    if (p.length >= 3) parkingDeck(P, D, p, decks, lowestGround(ctx, p, 0), lowestGround(ctx, p, 0) - 1.5);
  }

  // ---- the west entrance: glass doors under a white fin wall with SOUTHGATE on top ----
  {
    const { x0, x1, z0, z1 } = ENTRANCE, plan = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    P.add(M.glass, walls(offsetPlan(plan, -0.6), g0 - 1, 5));
    P.add(M.fins, walls(plan, 5, 13, [4, 8]));
    P.add(M.cream, walls(offsetPlan(plan, 0.2), 13, 13.6), cap(offsetPlan(plan, 0.2), 13.6));
    // Canopy over the doors on the west face.
    P.add(M.cream, box(x0 - 4, x0, 4.6, 5.2, z0 + 6, z1 - 6));
    // Big letters standing on the parapet of the west face (and a smaller set facing north).
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = '#2b2e33';
    g.font = 'bold 150px Helvetica, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText('SOUTHGATE').width;
    g.save(); g.translate(512, 86); g.scale(Math.min(1, 1000 / tw), 1); g.fillText('SOUTHGATE', 0, 0); g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const lm = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, roughness: 0.4 });
    P.add(lm, new THREE.PlaneGeometry(36, 5.6).rotateY(-Math.PI / 2).translate(x0 - 0.4, 16.4, (z0 + z1) / 2));
    P.add(lm, new THREE.PlaneGeometry(30, 4.7).rotateY(Math.PI).translate((x0 + x1) / 2 + 0.5, 15.9, z0 - 0.3));
  }
  return P.group();
}
