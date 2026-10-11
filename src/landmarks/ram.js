import * as THREE from 'three';
import { Parts, walls, cap, box, tileTexture, lowestGround } from './_kit.js';

// Royal Alberta Museum (2018) on 103A Ave between 97 St and 99 St, north of City Hall:
// a long low museum of pale limestone and glass. Seen from the street: a two-storey limestone
// box cantilevered over the glass 99 St entrance at the south-west corner, with a big video
// screen on its corner and ROYAL ALBERTA MUSEUM in black letters; a second box at the
// south-east corner; glass halls between them and along 97 St; at the north-west a taller
// limestone gallery block with a large clock, in front of it a curved wall of gold panels and
// a low drum of perforated metal under a ring of windows. Outline and the two cantilevers from
// OpenStreetMap (way 324786162 and its parts), the 24.7 m top from the City rooflines; the
// heights of the separate parts are estimated from photos. The building's grid is turned
// 13.5 degrees anticlockwise from true east, so the model is built in that grid (u east,
// v south) and turned at the end. Origin = the Nominatim point of the museum.
export const sink = 0;

const TH = 13.5 * Math.PI / 180, C = Math.cos(TH), S = Math.sin(TH);
const toUV = ([x, z]) => [x * C - z * S, x * S + z * C];
const toXZ = ([u, v]) => [u * C + v * S, -u * S + v * C];

// OSM outline (x east, z south), converted to the building grid. It runs clockwise seen from
// above, so the outside of each edge a->b is on its left.
const OUTLINE = [[-27, 40.9], [-10.2, 36.9], [-11, 13.7], [-33.7, 14], [-34.9, 10.7], [-39.7, 14.5], [-47.4, 16.1], [-54.5, 14.5], [-58.8, 10.7], [-61.5, 8.5], [-64.8, 5], [-66.9, -1.6], [-69.3, -6.3], [-77.3, -12.5], [-60.7, -16.8], [-65.9, -38.3], [5.8, -55.5], [4.7, -60.1], [46.9, -70.9], [47.8, -67], [68.2, -72.2], [75.6, -41.8], [73.9, -41.4], [77.9, -24.9], [61.3, -20.9], [71.3, 19.6], [72.8, 19.4], [75.4, 30.2], [65.5, 32.7], [67.9, 42.3], [32.2, 51.1], [30.1, 42.4], [10.1, 47.1], [10.1, 63], [-20.3, 70.3]].map(toUV);
// Edge i runs from point i to point i + 1. The curved west edges are the perforated drum; the
// glass edges are full-height curtain wall; the rest have a glass ground floor under limestone.
const DRUM = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12]);
const GLASS = new Set([0, 1, 2, 20, 22, 24, 25, 26, 30, 31, 32, 33, 34]);
const BODY = 13;

const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

// Wall quads along an open run of outline points (outside on the left of each edge), moved
// `inset` metres inward, with texture coordinates when uv = [metres per repeat along, up].
function strip(pts, y0, y1, uv = null, inset = 0) {
  const pos = [], tex = [];
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
    const len = Math.hypot(ub - ua, vb - va);
    const nx = (vb - va) / len, nz = -(ub - ua) / len; // outward normal
    const a = [ua - nx * inset, va - nz * inset], b = [ub - nx * inset, vb - nz * inset];
    pos.push(b[0], y0, b[1], a[0], y0, a[1], a[0], y1, a[1], b[0], y0, b[1], a[0], y1, a[1], b[0], y1, b[1]);
    if (uv) {
      const U0 = run / uv[0], U1 = (run + len) / uv[0], V0 = y0 / uv[1], V1 = y1 / uv[1];
      tex.push(U1, V0, U0, V0, U0, V1, U1, V0, U0, V1, U1, V1);
    }
    run += len;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(tex, 2));
  geo.computeVertexNormals();
  return geo;
}

