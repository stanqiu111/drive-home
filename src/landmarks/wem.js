import * as THREE from 'three';
import {
  Parts, merge, box, prism, walls, cap, offsetPlan, inside, vault, capsuleVault, stadiumPlan, turnPlan, edges,
  orientedBox, bar, signTexture, tileTexture, glass, lowestGround, clearOfRoute,
} from './_kit.js';

// West Edmonton Mall: a kilometre of low tan mall between 87 Ave, 170 St, 90 Ave and 178 St,
// wrapped in parking decks, with its attractions rising out of the roof: the World Waterpark's
// glass barrel vault (south-west), the Ice Palace's glass dome (middle), Galaxyland's tall
// stadium-shaped hall (north-east), the Deep Sea lake's glass vault, the 12-storey Fantasyland
// Hotel and the green pyramid by the west entrances. Outline from the City of Edmonton
// rooflines (one 185,000 m2 footprint, roof 10.8 m), parking decks from OpenStreetMap, the
// attractions placed from aerial photos. Heights of the tall parts are estimated from photos
// and shadows (Galaxyland hall ~30 m, waterpark vault ~29 m, hotel ~40 m).
// The origin is the middle of the site (OSM landuse centroid); the mall's own grid is turned
// about 4 degrees clockwise from true east-west.
export const sink = 0;

const GRID = -4 * Math.PI / 180;
const BODY = 11.5; // main roof height

// Mall outline (rooflines, simplified to 2 m).
const OUTLINE = [[42.5, -63.6], [54.7, -83.9], [57, -116.1], [106.8, -112.2], [106, -101.4], [123.2, -99.1], [127.3, -103.6], [133.3, -103.1], [137, -99], [138, -115.3], [142.7, -122.5], [152.7, -128.4], [163.5, -127.1], [171.7, -119], [174.6, -108.8], [169.1, -34.1], [164.1, -22.7], [154.6, -16.7], [153.5, -10.7], [163.9, 2.1], [193.2, 4.3], [194.1, -8.4], [199.2, -8], [199.9, -17.4], [219, -16], [219.5, -22.8], [217.1, -23], [221.3, -47.5], [210.9, -48.3], [217.2, -134.8], [229.1, -133.9], [230.3, -149.6], [238.9, -149], [239.4, -155.8], [258.7, -154.4], [258.5, -151.4], [264.6, -150.9], [262.3, -119.9], [265.6, -119.7], [265, -112.5], [309.2, -109.3], [304.2, -41.2], [297.2, -41.7], [296.4, -30.3], [303.7, -25], [297.7, -18.3], [296.9, -5.1], [301.7, 2.2], [298.6, 5.9], [293.6, 5.3], [291, 38.9], [326.7, 40], [335.2, 43.2], [349.6, 41.6], [367, 45.3], [358.6, 148.6], [283.6, 142.1], [281.7, 166.3], [287.6, 170], [288.7, 174.5], [283.2, 178.5], [282.3, 192.6], [287.2, 199.1], [284.4, 203.6], [279, 204.1], [278.2, 215.6], [287, 216.1], [295.1, 225.5], [295.6, 234.8], [289.3, 293.4], [187.4, 286.2], [192.1, 218.2], [201.7, 210], [204.3, 183.7], [131.8, 178], [132.7, 169.4], [126.6, 169.3], [128.7, 140], [124.7, 140.1], [124.7, 132], [104.7, 130.9], [105.1, 125.1], [79.8, 123], [78.4, 135.4], [57.6, 134], [52.1, 127.5], [42.7, 126.6], [41.8, 136], [57.3, 151.4], [57, 156.1], [40.6, 154.1], [40, 191.4], [29.8, 190.7], [30.3, 181.3], [20.9, 180.5], [21.1, 177.8], [-30.3, 174.1], [-28.5, 149.8], [-36.2, 149.5], [-34.4, 125.4], [-37.3, 125.1], [-37.2, 121.7], [-35.1, 116], [-25.8, 116.9], [-25.5, 112.7], [-34.1, 109.6], [-33.7, 102.8], [-108.9, 96.6], [-109.2, 99.9], [-112.5, 99.7], [-118.6, 180.1], [-122.7, 184.4], [-312.1, 170.6], [-316.3, 163.7], [-310.7, 124.2], [-322.6, 130], [-337.5, 128.8], [-340.4, 125.8], [-336.8, 78], [-333.6, 75.5], [-333.7, 56.9], [-335.9, 56.7], [-335.1, 45.7], [-332.5, 44], [-335.6, 43.8], [-339.6, 46.1], [-346.2, 127], [-380, 124.2], [-381.3, 141.9], [-416.2, 139.3], [-414.8, 119.6], [-405.6, 120.2], [-401.4, 86], [-402.2, 76.7], [-404.7, 76.6], [-398.4, 40.7], [-404.8, 40.4], [-405.2, 49.2], [-412.6, 48.9], [-412.9, 32.8], [-410.3, 22.6], [-405, 22.8], [-404.3, 32.2], [-395.4, 31.2], [-392.6, -49.8], [-386.6, -102], [-322.2, -98.2], [-323.1, -85.1], [-260.3, -83.2], [-259.7, -80.1], [-248.2, -79.3], [-247.7, -85.9], [-234.9, -85], [-235.4, -78.1], [-203.4, -75.9], [-199.4, -83.7], [-194.8, -83.3], [-194.5, -88.8], [-184.8, -88.1], [-185.7, -74.4], [-52.8, -64.5], [-52.1, -73.8], [-18.7, -71.3], [-19.4, -61.9], [-28.9, -62.6], [-30.2, -45.5], [-4.1, -46.3], [-4.7, -39], [2.4, -38.4], [9.3, -56], [22.9, -56.8], [18.8, -37.5], [24, -41.6], [27.1, -37.9], [40.7, -49.6], [39.3, -59.1]];

