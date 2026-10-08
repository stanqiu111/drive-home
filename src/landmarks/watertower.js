import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Sherwood Park water tower: a classic elevated steel tank. One wide pedestal column with a
// spheroid "mushroom" tank on top (about 20 m across, 39 m overall), painted white and pale
// blue, with a railing ring at the tank's equator, an external ladder, a small valve house and
// a chain-link fence around the grass lot. Origin = base of the column, x = east, z = south.
export const sink = 0;

const COLUMN = 0xdfe3e6, TANK_LO = 0xbcd3e3, TANK_HI = 0xe9eef2, BAND = 0x7fa3bf, STEEL = 0x8c9196;
const CONCRETE = 0xb8b4ac, HOUSE = 0xc7c2b8, HOUSE_ROOF = 0x6f7276, DARK = 0x2b323c, MESH = 0x9aa3a8;

const plain = (g) => {
  const p = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(p.attributes)) if (n !== 'position' && n !== 'normal') p.deleteAttribute(n);
  return p;
};
const box = (w, h, d, x, y, z) => plain(new THREE.BoxGeometry(w, h, d)).translate(x, y + h / 2, z);
const lathe = (pts, seg) => plain(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg));

export function build(ctx) {
  const g = new THREE.Group();
  const column = [], tankLo = [], tankHi = [], band = [], steel = [], concrete = [], house = [], houseRoof = [], dark = [], mesh = [];
  const SEG = 22;

  // Footing, pedestal column and door.
  concrete.push(plain(new THREE.CylinderGeometry(3.4, 3.4, 0.5, SEG, 1, false)).translate(0, 0.25, 0));
  column.push(lathe([[2.7, 0.5], [2.0, 2.0], [2.0, 23.6]], SEG));
  dark.push(plain(new THREE.PlaneGeometry(1.1, 2.3)).rotateY(Math.PI / 2).translate(2.06, 1.65, 0));

  // Tank: lower bowl in pale blue, upper spheroid in white, dark band between.
  tankLo.push(lathe([[2.0, 23.4], [2.7, 24.6], [4.6, 26.2], [6.9, 27.7], [8.8, 29.4], [9.8, 31.2], [10.0, 32.9]], SEG));
  band.push(plain(new THREE.CylinderGeometry(10.06, 10.06, 0.5, SEG, 1, true)).translate(0, 33.0, 0));
  tankHi.push(lathe([[10.0, 33.1], [9.5, 34.8], [8.1, 36.2], [5.9, 37.3], [3.0, 38.0], [0.0, 38.3]], SEG));
  steel.push(plain(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 8, 1, false)).translate(0, 38.6, 0));
  steel.push(plain(new THREE.CylinderGeometry(0.65, 0.65, 0.15, 8, 1, false)).translate(0, 39.1, 0));

  // Railing ring at the equator: posts plus two rails.
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    steel.push(box(0.07, 1.1, 0.07, Math.cos(a) * 10.25, 33.1, Math.sin(a) * 10.25));
  }
  for (const y of [33.7, 34.2]) steel.push(plain(new THREE.TorusGeometry(10.25, 0.04, 3, 28)).rotateX(Math.PI / 2).translate(0, y, 0));

  // External ladder up the column (south side).
  steel.push(box(0.06, 22.5, 0.06, -0.22, 1.0, 2.25), box(0.06, 22.5, 0.06, 0.22, 1.0, 2.25));
  for (let y = 1.4; y < 23.4; y += 0.9) steel.push(box(0.5, 0.05, 0.05, 0, y, 2.25));

  // Valve house and the chain-link fence around the lot.
  house.push(box(3.2, 2.6, 2.8, 6, 0, -4));
  houseRoof.push(box(3.5, 0.2, 3.1, 6, 2.6, -4));
  dark.push(plain(new THREE.PlaneGeometry(0.9, 2.0)).rotateY(-Math.PI / 2).translate(4.39, 1.0, -4));
  const x0 = -10, x1 = 10, z0 = -8, z1 = 10;
  const post = (x, z) => steel.push(box(0.08, 1.9, 0.08, x, 0, z));
  for (let i = 0; i <= 5; i++) { post(x0 + (i * 20) / 5, z0); post(x0 + (i * 20) / 5, z1); }
  for (let i = 1; i < 5; i++) { post(x0, z0 + (i * 18) / 5); post(x1, z0 + (i * 18) / 5); }
  steel.push(box(20, 0.05, 0.05, 0, 1.85, z0), box(20, 0.05, 0.05, 0, 1.85, z1), box(0.05, 0.05, 18, x0, 1.85, 1), box(0.05, 0.05, 18, x1, 1.85, 1));
  mesh.push(plain(new THREE.PlaneGeometry(20, 1.85)).translate(0, 0.925, z0), plain(new THREE.PlaneGeometry(20, 1.85)).translate(0, 0.925, z1));
  mesh.push(plain(new THREE.PlaneGeometry(18, 1.85)).rotateY(Math.PI / 2).translate(x0, 0.925, 1), plain(new THREE.PlaneGeometry(18, 1.85)).rotateY(Math.PI / 2).translate(x1, 0.925, 1));

  const add = (list, mat) => { if (list.length) g.add(new THREE.Mesh(mergeGeometries(list), mat)); };
  add(concrete, ctx.mat(CONCRETE));
  add(column, ctx.mat(COLUMN, 'glossy'));
  add(tankLo, ctx.mat(TANK_LO, 'glossy'));
  add(tankHi, ctx.mat(TANK_HI, 'glossy'));
  add(band, ctx.mat(BAND, 'glossy'));
  add(steel, ctx.mat(STEEL));
  add(house, ctx.mat(HOUSE));
  add(houseRoof, ctx.mat(HOUSE_ROOF));
  add(dark, ctx.mat(DARK, 'glass'));
  add(mesh, ctx.mat(MESH, 'matte', { transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  return g;
}
