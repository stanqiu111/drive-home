import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Rossdale Power Plant (decommissioned Low Pressure Plant) on the river flats below downtown.
// Footprint traced from OSM: the brick hall is 37 x 112 m with its LONG AXIS NORTH-SOUTH
// (bbox 55 m east-west x 123 m north-south), plus a 16 m bump on the east side and a short
// tail at the south end. Taller boiler-house block at the north end, three slim steel stacks
// in a north-south row just east of it. Origin = hall centre, x = east, z = south.
export const sink = 0;

const BRICK = 0x8a4b3a, GLASS = 0x2b323c, MULLION = 0xd8d2c6, STONE = 0xc9bca6;
const ROOF = 0x3e4144, STACK = 0x8c8f91, STEEL = 0x5e6368, CONCRETE = 0x9d9a92;

const plain = (g) => {
  const p = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(p.attributes)) if (n !== 'position' && n !== 'normal') p.deleteAttribute(n);
  return p;
};
// Box with its bottom at y.
const box = (w, h, d, x, y, z) => plain(new THREE.BoxGeometry(w, h, d)).translate(x, y + h / 2, z);
const FACE = { s: [0, 0, 1], n: [Math.PI, 0, -1], e: [Math.PI / 2, 1, 0], w: [-Math.PI / 2, -1, 0] };

// One arched steel-framed window: dark panel + pale mullions, built facing +z with the sill at y = 0.
function archedWindow(w, hr) {
  const r = w / 2;
  const s = new THREE.Shape();
  s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, hr);
  s.absarc(0, hr, r, 0, Math.PI, false);
  s.lineTo(-r, 0);
  const panel = plain(new THREE.ShapeGeometry(s, 7));
  const parts = [];
  const vx = w / 6, vl = hr + Math.sqrt(r * r - vx * vx);
  parts.push(plain(new THREE.PlaneGeometry(0.16, vl)).translate(vx, vl / 2, 0.05));
  parts.push(plain(new THREE.PlaneGeometry(0.16, vl)).translate(-vx, vl / 2, 0.05));
  for (const y of [hr / 3, (2 * hr) / 3, hr]) parts.push(plain(new THREE.PlaneGeometry(w, 0.16)).translate(0, y, 0.05));
  return { panel, mullions: mergeGeometries(parts) };
}