// Parking decks (OSM, simplified): plan and number of decks above the ground.
const DECKS = [
  { decks: 2, plan: [[-418.6, 139.2], [-341.8, 145], [-328.5, 154.3], [-331.8, 195.6], [-346.8, 206], [-470.6, 174.2], [-478.5, 166.4], [-471.8, 80.2], [-463.6, 73], [-458.2, 8], [-449.6, 4.4], [-426, 6.1], [-425, -9.2], [-448.6, -10.7], [-457, -16.3], [-452.9, -72.5], [-460.2, -81.1], [-454.1, -154.7], [-396.3, -150.4], [-398, -122.1], [-383.7, -120.8], [-384, -111.5], [-398.8, -112.6], [-400.9, -78.3], [-389.8, -77.3], [-395.5, -12.4], [-406.3, -13.4]] },
  { decks: 1, plan: [[-382.6, -153.2], [-107.3, -190.7], [-64.5, -186], [-73.8, -82.4], [-78.2, -79.5], [-79, -67.3], [-136.7, -71.4], [-135.8, -83.9], [-195.8, -89], [-196.3, -83.6], [-200.7, -83.9], [-201.1, -79.4], [-204.3, -79.6], [-204.6, -76.6], [-214.4, -77.4], [-213.4, -89.6], [-216.8, -90], [-216.8, -92.3], [-234.8, -93.7], [-235, -91.4], [-278.6, -94.6], [-279.4, -85], [-291.9, -86], [-291.3, -95.4], [-371.7, -101.7], [-370.9, -110.2], [-384, -111.5]] },
  { decks: 3, plan: [[-50.6, -180.5], [136.4, -165.3], [135.1, -146.9], [124.6, -147.6], [123.2, -129.4], [113.4, -130.1], [112, -112.8], [55.6, -116.1], [54.6, -103.8], [36.5, -105.4], [37.4, -118], [-37.2, -123.8], [-38.1, -110.9], [-56.3, -112.2]] },
  { decks: 2, plan: [[322, -100.8], [448.3, -92], [442.4, -19], [409.2, -21.3], [407.6, -2.3], [448.5, 0.9], [438.1, 151.6], [432.3, 156.3], [385.9, 152.7], [384, 182], [442.4, 186.5], [435.7, 295.9], [304, 285.5], [313.8, 158.5], [369.5, 162.8], [379.3, 31.8], [313, 26.5]] },
  { decks: 1, plan: [[-17, 187.5], [54.6, 193], [58.6, 146.6], [110.3, 150.3], [110, 154], [115.5, 154.3], [104, 298.2], [66.3, 295.3], [68.1, 270], [13.3, 265.4], [13.6, 260.5], [-23.4, 257.8]] },
  { decks: 1, plan: [[113.2, 179.3], [174.3, 183.4], [173.9, 189.5], [185, 190.2], [179.3, 267.9], [125.3, 264.3], [122.4, 300.8], [104, 299.5]] },
];
const DECK_H = 3.2;

