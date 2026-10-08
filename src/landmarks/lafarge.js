import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Lafarge concrete batch plant at Parsons Rd & Ellerslie Rd. The two big OSM sheds on the
// site are rotated about 37 degrees and leave a diagonal free strip through the yard centre,
// so the plant sits in a sub-group turned to the same grid: silos and batch tower near the
// origin, two inclined conveyor booms running NE and SW down to hoppers and aggregate heaps.
// Origin = yard centre, x = east, z = south.
export const sink = 0;

const SILO = 0xb9bcc0, SILO_DK = 0xa4a7ab, TOWER = 0x9a9ea3, TOWER_DK = 0x8b8f94, STEEL = 0x6b6f74;
const SAND = 0x8a7657, GRAVEL = 0xa8a39a, PAD = 0xa39e96, SHED = 0xc2bfb6, SHED_ROOF = 0x7d8084, DARK = 0x2b323c;

const plain = (g) => {
  const p = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(p.attributes)) if (n !== 'position' && n !== 'normal') p.deleteAttribute(n);
  return p;
};
const box = (w, h, d, x, y, z) => plain(new THREE.BoxGeometry(w, h, d)).translate(x, y + h / 2, z);
// Orient a geometry built along +z (from z = 0 to z = |b - a|) so it runs from a to b.
function along(geo, a, b) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  return geo.rotateX(-Math.asin(d.y / L)).rotateY(Math.atan2(d.x, d.z)).translate(a.x, a.y, a.z);
}
const bar = (a, b, w, h) => along(plain(new THREE.BoxGeometry(w, h, a.distanceTo(b))).translate(0, 0, a.distanceTo(b) / 2), a, b);
const pipe = (a, b, r) => along(plain(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 8, 1, true)).rotateX(Math.PI / 2).translate(0, 0, a.distanceTo(b) / 2), a, b);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function build(ctx) {
  const g = new THREE.Group();
  const site = new THREE.Group();
  site.rotation.y = -Math.atan2(0.61, 0.79); // match the neighbouring sheds' grid
  g.add(site);
  const silo = [], siloDk = [], tower = [], towerDk = [], steel = [], sand = [], gravel = [], shed = [], shedRoof = [], dark = [], pad = [];

  // Gravel yard pad along the free strip.
  pad.push(plain(new THREE.PlaneGeometry(46, 118)).rotateX(-Math.PI / 2).translate(4, 0.06, 0));

  // Five cement silos in a tight row on a steel frame.
  const su = -8, legs = [];
  for (let i = 0; i < 6; i++) legs.push(-13.75 + 5.5 * i);
  for (const w of legs) {
    steel.push(box(0.45, 4.6, 0.45, su - 2.2, 0, w), box(0.45, 4.6, 0.45, su + 2.2, 0, w));
    steel.push(box(4.85, 0.5, 0.5, su, 4.6, w));
  }
  steel.push(box(0.5, 0.6, 29.5, su - 2.2, 4.6, 0), box(0.5, 0.6, 29.5, su + 2.2, 4.6, 0));
  for (let i = 0; i < 5; i++) {
    const w = -11 + 5.5 * i;
    siloDk.push(plain(new THREE.CylinderGeometry(2.5, 0.55, 2.6, 14, 1, true)).translate(su, 6.7, w));
    silo.push(plain(new THREE.CylinderGeometry(2.5, 2.5, 14, 14, 1, true)).translate(su, 15, w));
    silo.push(plain(new THREE.CylinderGeometry(0.5, 2.5, 1.0, 14, 1, false)).translate(su, 22.5, w));
    steel.push(plain(new THREE.CylinderGeometry(0.6, 0.6, 1.6, 10, 1, false)).translate(su, 23.8, w));
  }
  // Catwalk along the silo tops and a railing.
  steel.push(box(1.1, 0.12, 30, su + 3.1, 22.0, 0), box(0.06, 1.0, 30, su + 3.6, 22.1, 0));
  for (const w of [-14.5, -7.5, 0, 7.5, 14.5]) steel.push(box(0.06, 1.0, 0.06, su + 3.6, 22.1, w));

  // Batch tower: truck drive-through at the base, stepped boxes above, penthouse on top.
  const tu = 8;
  towerDk.push(box(12, 5.5, 2.4, tu, 0, -4.8), box(12, 5.5, 2.4, tu, 0, 4.8));
  tower.push(box(12, 8, 12, tu, 5.5, 0));
  tower.push(box(10, 12, 10, tu, 13.5, 0));
  towerDk.push(box(6, 4.5, 6, tu, 25.5, 0));
  towerDk.push(box(3.2, 3, 2.4, tu, 24.2, -6.2), box(3.2, 3, 2.4, tu, 24.2, 6.2)); // boom head houses
  steel.push(box(2.2, 27, 2.2, tu + 7.1, 0, 3));                                    // stair tower
  for (const y of [16, 20]) for (const w of [-2.5, 0, 2.5]) dark.push(plain(new THREE.PlaneGeometry(1.4, 1.4)).rotateY(-Math.PI / 2).translate(tu - 5.06, y, w));
  dark.push(plain(new THREE.PlaneGeometry(2.0, 2.4)).rotateY(-Math.PI / 2).translate(tu - 6.06, 6.8, 3));
  steel.push(pipe(V(su + 2.2, 5.6, 0), V(tu - 4, 20, 0), 0.25)); // cement feed to the tower

  // Two inclined conveyor booms from the tower head houses down to ground hoppers.
  for (const sgn of [-1, 1]) {
    const top = V(tu, 26.8, sgn * 6.5), low = V(tu, 3.9, sgn * 49);
    steel.push(bar(low, top, 1.4, 1.0));
    steel.push(bar(V(tu, low.y - 0.1, low.z), V(tu, top.y - 0.1, top.z), 0.08, 0.08).translate(1.0, 0.75, 0)); // handrail
    for (const t of [0.3, 0.62]) {
      const p = low.clone().lerp(top, t), h = p.y - 0.6;
      steel.push(box(0.35, h, 0.35, p.x - 1.2, 0, p.z), box(0.35, h, 0.35, p.x + 1.2, 0, p.z), box(2.9, 0.3, 0.3, p.x, h - 0.3, p.z));
    }
    // Receiving hopper under the low end.
    const hz = low.z + sgn * 1.5;
    steel.push(plain(new THREE.CylinderGeometry(3.4, 1.0, 2.4, 4, 1, true)).rotateY(Math.PI / 4).translate(tu, 2.8, hz));
    steel.push(box(5.0, 0.3, 5.0, tu, 4.0, hz));
    for (const [dx, dz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) steel.push(box(0.3, 1.8, 0.3, tu + dx, 0, hz + dz));
  }

  // Sand and gravel heaps around the hoppers.
  const heap = (list, u, w, r, h) => list.push(plain(new THREE.ConeGeometry(r, h, 16, 1, true)).translate(u, h / 2, w));
  heap(sand, -6, -52, 9, 6); heap(gravel, 22, -50, 8, 5); heap(sand, 16, -40, 6.5, 4.5);
  heap(gravel, -6, 52, 9, 6); heap(sand, 22, 50, 8, 5); heap(sand, -16, 38, 6, 4);

  // Two small sheds with low gable roofs, two admixture tanks, yard lights.
  const gable = (w, d, rise, x, y, z) => {
    const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, rise); s.lineTo(-w / 2, 0);
    return plain(new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false })).translate(x, y, z - d / 2);
  };
  shed.push(box(12, 3.4, 9, -12, 0, 20)); shedRoof.push(gable(12.8, 9.6, 1.6, -12, 3.4, 20));
  shed.push(box(10, 3.0, 8, 24, 0, -38)); shedRoof.push(gable(10.8, 8.6, 1.4, 24, 3.0, -38));
  dark.push(plain(new THREE.PlaneGeometry(3.6, 2.8)).rotateY(Math.PI / 2).translate(-5.94, 1.4, 20));
  dark.push(plain(new THREE.PlaneGeometry(3.0, 2.5)).rotateY(Math.PI / 2).translate(29.06, 1.25, -38));
  for (const w of [10, 13.2]) silo.push(plain(new THREE.CylinderGeometry(1.2, 1.2, 5, 10, 1, false)).translate(18, 2.5, w));
  for (const [u, w] of [[24, 20], [-14, -30], [24, -14]]) steel.push(box(0.25, 12, 0.25, u, 0, w), box(1.2, 0.3, 0.5, u + 0.5, 11.8, w));

  const add = (list, mat) => { if (list.length) site.add(new THREE.Mesh(mergeGeometries(list), mat)); };
  add(pad, ctx.mat(PAD));
  add(silo, ctx.mat(SILO));
  add(siloDk, ctx.mat(SILO_DK));
  add(tower, ctx.mat(TOWER));
  add(towerDk, ctx.mat(TOWER_DK));
  add(steel, ctx.mat(STEEL));
  add(sand, ctx.mat(SAND));
  add(gravel, ctx.mat(GRAVEL));
  add(shed, ctx.mat(SHED));
  add(shedRoof, ctx.mat(SHED_ROOF));
  add(dark, ctx.mat(DARK, 'glass'));
  return g;
}