export function build(ctx) {
  const g = new THREE.Group();
  const brick = [], stone = [], roof = [], glass = [], mull = [], stack = [], steel = [], concrete = [];

  // Blocks: x0..x1 east-west, z0..z1 north-south, h = roof height.
  const boiler = { x0: -27, x1: 10, z0: -61, z1: -26, h: 29 };
  const hall = { x0: -27, x1: 10, z0: -26, z1: 51, h: 22 };
  const annex = { x0: 10, x1: 26, z0: -26, z1: 5, h: 16 };
  const tail = { x0: -6, x1: 6, z0: 51, z1: 62, h: 10 };
  for (const b of [boiler, hall, annex, tail]) {
    const w = b.x1 - b.x0, d = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    brick.push(box(w, b.h, d, cx, 0, cz));
    // Parapet with pale coping, dark flat roof inside it.
    const t = 0.45, ph = 1.1;
    brick.push(box(w, ph, t, cx, b.h, b.z0 + t / 2), box(w, ph, t, cx, b.h, b.z1 - t / 2));
    brick.push(box(t, ph, d, b.x0 + t / 2, b.h, cz), box(t, ph, d, b.x1 - t / 2, b.h, cz));
    stone.push(box(w + 0.3, 0.25, t + 0.3, cx, b.h + ph, b.z0 + t / 2), box(w + 0.3, 0.25, t + 0.3, cx, b.h + ph, b.z1 - t / 2));
    stone.push(box(t + 0.3, 0.25, d + 0.3, b.x0 + t / 2, b.h + ph, cz), box(t + 0.3, 0.25, d + 0.3, b.x1 - t / 2, b.h + ph, cz));
    roof.push(plain(new THREE.PlaneGeometry(w - 2 * t, d - 2 * t)).rotateX(-Math.PI / 2).translate(cx, b.h + 0.04, cz));
    // Stone string course at sill height and a plinth at the base.
    stone.push(box(w + 0.3, 0.35, d + 0.3, cx, b.h > 12 ? 3.5 : 2.6, cz));
    stone.push(box(w + 0.2, 0.9, d + 0.2, cx, 0, cz));
  }

  // Facade helpers. face: which side the wall faces; (x, z) is a point on the wall surface.
  const big = archedWindow(4.4, 13.5), mid = archedWindow(3.6, 7), small = archedWindow(2.4, 2.4);
  function win(kind, face, x, z, sill) {
    const [rot, nx, nz] = FACE[face];
    glass.push(kind.panel.clone().rotateY(rot).translate(x + nx * 0.08, sill, z + nz * 0.08));
    mull.push(kind.mullions.clone().rotateY(rot).translate(x + nx * 0.08, sill, z + nz * 0.08));
  }
  function pilaster(face, x, z, h) {
    const [, nx, nz] = FACE[face];
    brick.push(box(nx ? 0.5 : 1.0, h, nz ? 0.5 : 1.0, x + nx * 0.25, 0, z + nz * 0.25));
  }
  // A long facade: n bays of big arched windows between brick pilasters.
  function facade(b, face, n, kind, sill) {
    const along = face === 'w' || face === 'e' ? [b.z0, b.z1] : [b.x0, b.x1];
    const step = (along[1] - along[0]) / n;
    const wall = face === 'w' ? b.x0 : face === 'e' ? b.x1 : face === 'n' ? b.z0 : b.z1;
    for (let i = 0; i <= n; i++) {
      const u = along[0] + step * i;
      if (face === 'w' || face === 'e') pilaster(face, wall, u, b.h + 1.1); else pilaster(face, u, wall, b.h + 1.1);
      if (i < n) {
        const c = u + step / 2;
        if (face === 'w' || face === 'e') win(kind, face, wall, c, sill); else win(kind, face, c, wall, sill);
      }
    }
  }
  facade(hall, 'w', 10, big, 4);
  facade(boiler, 'w', 4, big, 4);
  facade(boiler, 'e', 4, big, 4);
  facade({ ...hall, z0: 5 }, 'e', 6, big, 4);        // east wall of the hall south of the annex
  facade(annex, 'e', 3, mid, 3);
  // Upper row of small windows on the boiler house, end walls and the annex ends.
  for (const z of [-56.6, -47.9, -39.1, -30.4]) { win(small, 'w', boiler.x0, z, 23); win(small, 'e', boiler.x1, z, 23); }
  for (const x of [-19.5, -8.5, 2.5]) { win(big, 'n', x, boiler.z0, 4); win(small, 'n', x, boiler.z0, 23); }
  for (const x of [-20, -11.5]) win(big, 's', x, hall.z1, 4);
  for (const x of [14, 22]) { win(mid, 's', x, annex.z1, 3); win(mid, 'n', x, annex.z0, 3); }
  pilaster('n', -27, boiler.z0, boiler.h + 1.1); pilaster('n', 10, boiler.z0, boiler.h + 1.1);
  pilaster('s', -27, hall.z1, hall.h + 1.1);
  // Doors: tall dark doorways on the west (bridge) side and the pump tail.
  for (const z of [-44, 44]) glass.push(plain(new THREE.PlaneGeometry(3.2, 4.2)).rotateY(-Math.PI / 2).translate(hall.x0 - 0.06, 2.1, z));
  glass.push(plain(new THREE.PlaneGeometry(3.4, 4.0)).translate(0, 2.0, tail.z1 + 0.06));
  win(small, 'e', tail.x1, 56.5, 5); win(small, 'w', tail.x0, 56.5, 5);

  // Rooftop vents on the hall and boiler house.
  for (const [x, z] of [[-16, -2], [2, 18], [-8, 38], [-16, -50], [2, -36]]) steel.push(box(2.2, 1.6, 2.2, x, z < -26 ? boiler.h : hall.h, z));

  // Three slim steel stacks in a north-south row just east of the boiler house.
  for (const z of [-48, -30, -12]) {
    const x = 34, h = 55, rb = 1.7, rt = 1.3;
    concrete.push(box(5, 1.6, 5, x, 0, z));
    stack.push(plain(new THREE.CylinderGeometry(rt, rb, h - 1.6, 14, 1, true)).translate(x, 1.6 + (h - 1.6) / 2, z));
    steel.push(plain(new THREE.CylinderGeometry(rt + 0.18, rt + 0.18, 1.2, 14, 1, false)).translate(x, h - 0.4, z));
    for (const y of [14, 28, 42]) {
      const r = rb - (rb - rt) * ((y - 1.6) / (h - 1.6));
      steel.push(plain(new THREE.CylinderGeometry(r + 0.12, r + 0.12, 0.6, 14, 1, true)).translate(x, y, z));
    }
    const rp = rb - (rb - rt) * ((47 - 1.6) / (h - 1.6));
    steel.push(plain(new THREE.CylinderGeometry(rp + 1.1, rp + 1.1, 0.25, 14, 1, false)).translate(x, 47, z));
    steel.push(plain(new THREE.TorusGeometry(rp + 1.1, 0.05, 4, 14)).rotateX(Math.PI / 2).translate(x, 48.1, z));
    steel.push(box(0.5, 45, 0.16, x - rb - 0.3, 2, z)); // ladder on the west side
  }

  const add = (list, mat) => { if (list.length) g.add(new THREE.Mesh(mergeGeometries(list), mat)); };
  add(brick, ctx.mat(BRICK));
  add(stone, ctx.mat(STONE));
  add(concrete, ctx.mat(CONCRETE));
  add(roof, ctx.mat(ROOF));
  add(glass, ctx.mat(GLASS, 'glass'));
  add(mull, ctx.mat(MULLION));
  add(stack, ctx.mat(STACK));
  add(steel, ctx.mat(STEEL));
  return g;
}