export function build(ctx) {
  const P = new Parts();
  // Large pale limestone panels (tile = 6 m: two 3 m panels each way, joints offset per row).
  const stoneTex = tileTexture(64, 64, (g, w) => {
    const shades = ['#dfddd6', '#dbd9d2', '#e2e0d9', '#dddbd4'];
    for (let r = 0; r < 2; r++) for (let c = -1; c < 2; c++) {
      g.fillStyle = shades[(r * 2 + c + 4) % 4];
      g.fillRect(c * 32 + (r ? 16 : 0), r * 32, 31, 31);
    }
    g.fillStyle = '#cdcbc4';
    g.fillRect(0, 31, w, 1);
    g.fillRect(0, 63, w, 1);
  });
  const curtainTex = tileTexture(64, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#abc8d2');
    grd.addColorStop(1, '#8cacb8');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d9dee1';
    g.fillRect(0, 0, 3, h);
    g.fillRect(32, 0, 2, h);
    g.fillRect(0, 0, w, 3);
  });
  const perfTex = tileTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#ccd1d6';
    g.fillRect(0, 0, w, h);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    g.fillStyle = '#9ba2a9';
    for (let i = 0; i < 90; i++) { g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.6 + rnd() * 1.6, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#adb3b9';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
  });
  const goldTex = tileTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#cfb274';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b59a5b';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
  });
  const M = {
    stone: new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.8 }),
    stoneFlat: ctx.mat(0xdcdad3),
    soffit: ctx.mat(0xe6e4de),
    curtain: new THREE.MeshStandardMaterial({ map: curtainTex, roughness: 0.2, metalness: 0.3 }),
    perf: new THREE.MeshStandardMaterial({ map: perfTex, roughness: 0.45, metalness: 0.3 }),
    gold: new THREE.MeshStandardMaterial({ map: goldTex, roughness: 0.5, metalness: 0.25 }),
    metal: ctx.mat(0xbcc2c7, 'glossy'),
    roof: ctx.mat(0x9a9894),
    dark: ctx.mat(0x1c1f22, 'glossy'),
    clock: ctx.mat(0x4c545b),
  };
  const STONE_UV = [6, 6], CURTAIN_UV = [3, 4.5], PERF_UV = [6, 6], GOLD_UV = [2.4, 3];
  const g0 = Math.min(0, lowestGround(ctx, OUTLINE.map(toXZ), 0)) - 1;

  // ---- the main body, edge by edge ----
  const n = OUTLINE.length;
  const style = (i) => (DRUM.has(i) ? 'drum' : GLASS.has(i) ? 'glass' : 'stone');
  for (let i = 0; i < n;) {
    const st = style(i);
    let j = i;
    while (j + 1 < n && style(j + 1) === st) j++;
    const pts = [];
    for (let k = i; k <= j + 1; k++) pts.push(OUTLINE[k % n]);
    if (st === 'glass') {
      P.add(M.curtain, strip(pts, g0, BODY, CURTAIN_UV, 0.2));
    } else if (st === 'stone') {
      P.add(M.curtain, strip(pts, g0, 5.5, CURTAIN_UV, 0.5));
      P.add(M.stone, strip(pts, 5.5, BODY, STONE_UV));
    } else {
      // Drum: perforated metal over a glazed slot, a ring of windows above it.
      P.add(M.curtain, strip(pts, g0, 1.2, CURTAIN_UV, 0.5));
      P.add(M.perf, strip(pts, 1.2, 8.5, PERF_UV));
      P.add(M.curtain, strip(pts, 8.5, 11.5, CURTAIN_UV, 1.2));
      P.add(M.metal, strip(pts, 11.5, 12.3, null, 1.0));
    }
    i = j + 1;
  }
  P.add(M.roof, cap(OUTLINE, BODY));

  // ---- the taller gallery block with the clock (north-west) ----
  const tall = rect(-55, 2, -52.6, -12);
  P.add(M.stone, walls(tall, BODY, 24.7, STONE_UV));
  P.add(M.stoneFlat, cap(tall, 24.7));
  P.add(M.dark, box(-55.15, -55.05, 14, 17.5, -47, -43.5)); // louvre
  {
    // Clock: a dark ring with twelve block markers and two flat hands, on the west face.
    const cu = -55.2, cv = -30, cy = 19.6, R = 3.4;
    const parts = [new THREE.TorusGeometry(R, 0.12, 4, 32).rotateY(Math.PI / 2).translate(cu, cy, cv)];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      parts.push(new THREE.BoxGeometry(0.3, 0.55, 0.95).rotateX(-a).translate(cu - 0.1, cy + Math.cos(a) * R, cv + Math.sin(a) * R));
    }
    parts.push(new THREE.BoxGeometry(0.1, 2.8, 0.3).translate(0, 1.2, 0).rotateX(-0.5).translate(cu - 0.25, cy, cv));
    parts.push(new THREE.BoxGeometry(0.1, 2.0, 0.35).translate(0, 0.9, 0).rotateX(1.9).translate(cu - 0.3, cy, cv));
    P.add(M.clock, ...parts);
  }

  // ---- curved gold wall behind the drum, and the glass hall along 99 St ----
  {
    const pts = [];
    for (let k = 0; k <= 8; k++) { const a = -0.25 + (k / 8) * 1.9; pts.push([-37 - Math.cos(a) * 13, -12 + Math.sin(a) * 15]); }
    const plan = [...pts, [-24, 6], [-24, -12]];
    P.add(M.gold, walls(plan, BODY - 2, 16.5, GOLD_UV));
    P.add(M.roof, cap(plan, 16.5));
    const hall = rect(-16, -1, 8, 47);
    P.add(M.curtain, walls(hall, BODY, 17, CURTAIN_UV));
    P.add(M.metal, walls(rect(-16.3, -0.7, 7.7, 47.3), 17, 18.2), cap(rect(-16.3, -0.7, 7.7, 47.3), 18.2));
  }

  // ---- south-west box: limestone, cantilevered over the 99 St entrance ----
  {
    const bx = rect(-46.2, -3, 33.5, 65.6), y0 = 6.2, y1 = 17.6;
    P.add(M.stone, walls(bx, y0, y1, STONE_UV), cap(bx, y1));
    P.add(M.soffit, cap(bx, y0, true));
    // Glazed upper section at the east end of the south face.
    P.add(M.curtain, box(-17.5, -4.5, 8.2, 15.8, 65.6, 65.7));
    // The video screen wrapping the south-west corner.
    const tex = screenTexture();
    const scr = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.6 });
    P.add(M.dark, box(-44.8, -19.5, 7.6, 16.4, 65.6, 65.9), box(-46.5, -46.2, 7.6, 16.4, 53, 64.2));
    P.add(scr, new THREE.PlaneGeometry(24.5, 8).translate(-32.1, 12, 65.92));
    P.add(scr, new THREE.PlaneGeometry(10.4, 8).rotateY(-Math.PI / 2).translate(-46.52, 12, 58.6));
    // ROYAL ALBERTA MUSEUM in black on the west face and under the glazed section.
    const word = new THREE.MeshStandardMaterial({ map: letteringTexture(), alphaTest: 0.5, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    P.add(word, new THREE.PlaneGeometry(9, 3.4).rotateY(-Math.PI / 2).translate(-46.25, 9.8, 42));
    P.add(word, new THREE.PlaneGeometry(9, 3.4).translate(-11, 7.9, 65.65));
  }

  // ---- south-east box at 103A Ave and 97 St ----
  {
    const bx = rect(19.4, 61.7, 47, 63.5), y0 = 6.2, y1 = 17.6;
    P.add(M.stone, walls(bx, y0, y1, STONE_UV), cap(bx, y1));
    P.add(M.soffit, cap(bx, y0, true));
    P.add(M.curtain, box(22, 59, 9, 14.5, 63.5, 63.6), box(61.7, 61.8, 9, 14.5, 49, 61.5));
  }

  // ---- east wing: a raised hall under a metal roof band, and a silver plant penthouse ----
  {
    const wing = rect(19, 64, -50, 47);
    P.add(M.curtain, walls(wing, BODY, 17, CURTAIN_UV));
    P.add(M.metal, walls(rect(18.7, 64.3, -50.3, 47.3), 17, 18.4), cap(rect(18.7, 64.3, -50.3, 47.3), 18.4));
    P.add(M.metal, walls(rect(-10, 18, -40, 6), BODY, 19.5), cap(rect(-10, 18, -40, 6), 19.5));
  }

  const g = P.group();
  g.rotation.y = TH; // building grid -> true north
  const root = new THREE.Group();
  root.add(g);
  return root;
}

