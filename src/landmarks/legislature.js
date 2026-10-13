import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Alberta Legislature Building (Beaux-Arts, 1913) and the north grounds.
// Axes: x = east, z = south, y = up. The listed lon/lat is the OSM footprint centroid; the
// building's symmetry axis (north portico - rotunda - south wing) is 2.85 m west of it, so
// everything below is drawn around x = AX. Footprint from the OSM outline (way 42782487):
// T-plan 103 m east-west x 77 m north-south, portico on the north (-z) side, the long wing
// with the Chamber running south toward the river. Heights: granite base to 5.5 m, main roof
// 24.5 m, central attic 29 m, dome peak 53 m, lantern 57 m (City Rooflines: 56.5 m).
export const sink = 0;

const AX = -2.85;
const C = {
  granite: 0x6d6b66, // rusticated Vancouver Island granite base
  sand: 0xc9b899, // buff Glenbow (Paskapoo) sandstone
  trim: 0xd8caa9, // lighter sandstone for pilasters, cornices and balustrades
  terra: 0xbeb295, // terracotta dome tiles coloured to match the sandstone (not copper)
  glass: 0x33414d,
  roof: 0x7f786d,
  door: 0x3a2e26,
  pave: 0x9b968c,
  coping: 0xbcb6a9,
  water: 0x3b6d88,
  lawn: 0x5e9437,
  jet: 0xeaf3f7,
};
const BAY = 4.4; // bay spacing of the giant order
const DECK = 0.3; // north plaza deck height (97 Ave runs in a tunnel underneath)
const DOOR = DECK + 1.5; // floor level at the top of the north stairs