// Fantasyland Hotel (OSM building part): an L of an east-west slab and a short south wing.
const HOTEL = [[-334.7, 73.1], [-279.1, 77.9], [-277.5, 81.5], [-278.9, 98], [-282.1, 100.4], [-315.8, 98.1], [-318.1, 101.3], [-321.1, 128.3], [-340.1, 127.7], [-342.2, 123.6], [-338.8, 77]];
const HOTEL_TOP = 40;

// Entrances: [x, z] on the outline (snapped to the nearest edge) and the entrance number.
const ENTRANCES = [[-120, -70, 9], [80, -114, 3], [287, -111, 1], [362, 95, 50], [240, 290, 46], [-5, 176, 34], [-220, 178, 58], [-394, -10, 15], [-90, 98, 24]];

export function build(ctx) {
  const P = new Parts();
  const M = {
    wall: ctx.mat(0xbca98c),
    wallDark: ctx.mat(0x8e7862),
    cream: ctx.mat(0xddd3bf),
    roof: ctx.mat(0xa59985),
    deck: ctx.mat(0xc8cacb),
    deckTop: ctx.mat(0x9fa2a3),
    deckDark: ctx.mat(0x404346),
    glassVault: ctx.mat(0xa9c1ca, 'glossy'),
    glassDark: glass(ctx, 0x3d5866),
    frame: ctx.mat(0xe9e7e1, 'glossy'),
    vaultEnd: ctx.mat(0xd9c49d),
    galaxy: ctx.mat(0xc2ab8b),
    hotel: ctx.mat(0xddd2bb),
    hotelWin: glass(ctx, 0x55636e),
    pyramid: ctx.mat(0x5f9e84, 'glossy'),
    pyramidDark: ctx.mat(0x4b8a72, 'glossy'),
    door: glass(ctx, 0x2c3a44),
  };
  // Tan precast panels with darker joints every 3 m (one tile = 12 m x 6 m).
  const panelTex = tileTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#bca98c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#a8957a';
    for (let x = 0; x < w; x += w / 4) g.fillRect(x, 0, 2, h);
    g.fillStyle = '#c9b89c';
    g.fillRect(0, h * 0.62, w, 3);
  });
  M.panel = new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.85 });
  const PANEL_UV = [12, 6];
  const yGround = lowestGround(ctx, OUTLINE.filter((_, i) => i % 6 === 0), 0);
  const foot = Math.min(-2, yGround - 1.5); // walls reach below the lowest ground

  // ---- main mall body: tan walls, darker plinth, cream cornice, flat roof ----
  P.add(M.wallDark, walls(OUTLINE, foot, 1.2));
  P.add(M.panel, walls(OUTLINE, 1.2, BODY - 0.9, PANEL_UV));
  P.add(M.cream, walls(offsetPlan(OUTLINE, 0.25), BODY - 0.9, BODY + 0.4), cap(offsetPlan(OUTLINE, 0.25), BODY + 0.4));
  P.add(M.roof, cap(OUTLINE, BODY + 0.05));

  // Taller anchor stores (aerial photo: darker and lighter roofs).
  const anchor = (plan, h, roofMat = M.roof) => {
    P.add(M.panel, walls(plan, BODY, h - 0.8, PANEL_UV));
    P.add(M.cream, walls(offsetPlan(plan, 0.25), h - 0.8, h + 0.3));
    P.add(roofMat, cap(plan, h + 0.3));
  };
  anchor(turnPlan([[-55, -42], [55, -42], [55, 42], [-55, 42]], GRID, 256, -70), 15.5, ctx.mat(0x6e5a48));
  anchor(turnPlan([[-50, -40], [50, -40], [50, 40], [-50, 40]], GRID, 240, 250), 14, ctx.mat(0xe4e2dc));
  anchor(turnPlan([[-33, -52], [33, -52], [33, 52], [-33, 52]], GRID, 325, 95), 15, ctx.mat(0x5d5248));
  anchor(turnPlan([[-40, -30], [40, -30], [40, 30], [-40, 30]], GRID, -360, -50), 14.5);

  // ---- World Waterpark: glass barrel vault on beige walls, arched end walls ----
  {
    const L = 132, S = 68, R = 17, y0 = 12.5, cx = -216, cz = 142;
    const v = vault(L, S, R, y0, 12);
    const at = (g) => g.rotateY(GRID).translate(cx, 0, cz);
    P.add(M.glassVault, at(v.roof));
    P.add(M.vaultEnd, at(v.ends));
    // Walls under the vault (above the mall roof) and a fascia band following each end arch.
    P.add(M.vaultEnd, at(box(-L / 2, L / 2, BODY, y0, -S / 2, S / 2)));
    const ribs = [];
    for (let i = 0; i <= 11; i++) {
      const x = -L / 2 + (L * i) / 11;
      for (let k = 0; k < v.arc.length - 1; k++) {
        const [z0, ya] = v.arc[k], [z1, yb] = v.arc[k + 1];
        ribs.push(bar(new THREE.Vector3(x, ya + 0.15, z0), new THREE.Vector3(x, yb + 0.15, z1), i === 0 || i === 11 ? 1.6 : 0.5));
      }
    }
    // Purlins along the vault, the crown walkway and the two eave beams.
    for (const k of [2, 4, 8, 10]) {
      const [z, y] = v.arc[k];
      ribs.push(box(-L / 2, L / 2, y + 0.05, y + 0.45, z - 0.25, z + 0.25));
    }
    ribs.push(box(-L / 2, L / 2, y0 + R - 0.1, y0 + R + 0.6, -2.2, 2.2));
    for (const s of [-1, 1]) ribs.push(box(-L / 2, L / 2, y0 - 0.2, y0 + 0.9, s * S / 2 - 0.8, s * S / 2 + 0.8));
    P.add(M.vaultEnd, ...ribs.map(at));
  }

  // ---- Deep Sea lake: long glass capsule vault ----
  {
    const c = capsuleVault(100, 34, 9, BODY, 7);
    P.add(M.glassVault, c.roof.rotateY(GRID).translate(-258, 0, 44.5));
    P.add(M.frame, orientedBox(c.straight + 6, 0.5, 3, -258, BODY + 8.9, 44.5, GRID));
  }

  // ---- Ice Palace: stadium-shaped glass dome on an octagonal plinth, turned 38 degrees ----
  {
    const yaw = 38 * Math.PI / 180, cx = 14, cz = 80;
    const base = turnPlan([[-44, -16], [-36, -24], [36, -24], [44, -16], [44, 16], [36, 24], [-36, 24], [-44, 16]], yaw, cx, cz);
    P.add(M.cream, prism(base, BODY, BODY + 2.2));
    const c = capsuleVault(72, 32, 9, BODY + 2.2, 7);
    P.add(M.glassVault, c.roof.rotateY(yaw).translate(cx, 0, cz));
    P.add(M.frame, orientedBox(c.straight + 4, 0.5, 3.2, cx, BODY + 2.2 + 8.9, cz, yaw));
  }

  // ---- Galaxyland: tall stadium-shaped hall, flat roof with skylights; glass gable beside it ----
  {
    const plan = stadiumPlan(120, 40, 10, 157, -68, Math.PI / 2 + GRID);
    const H = 30;
    P.add(M.galaxy, walls(plan, BODY, H - 1));
    P.add(M.cream, walls(offsetPlan(plan, 0.3), H - 1, H + 0.3), cap(offsetPlan(plan, 0.3), H + 0.3));
    // Vertical ribs on the curved north end (seen from 90 Ave).
    const E = edges(plan);
    for (let i = 0; i < E.length; i += 2) {
      const e = E[i];
      if (e.len > 30) continue; // only the curved ends
      const x = e.a[0] + e.n[0] * 0.35, z = e.a[1] + e.n[1] * 0.35;
      P.add(M.cream, orientedBox(0.9, H - 1 - BODY, 0.7, x, BODY, z, Math.atan2(-e.t[1], e.t[0])));
    }
    const sky = [];
    for (let k = 0; k < 7; k++) sky.push(orientedBox(9, 1.2, 8, 156, H + 0.3, -96 + k * 12, GRID));
    P.add(M.glassDark, ...sky);
    // Glass gable roof over the corridor east of the hall.
    const g = vault(95, 16, 5, BODY + 2, 2);
    P.add(M.glassVault, g.roof.rotateY(Math.PI / 2 + GRID).translate(189, 0, -67));
    P.add(M.vaultEnd, g.ends.rotateY(Math.PI / 2 + GRID).translate(189, 0, -67), orientedBox(16, 2, 95, 189, BODY, -67, GRID));
    // Octagonal stair tower on the west side.
    P.add(M.galaxy, new THREE.CylinderGeometry(7, 7, H - 4 - BODY, 8).translate(131, (H - 4 + BODY) / 2, -85));
    P.add(M.cream, new THREE.CylinderGeometry(7.4, 7.4, 0.8, 8).translate(131, H - 4, -85));
  }

  // ---- corridor skylights: glass barrel vaults along the main malls ----
  for (const [x, z, L, yaw] of [[-276, -50, 70, Math.PI / 2], [-150, 50, 70, 0], [170, 74, 90, 0], [223, 44, 60, Math.PI / 2], [100, -4, 50, 0], [-95, -5, 60, Math.PI / 2]]) {
    const v = vault(L, 9, 3.2, BODY, 6);
    P.add(M.glassVault, v.roof.rotateY(yaw + GRID).translate(x, 0, z));
    P.add(M.vaultEnd, v.ends.rotateY(yaw + GRID).translate(x, 0, z));
  }

  // ---- Fantasyland Hotel: 12 storeys of cream spandrels and window bands, round penthouse ----
  {
    const floors = 9, y0 = BODY + 1, fh = (HOTEL_TOP - 1.2 - y0) / floors;
    P.add(M.hotel, walls(HOTEL, BODY, y0));
    for (let i = 0; i < floors; i++) {
      const y = y0 + i * fh;
      P.add(M.hotelWin, walls(offsetPlan(HOTEL, -0.15), y, y + fh * 0.58));
      P.add(M.hotel, walls(HOTEL, y + fh * 0.58, y + fh));
    }
    P.add(M.hotel, walls(HOTEL, HOTEL_TOP - 1.2, HOTEL_TOP), cap(HOTEL, HOTEL_TOP));
    // Dark vertical stair cores at both ends of the slab.
    P.add(M.wallDark, orientedBox(5, HOTEL_TOP + 1.5 - BODY, 6, -276.5, BODY, 89, GRID), orientedBox(6, HOTEL_TOP + 1.5 - BODY, 5, -331, BODY, 129.5, GRID));
    P.add(M.hotel, new THREE.CylinderGeometry(7, 7, 4, 16).translate(-308, HOTEL_TOP + 2, 88));
    P.add(M.cream, new THREE.CylinderGeometry(7.4, 7.4, 0.6, 16).translate(-308, HOTEL_TOP + 4.2, 88));
  }

  // ---- green pyramid with a glass cap over the west entrance court ----
  {
    const pyr = (B, yb, H, capFrac) => {
      const yTop = yb + H, yc = yb + H * (1 - capFrac), bc = B * capFrac;
      const c = [[-B, -B], [B, -B], [B, B], [-B, B]], k = [[-bc, -bc], [bc, -bc], [bc, bc], [-bc, bc]];
      const face = [], glassFace = [];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        face.push(c[j][0], yb, c[j][1], c[i][0], yb, c[i][1], k[i][0], yc, k[i][1], c[j][0], yb, c[j][1], k[i][0], yc, k[i][1], k[j][0], yc, k[j][1]);
        glassFace.push(k[j][0], yc, k[j][1], k[i][0], yc, k[i][1], 0, yTop, 0);
      }
      const geo = (pos) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; };
      return { body: geo(face), top: geo(glassFace) };
    };
    const big = pyr(17, BODY + 1, 29, 0.17);
    P.add(M.pyramid, big.body.rotateY(GRID).translate(-352, 0, 36));
    P.add(M.glassVault, big.top.rotateY(GRID).translate(-352, 0, 36));
    P.add(M.cream, orientedBox(36, 1.2, 36, -352, BODY, 36, GRID));
    const small = pyr(9, BODY + 1, 13, 0.2);
    P.add(M.pyramidDark, small.body.rotateY(GRID).translate(-326, 0, 33));
    P.add(M.glassVault, small.top.rotateY(GRID).translate(-326, 0, 33));
  }

  // ---- parking decks: concrete parapets over dark open floors with columns, striped top
  // deck with parked cars ----
  const deckTex = tileTexture(64, 32, (g, w, h) => {
    g.fillStyle = '#4b4f53';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c3c5c5';
    g.fillRect(0, h * (1 - 1.15 / DECK_H), w, h); // parapet (texture v runs up from the bottom)
    g.fillRect(0, 0, w * 0.08, h); // column
    g.fillStyle = '#9a9c9d';
    g.fillRect(0, h * (1 - 1.15 / DECK_H) - 2, w, 2);
  });
  M.deckFace = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.9 });
  const lineTex = tileTexture(32, 256, (g, w, h) => {
    g.fillStyle = '#9b9e9f';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8e8e2';
    const m = h / 18; // tile = 2.75 m x 18 m: two rows of stalls back to back across an aisle
    g.fillRect(0, 0, 2, 5.5 * m);
    g.fillRect(0, 12.5 * m, 2, 5.5 * m);
  });
  lineTex.repeat.set(1 / 2.75, 1 / 18);
  M.deckLines = new THREE.MeshStandardMaterial({ map: lineTex, roughness: 0.95 });
  const cars = [];
  let seed = 1983;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const D of DECKS) {
    const plan = offsetPlan(D.plan, -1.0).filter(([x, z]) => clearOfRoute(ctx, x, z, 2));
    if (plan.length < 3) continue;
    const g0 = lowestGround(ctx, plan, 0), top = D.decks * DECK_H;
    P.add(M.deck, walls(plan, g0 - 1, 0));
    P.add(M.deckFace, walls(plan, 0, top, [8, DECK_H]));
    P.add(M.deck, walls(plan, top, top + 1.1), cap(offsetPlan(plan, -0.3), top + 1.1));
    P.add(M.deckLines, cap(offsetPlan(plan, -0.3), top + 0.04));
    // Stair and lift towers at two corners.
    for (const i of [0, Math.floor(plan.length / 2)]) {
      const [x, z] = offsetPlan(plan, -3)[i];
      P.add(M.deck, box(x - 2.5, x + 2.5, top, top + 2.8, z - 2.5, z + 2.5));
    }
    // Parked cars in the stall rows (a few: they only show from above).
    const xs = plan.map((p) => p[0]), zs = plan.map((p) => p[1]);
    const inner = offsetPlan(plan, -3);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 2.75) {
      for (let z = Math.min(...zs); z < Math.max(...zs); z += 18) {
        for (const dz of [2.75, 15.25]) {
          if (rand() > 0.07) continue;
          const cx = x + 1.375, cz = z + dz;
          if (!inside(inner, cx, cz)) continue;
          cars.push([cx, top + 0.04, cz]);
        }
      }
    }
  }
  if (cars.length) {
    const COLORS = [0xe8e8e8, 0x1e1f22, 0x8c9096, 0x2c4a7a, 0x7a1f1f, 0xb9bcc0, 0x3d4a3a, 0xd9d4c7];
    const carGeo = merge([box(-0.9, 0.9, 0, 0.8, -2.3, 2.3), box(-0.8, 0.8, 0.8, 1.4, -1.2, 1.1)]);
    const inst = new THREE.InstancedMesh(carGeo, ctx.mat(0xffffff, 'glossy'), cars.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    cars.forEach(([x, y, z], i) => {
      m4.makeRotationY(GRID + (rand() < 0.5 ? Math.PI : 0)).setPosition(x, y, z);
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, col.setHex(COLORS[Math.floor(rand() * COLORS.length)]));
    });
    inst.computeBoundingSphere();
    P.extra = inst;
  }

  // ---- entrances: glazed vestibules under teal WEM sign bands ----
  const signTex = signTexture(512, 128, '#18a3a6', [{ text: 'WEM', size: 0.7, y: 0.54, font: 'Georgia, serif' }]);
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5 });
  const E = edges(OUTLINE);
  for (const [px, pz] of ENTRANCES) {
    let best = null;
    for (const e of E) {
      if (e.len < 16) continue;
      const t = Math.max(6, Math.min(e.len - 6, (px - e.a[0]) * e.t[0] + (pz - e.a[1]) * e.t[1]));
      const x = e.a[0] + e.t[0] * t, z = e.a[1] + e.t[1] * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { d, x, z, e };
    }
    const { x, z, e } = best;
    const yaw = Math.atan2(e.n[0], e.n[1]); // local +z onto the outward normal
    const at = (g) => g.rotateY(yaw).translate(x, 0, z);
    P.add(M.cream, at(box(-8, 8, 0, 6.2, -0.2, 3.4)));
    P.add(M.door, at(box(-6.5, 6.5, 0, 4.2, 3.4, 3.5)));
    P.add(M.frame, at(box(-8.6, 8.6, 6.2, 7.0, -0.2, 3.9)));
    P.add(signMat, at(new THREE.PlaneGeometry(12, 3).translate(0, 8.9, 0.42)));
    P.add(M.cream, at(box(-6.6, 6.6, 7.2, 10.6, -0.2, 0.38)));
  }

  const g = P.group();
  if (P.extra) g.add(P.extra);
  return g;
}