// What the corner screen shows: a woolly mammoth on deep blue.
function screenTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 168;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 512, 0);
  grd.addColorStop(0, '#163a6b');
  grd.addColorStop(1, '#2a6fa8');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 168);
  g.fillStyle = '#f2ead8';
  g.beginPath();
  g.ellipse(330, 92, 70, 44, 0, 0, Math.PI * 2);
  g.ellipse(395, 70, 34, 32, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(278, 110, 20, 42); g.fillRect(310, 112, 20, 40); g.fillRect(350, 112, 20, 40); g.fillRect(380, 108, 18, 44);
  g.strokeStyle = '#f2ead8';
  g.lineWidth = 12;
  g.beginPath(); g.moveTo(420, 80); g.quadraticCurveTo(440, 120, 425, 150); g.stroke();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(410, 95); g.quadraticCurveTo(460, 110, 455, 75); g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 34px Helvetica, Arial, sans-serif';
  g.fillText('ICE AGE', 40, 70);
  g.font = '22px Helvetica, Arial, sans-serif';
  g.fillText('Royal Alberta Museum', 40, 104);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function letteringTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#16181a';
  g.font = '500 54px Helvetica, Arial, sans-serif';
  g.fillText('ROYAL ALBERTA', 30, 70);
  g.font = 'bold 104px Helvetica, Arial, sans-serif';
  g.fillText('MUSEUM', 24, 170);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