export function build(ctx) {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.position.x = AX;
  root.add(g);

  // --- collect geometry per material and merge once -------------------------------------
  const bins = new Map();
  const add = (key, geo) => {
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(geo);
  };
  const box = (key, x0, x1, z0, z1, y0, y1) =>
    add(key, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  const cyl = (key, x, z, r, y0, y1, seg = 12, open = false, rTop = r) =>
    add(key, new THREE.CylinderGeometry(rTop, r, y1 - y0, seg, 1, open).translate(x, (y0 + y1) / 2, z));
  // Mirror helper: run f for the east half and again mirrored in x.
  const both = (f) => { f(1); f(-1); };

  // --- window templates (facing +z, centred on x = 0, at their storey height) -------------
  const rectWin = (w, y0, y1) => new THREE.PlaneGeometry(w, y1 - y0).translate(0, (y0 + y1) / 2, 0);
  const archWin = (w, y0, yArch) => mergeGeometries([
    new THREE.PlaneGeometry(w, yArch - y0).translate(0, (y0 + yArch) / 2, 0),
    new THREE.CircleGeometry(w / 2, 8, 0, Math.PI).translate(0, yArch, 0),
  ]);
  const T = {
    ground: rectWin(1.6, 1.9, 4.3),
    piano: archWin(2.2, 6.4, 9.7), // tall arched windows on the second floor
    third: rectWin(2.0, 11.6, 14.4),
    fourth: rectWin(1.8, 15.4, 17.6),
    attic: rectWin(1.5, 21.7, 23.2),
    door: archWin(2.6, DOOR, DOOR + 2.1),
    drum: archWin(2.2, 33.2, 38.0),
  };
  // Place a template on a wall point with outward normal (nx, nz), 6 cm proud of the wall.
  const place = (tpl, x, z, nx, nz, key = 'glass') => {
    const geo = tpl.clone().rotateY(Math.atan2(nx, nz)).translate(x + nx * 0.06, 0, z + nz * 0.06);
    add(key, geo);
  };

  // A facade from (ax,az) to (bx,bz) with outward normal (nx,nz): one window per storey per
  // bay, and pilasters of the giant order between the bays.
  const facade = (ax, az, bx, bz, nx, nz, opt = {}) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / BAY));
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = ax + ux * len * t, z = az + uz * len * t;
      if (opt.ground !== false) place(T.ground, x, z, nx, nz);
      place(T.piano, x, z, nx, nz);
      place(T.third, x, z, nx, nz);
      place(T.fourth, x, z, nx, nz);
      if (opt.attic !== false) place(T.attic, x, z, nx, nz);
    }
    if (opt.pilasters === false) return;
    for (let i = 0; i <= n; i++) {
      const d = Math.min(Math.max(len * (i / n), 0.7), len - 0.7);
      const x = ax + ux * d + nx * 0.2, z = az + uz * d + nz * 0.2;
      const along = Math.abs(ux) > 0.5; // wall runs east-west
      add('trim', new THREE.BoxGeometry(along ? 1.0 : 0.4, 14.1, along ? 0.4 : 1.0).translate(x, 5.5 + 14.1 / 2, z));
    }
  };
  // Roof slab plus balustrade boxes along the given edges.
  const rail = (x0, z0, x1, z1, y) => {
    const ew = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    box('trim', Math.min(x0, x1) - (ew ? 0 : 0.15), Math.max(x0, x1) + (ew ? 0 : 0.15),
      Math.min(z0, z1) - (ew ? 0.15 : 0), Math.max(z0, z1) + (ew ? 0.15 : 0), y, y + 0.8);
  };
  const roofSlab = (x0, x1, z0, z1, y) => box('roof', x0 + 0.2, x1 - 0.2, z0 + 0.2, z1 - 0.2, y - 0.2, y + 0.1);
  // A building block: granite base, sandstone upper floors, cornice band at 19.6 m.
  const block = (x0, x1, z0, z1, yTop) => {
    box('granite', x0, x1, z0, z1, -4, 5.5);
    box('sand', x0, x1, z0, z1, 5.5, yTop);
    box('trim', x0 - 0.6, x1 + 0.6, z0 - 0.6, z1 + 0.6, 19.6, 20.8);
    box('trim', x0 - 0.15, x1 + 0.15, z0 - 0.15, z1 + 0.15, yTop - 0.9, yTop);
  };

  // =============================== THE BUILDING ==========================================
  // Central spine (portico back wall to the south end) and the central block's attic.
  block(-13, 13, -17.75, 44.5, 24.5);
  box('sand', -13, 13, -17.75, 8, 24.5, 29); // attic of the central block under the dome
  box('trim', -13.5, 13.5, -18.25, 8.5, 27.8, 29);
  roofSlab(-13, 13, -17.75, 8, 29);
  roofSlab(-13, 13, 8, 44.5, 24.5);
  rail(-13, -17.75, 13, -17.75, 29); rail(-13, 8, 13, 8, 29);
  rail(13, -17.75, 13, 8, 29); rail(-13, -17.75, -13, 8, 29);
  both((s) => { box('trim', s * 11.2, s * 13.6, -18.4, -15.9, 29, 31); box('trim', s * 11.2, s * 13.6, 6.1, 8.6, 29, 31); });
  // Chamber block (wider part of the south wing) and the lower south end bay.
  block(-14.8, 14.8, 20, 40.5, 24.5);
  both((s) => roofSlab(s * 13, s * 14.8, 20, 40.5, 24.5));
  block(-9.7, 9.7, 44.5, 48.6, 23.5);
  roofSlab(-9.7, 9.7, 44.5, 48.6, 23.5);
  rail(-9.7, 48.6, 9.7, 48.6, 23.5); rail(-13, 44.5, 13, 44.5, 24.5);
  both((s) => {
    rail(s * 9.7, 44.5, s * 9.7, 48.6, 23.5);
    rail(s * 13, 0.7, s * 13, 20, 24.5); rail(s * 13, 20, s * 14.8, 20, 24.5);
    rail(s * 14.8, 20, s * 14.8, 40.5, 24.5); rail(s * 14.8, 40.5, s * 13, 40.5, 24.5);
    rail(s * 13, 40.5, s * 13, 44.5, 24.5);
  });
  // East and west wings, their end pavilions and the narrow end bays.
  both((s) => {
    block(Math.min(s * 13, s * 31.4), Math.max(s * 13, s * 31.4), -17.75, 0.7, 24.5);
    roofSlab(Math.min(s * 13, s * 31.4), Math.max(s * 13, s * 31.4), -17.75, 0.7, 24.5);
    rail(s * 13, -17.75, s * 31.4, -17.75, 24.5); rail(s * 13, 0.7, s * 31.4, 0.7, 24.5);
    block(Math.min(s * 31.4, s * 47.3), Math.max(s * 31.4, s * 47.3), -20, 8.2, 26.5);
    roofSlab(Math.min(s * 31.4, s * 47.3), Math.max(s * 31.4, s * 47.3), -20, 8.2, 26.5);
    rail(s * 31.4, -20, s * 47.3, -20, 26.5); rail(s * 31.4, 8.2, s * 47.3, 8.2, 26.5);
    rail(s * 47.3, -20, s * 47.3, 8.2, 26.5); rail(s * 31.4, -20, s * 31.4, 8.2, 26.5);
    block(Math.min(s * 47.3, s * 51.6), Math.max(s * 47.3, s * 51.6), -13.2, 0.5, 23.5);
    roofSlab(Math.min(s * 47.3, s * 51.6), Math.max(s * 47.3, s * 51.6), -13.2, 0.5, 23.5);
    rail(s * 47.3, -13.2, s * 51.6, -13.2, 23.5); rail(s * 47.3, 0.5, s * 51.6, 0.5, 23.5);
    rail(s * 51.6, -13.2, s * 51.6, 0.5, 23.5);
  });

  // --- windows and pilasters, facade by facade ------------------------------------------
  both((s) => {
    // north faces
    facade(s * 13, -17.75, s * 31.4, -17.75, 0, -1);
    facade(s * 31.4, -20, s * 47.3, -20, 0, -1);
    facade(s * 47.3, -13.2, s * 51.6, -13.2, 0, -1);
    // south faces
    facade(s * 13, 0.7, s * 31.4, 0.7, 0, 1);
    facade(s * 31.4, 8.2, s * 47.3, 8.2, 0, 1);
    facade(s * 47.3, 0.5, s * 51.6, 0.5, 0, 1);
    // outer ends
    facade(s * 47.3, -20, s * 47.3, -13.2, s, 0);
    facade(s * 47.3, 0.5, s * 47.3, 8.2, s, 0);
    facade(s * 51.6, -13.2, s * 51.6, 0.5, s, 0);
    // the long south wing
    facade(s * 13, 8.2, s * 13, 20, s, 0);
    facade(s * 14.8, 20, s * 14.8, 40.5, s, 0);
    facade(s * 13, 40.5, s * 13, 44.5, s, 0);
    facade(s * 9.7, 44.5, s * 9.7, 48.6, s, 0);
  });
  facade(-9.7, 48.6, 9.7, 48.6, 0, 1);
  // small attic windows on the central block's flanks above the wing roofs
  both((s) => { for (const z of [-13, -8, -3, 2]) place(rectWin(1.6, 25.3, 27.0), s * 13, z, s, 0); });

  // --- north portico: granite podium, stairs, eight giant columns, pediment ---------------
  box('granite', -12, 12, -28.6, -17.75, -4, 5.5);
  for (let k = 0; k < 5; k++) box('granite', -12.6, 12.6, -36.2 + 1.52 * k, -28.6, -1.5, DECK + 0.3 * (k + 1));
  for (const x of [0, -4.3, 4.3]) place(T.door, x, -28.6, 0, -1, 'door');
  for (const x of [-9.2, 9.2]) place(T.ground, x, -28.6, 0, -1);
  const colX = [1.9, 5.0, 8.0, 11.0];
  const column = (x, z) => {
    box('trim', x - 0.95, x + 0.95, z - 0.95, z + 0.95, 5.5, 6.1);
    cyl('trim', x, z, 0.7, 6.1, 18.2, 12, true);
    box('trim', x - 1.0, x + 1.0, z - 1.0, z + 1.0, 18.2, 19.6);
  };
  both((s) => { for (const x of colX) column(s * x, -26.4); column(s * 11.0, -22.4); });
  box('trim', -12.6, 12.6, -28.0, -17.75, 19.6, 21.6); // entablature
  box('trim', -12.6, 12.6, -28.0, -17.75, 21.6, 21.9);
  {
    const sh = new THREE.Shape([new THREE.Vector2(-13.2, 21.6), new THREE.Vector2(13.2, 21.6), new THREE.Vector2(0, 26.0)]);
    const ped = mergeVertices(new THREE.ExtrudeGeometry(sh, { depth: 3.6, bevelEnabled: false })).translate(0, 0, -28.3);
    add('sand', ped);
    // raking cornice and a crest block in the tympanum (the coat of arms stands here)
    const rake = (sx) => add('trim', new THREE.BoxGeometry(14.2, 0.5, 0.6).rotateZ(sx * Math.atan2(4.4, 13.2)).translate(sx * -6.6, 24.05, -28.4));
    rake(1); rake(-1);
    box('trim', -1.8, 1.8, -28.5, -28.2, 22.0, 24.2);
  }

  // --- the major dome over the rotunda ----------------------------------------------------
  const DZ = -6.5; // dome centre (over the rotunda, mid-way along the crossbar)
  box('sand', -11.5, 11.5, DZ - 11.5, DZ + 11.5, 29, 31.5);
  both((s) => { box('trim', s * 9, s * 12, DZ - 12, DZ - 9, 29, 32.6); box('trim', s * 9, s * 12, DZ + 9, DZ + 12, 29, 32.6); });
  cyl('sand', 0, DZ, 9.5, 31.5, 41.5, 24);
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    cyl('trim', Math.sin(a) * 10.15, DZ + Math.cos(a) * 10.15, 0.42, 32.2, 40.6, 8, true);
    if (k % 2 === 0) {
      const b = a + Math.PI / 16;
      place(T.drum, Math.sin(b) * 9.5, DZ + Math.cos(b) * 9.5, Math.sin(b), Math.cos(b));
    }
  }
  cyl('trim', 0, DZ, 10.75, 40.6, 42.0, 24); // entablature ring over the colonnade
  cyl('sand', 0, DZ, 9.1, 42.0, 43.3, 24); // collar
  add('terra', new THREE.SphereGeometry(9.7, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 43.3, DZ));
  for (let k = 0; k < 8; k++) {
    add('trim', new THREE.TorusGeometry(9.8, 0.24, 3, 8, Math.PI / 2).rotateY((k * Math.PI) / 4).translate(0, 43.3, DZ));
  }
  // lantern
  cyl('trim', 0, DZ, 2.7, 52.6, 53.2, 12);
  cyl('sand', 0, DZ, 1.9, 53.2, 55.4, 12);
  for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; cyl('trim', Math.sin(a) * 2.1, DZ + Math.cos(a) * 2.1, 0.22, 53.2, 55.4, 6, true); }
  add('terra', new THREE.SphereGeometry(2.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 55.4, DZ));
  cyl('trim', 0, DZ, 0.12, 56.5, 57.3, 6, true);

  // --- the minor dome: a low saucer over the Chamber in the south wing ---------------------
  // 16 m across, rising 6 m above the roof: sphere radius 8.33, centre 2.33 m below the roof.
  const MZ = 30.25;
  add('terra', new THREE.SphereGeometry(8.33, 20, 6, 0, Math.PI * 2, 0, Math.acos(2.33 / 8.33)).translate(0, 24.5 - 2.33, MZ));
  cyl('sand', 0, MZ, 1.3, 30.3, 32.3, 10);
  add('terra', new THREE.SphereGeometry(1.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(0, 32.3, MZ));

  // =============================== THE GROUNDS ===========================================
  // Paved terrace under the building and the long plaza deck north of the stairs. The deck
  // bridges the 97 Avenue tunnel, which the map draws at grade.
  // The terrace follows the building, with its south corners cut back on the diagonal like
  // the lawns so the ring road (which the home route drives) stays clear.
  {
    const T = [[-54.6, -23], [54.6, -23], [54.6, 20], [51, 24.5], [47, 29.5], [42, 35], [35, 41], [29, 44], [22, 47.5],
      [-22, 47.5], [-29, 44], [-35, 41], [-42, 35], [-47, 29.5], [-51, 24.5], [-54.6, 20]];
    const sh = new THREE.Shape(T.map(([x, z]) => new THREE.Vector2(x, -z)));
    add('pave', mergeVertices(new THREE.ExtrudeGeometry(sh, { depth: 1.65, bevelEnabled: false })).rotateX(-Math.PI / 2).translate(0, -1.5, 0));
  }
  box('pave', -24, 24, -145, -23, -1.5, DECK);
  // 97 Ave really runs in a tunnel under the plaza, but the game drives it at plaza level, so
  // a custom route along it must not meet the pools or the jets: any that the driven road
  // passes through (ctx.route, see _example.js) is left out. Built-in routes never pass here.
  const onDriven = (x0, x1, z0, z1) => {
    if (!ctx.route) return false;
    for (let x = x0; x <= x1 + 1e-6; x += 1.5) {
      for (let z = z0; z <= z1 + 1e-6; z += 1.5) {
        const r = ctx.route(x + AX, z);
        if (r && !r.beyond && Math.abs(r.y - DECK) < 4 && r.lat > r.left - 0.5 && r.lat < r.right + 0.5) return true;
      }
    }
    return false;
  };
  // Reflecting pools with a raised stone coping; fountain jets in the near pool.
  const pool = (z0, z1) => {
    const y0 = DECK, y1 = DECK + 0.45;
    box('coping', -9.3, 9.3, z0 - 0.5, z0, y0, y1); box('coping', -9.3, 9.3, z1, z1 + 0.5, y0, y1);
    box('coping', -9.3, -8.8, z0, z1, y0, y1); box('coping', 8.8, 9.3, z0, z1, y0, y1);
    add('water', new THREE.PlaneGeometry(17.6, z1 - z0).rotateX(-Math.PI / 2).translate(0, y1 - 0.12, (z0 + z1) / 2));
  };
  for (const [z0, z1] of [[-110, -52.3], [-136.1, -118.7]]) if (!onDriven(-9.3, 9.3, z0 - 0.5, z1 + 0.5)) pool(z0, z1);
  for (const z of [-60, -70, -80, -90, -100]) if (!onDriven(-0.3, 0.3, z - 0.3, z + 0.3)) cyl('jet', 0, z, 0.2, DECK + 0.3, DECK + 2.1, 6, true, 0.1);
  // Lawns: the four garden quadrants around the building (polygons from OSM, inset so the
  // ring road around the grounds stays clear). Shape x = east, shape y = -z (north).
  const lawn = (pts) => {
    const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = mergeVertices(new THREE.ExtrudeGeometry(sh, { depth: 1.9, bevelEnabled: false })).rotateX(-Math.PI / 2).translate(0, -1.5, 0);
    add('lawn', geo);
  };
  both((s) => {
    lawn([[s * 16, -22.5], [s * 49, -22.5], [s * 49, -32.5], [s * 16, -32.5]]);
    lawn([[s * 27, 21.5], [s * 27, 42], [s * 29, 44], [s * 35, 41], [s * 42, 35], [s * 47, 29.5], [s * 51, 24.5], [s * 51, 21.5]]);
  });

  // --- merge everything -------------------------------------------------------------------
  const finish = { glass: 'glass', water: 'glass', terra: 'glossy', jet: 'glossy' };
  const flat = new Set(['glass', 'door', 'water']); // single quads: show them from both sides
  for (const [key, geos] of bins) {
    const geo = mergeGeometries(geos, false);
    const mat = ctx.mat(C[key], finish[key] ?? 'matte', flat.has(key) ? { side: THREE.DoubleSide } : undefined);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `legislature:${key}`;
    g.add(mesh);
  }

  // --- trees: spruce rows beside the plaza, golden elms on the lawns (instanced) ----------
  const colored = (geo, hex) => {
    const c = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  };
  const bark = 0x5a4634;
  const spruceGeo = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.22, 0.34, 2.4, 5, 1, true).translate(0, 0.2, 0), bark),
    colored(new THREE.ConeGeometry(2.4, 5.2, 7, 1, true).translate(0, 3.4, 0), 0x2f5a3c),
    colored(new THREE.ConeGeometry(1.75, 5.0, 7, 1, true).translate(0, 6.9, 0), 0x35634a),
    colored(new THREE.ConeGeometry(1.05, 3.4, 7, 1, true).translate(0, 9.9, 0), 0x3a6a4d),
  ]);
  const goldGeo = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.28, 0.4, 3.6, 5, 1, true).translate(0, 0.8, 0).toNonIndexed(), bark),
    colored(new THREE.DodecahedronGeometry(3.0, 0).scale(1, 1.15, 1).translate(0, 5.9, 0), 0xd9a03a),
  ]);
  const treeMat = ctx.mat(0xffffff, 'matte', { vertexColors: true });
  const spruce = [], gold = [];
  for (const s of [1, -1]) {
    for (const z of [-47, -53, -59]) spruce.push([s * 29.5, z]);
    for (const z of [-98, -104.5, -111, -117.5, -124, -130.5, -137]) spruce.push([s * 29.5, z]);
    gold.push([s * 36, -50], [s * 36, -103], [s * 36, -133]);
    spruce.push([s * 44, -28], [s * 20, -28]);
    gold.push([s * 32, -28]);
    spruce.push([s * 31, 38], [s * 44, 31], [s * 37, 25.5]);
    gold.push([s * 30, 26], [s * 47, 24]);
  }
  const plant = (geo, all, baseScale) => {
    const list = all.filter(([x, z]) => !ctx.onRoad?.(x + AX, z)); // g is shifted by AX
    const im = new THREE.InstancedMesh(geo, treeMat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    list.forEach(([x, z], i) => {
      const h = ((x * 7.3 + z * 3.1) % 1 + 1) % 1; // deterministic jitter
      const k = baseScale * (0.88 + 0.24 * h);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h * Math.PI * 2);
      m.compose(p.set(x, 0, z), q, sc.set(k, k * (0.95 + 0.1 * h), k));
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.name = 'legislature:trees';
    g.add(im);
  };
  plant(spruceGeo, spruce, 1);
  plant(goldGeo, gold, 1);

  return root;
}
