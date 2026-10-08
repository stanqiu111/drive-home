import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Snow Valley ski hill in the Whitemud Creek ravine, at the end of the Snow Valley route.
// The origin is on the valley floor by the lodge. The map's terrain rises about 40 m up the
// west wall of the ravine (x -40 .. -240), so the chairlift climbs west from the lodge to the
// top of that slope, with tree-lined runs either side. Everything that sits on the slope uses
// ctx.ground() so it follows the real terrain; in the landmark studio (flat ground) a
// fitted profile of the same slope is used instead.
export const sink = 0;

// Box/cylinder parts are indexed and hand-built ones aren't; flatten them all so they merge.
function merge(list) {
  return mergeGeometries(list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  }));
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Lift line: bottom terminal by the lodge, top terminal on the rim of the ravine.
const BOTTOM = [-34, -8], TOP = [-292, -26];
const TOWER_T = [38, 80, 122, 164, 206];  // metres along the line
const TOWER_H = [9, 10, 11, 10, 9];

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = '#1d3f73'; g.fillRect(0, 0, 1024, 384);
  g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.strokeRect(18, 18, 988, 348);
  // Mountain glyph.
  g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(60, 300); g.lineTo(170, 110); g.lineTo(230, 210); g.lineTo(270, 160); g.lineTo(350, 300); g.closePath(); g.fill();
  g.fillStyle = '#1d3f73';
  g.beginPath(); g.moveTo(140, 162); g.lineTo(170, 110); g.lineTo(200, 162); g.lineTo(184, 150); g.lineTo(170, 166); g.lineTo(156, 150); g.closePath(); g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 128px Arial, Helvetica, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('SNOW', 390, 135);
  g.fillText('VALLEY', 390, 255);
  g.font = 'bold 44px Arial, Helvetica, sans-serif';
  g.fillStyle = '#f3c64b';
  g.fillText('SKI CLUB', 60, 345 - 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function build(ctx) {
  const g = new THREE.Group();
  const G = (x, z) => ctx.ground?.(x, z) ?? 40 * smooth((-34 - x) / 210);
  const rand = rng(4421);

  const wood = [], stone = [], roofG = [], glass = [], steel = [], cable = [], seats = [], trim = [], poles = [], dark = [];

  // ---- Lodge: two-storey timber chalet with a steep gable roof, long axis north-south.
  {
    const cx = 14, cz = 30, W = 20, D = 40, WALL = 7.2, RISE = 6.5, OVER = 1.2;
    const corners = [[cx - W / 2, cz - D / 2], [cx + W / 2, cz - D / 2], [cx - W / 2, cz + D / 2], [cx + W / 2, cz + D / 2]].map(([x, z]) => G(x, z));
    const lo = Math.min(...corners) - 1.5, floor = Math.max(...corners) + 0.4;
    stone.push(box(W + 0.6, floor - lo + 0.9, D + 0.6, cx, lo, cz));           // stone base
    wood.push(box(W, WALL, D, cx, floor + 0.9, cz));                             // timber walls
    const eave = floor + 0.9 + WALL;
    // Gable roof as an extruded triangle along z.
    const s = new THREE.Shape([new THREE.Vector2(-W / 2 - OVER, 0), new THREE.Vector2(W / 2 + OVER, 0), new THREE.Vector2(0, RISE)]);
    roofG.push(new THREE.ExtrudeGeometry(s, { depth: D + OVER * 2, bevelEnabled: false }).translate(0, 0, -(D + OVER * 2) / 2).translate(cx, eave - 0.2, cz));
    // Gable-end timber infill (slightly inset so the roof overhang shows).
    const gable = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, RISE - 0.6)]);
    for (const zs of [-1, 1]) wood.push(new THREE.ShapeGeometry(gable).rotateY(zs > 0 ? 0 : Math.PI).translate(cx, eave, cz + zs * (D / 2 + 0.02)));
    // Window bands on both long sides; the west side (facing the hill) is mostly glass.
    for (const xs of [-1, 1]) {
      const x = cx + xs * (W / 2 + 0.05);
      const rot = xs > 0 ? Math.PI / 2 : -Math.PI / 2;
      for (let k = 0; k < 8; k++) {
        const z = cz - D / 2 + 3 + k * ((D - 6) / 7);
        glass.push(new THREE.PlaneGeometry(3.2, xs < 0 ? 3.0 : 2.2).rotateY(rot).translate(x, floor + 2.4, z));
        glass.push(new THREE.PlaneGeometry(3.2, 2.0).rotateY(rot).translate(x, floor + 6.0, z));
      }
    }
    // Big gable window on the south end, stone chimney on the north end.
    glass.push(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-5, 0), new THREE.Vector2(5, 0), new THREE.Vector2(0, 4.4)])).translate(cx, eave + 0.4, cz + D / 2 + 0.08));
    stone.push(box(2.6, eave + RISE + 2 - lo, 2.6, cx - 4, lo, cz - D / 2 - 1.0));
    // Deck facing the slope with a railing.
    wood.push(box(6, 0.4, D - 4, cx - W / 2 - 3, floor + 0.5, cz));
    trim.push(box(0.15, 1.1, D - 4, cx - W / 2 - 5.9, floor + 0.9, cz));
    for (let z = cz - D / 2 + 2; z <= cz + D / 2 - 2; z += 4) dark.push(box(0.3, floor + 0.5 - lo + 1.5, 0.3, cx - W / 2 - 5.6, lo, z));
    // Timber corner posts and a ridge beam for some definition.
    for (const [x, z] of [[cx - W / 2, cz - D / 2], [cx + W / 2, cz - D / 2], [cx - W / 2, cz + D / 2], [cx + W / 2, cz + D / 2]]) trim.push(box(0.5, WALL, 0.5, x, floor + 0.9, z));
  }

  // ---- Chairlift.
  const dx = TOP[0] - BOTTOM[0], dz = TOP[1] - BOTTOM[1], LEN = Math.hypot(dx, dz);
  const ux = dx / LEN, uz = dz / LEN, px = -uz, pz = ux; // along the line / across it
  const yaw = Math.atan2(ux, uz);                          // rotates local +z onto the line
  const at = (t, side = 0) => [BOTTOM[0] + ux * t + px * side, BOTTOM[1] + uz * t + pz * side];
  const supports = [{ t: 0, h: 6.5 }, ...TOWER_T.map((t, i) => ({ t, h: TOWER_H[i] })), { t: LEN, h: 6.5 }];
  supports.forEach((s) => { const [x, z] = at(s.t); s.y = G(x, z) + s.h; });

  // Terminals: steel column, bullwheel housing, wheel, concrete pad and a small hut.
  for (const end of [0, LEN]) {
    const [x, z] = at(end);
    const y0 = G(x, z);
    stone.push(box(10, 1.2, 14, x, y0 - 0.8, z).rotateY(0));
    steel.push(new THREE.CylinderGeometry(0.7, 0.9, 6, 10).translate(x, y0 + 3, z));
    const housing = new THREE.BoxGeometry(6.4, 2.4, 9.5).rotateY(yaw).translate(x, y0 + 7.3, z);
    trim.push(housing);
    steel.push(new THREE.CylinderGeometry(2.4, 2.4, 0.4, 20).translate(x, y0 + 6.3, z));
    const [hx, hz] = at(end + (end === 0 ? -9 : 9), 7);
    wood.push(box(4, 3, 4, hx, G(hx, hz) - 0.5, hz));
    roofG.push(new THREE.ConeGeometry(3.4, 1.8, 4).rotateY(Math.PI / 4).translate(hx, G(hx, hz) + 3.4, hz));
  }

  // Towers: tapered column, crossarm, sheave trains at each end.
  for (const s of supports.slice(1, -1)) {
    const [x, z] = at(s.t);
    const y0 = G(x, z) - 0.6;
    stone.push(box(2.2, 1.0, 2.2, x, y0, z));
    steel.push(new THREE.CylinderGeometry(0.38, 0.55, s.y - y0, 8).translate(x, (y0 + s.y) / 2, z));
    steel.push(new THREE.BoxGeometry(5.6, 0.45, 0.5).rotateY(yaw).translate(x, s.y + 0.4, z));
    for (const side of [-2.2, 2.2]) {
      const [sx, sz] = at(s.t, side);
      dark.push(new THREE.BoxGeometry(0.4, 0.5, 3.2).rotateY(yaw).translate(sx, s.y - 0.05, sz));
    }
  }

  // Haul rope on both sides, as straight spans between supports with a little sag.
  const ropeY = (t) => {
    for (let i = 1; i < supports.length; i++) {
      const a = supports[i - 1], b = supports[i];
      if (t <= b.t) {
        const f = (t - a.t) / (b.t - a.t);
        return a.y + (b.y - a.y) * f - Math.sin(f * Math.PI) * 0.6;
      }
    }
    return supports[supports.length - 1].y;
  };
  for (const side of [-2.2, 2.2]) {
    const steps = 48;
    for (let i = 0; i < steps; i++) {
      const t0 = (i / steps) * LEN, t1 = ((i + 1) / steps) * LEN;
      const [x0, z0] = at(t0, side), [x1, z1] = at(t1, side);
      const y0 = ropeY(t0), y1 = ropeY(t1);
      const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
      const len = a.distanceTo(b);
      const seg = new THREE.CylinderGeometry(0.06, 0.06, len, 4, 1, true);
      seg.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())));
      seg.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      cable.push(seg);
    }
  }

  // Chairs: grip and hanger, seat and backrest, every 16 m on each side.
  for (const [side, phase] of [[-2.2, 0], [2.2, 8]]) {
    for (let t = 10 + phase; t < LEN - 8; t += 16) {
      const [x, z] = at(t, side);
      const y = ropeY(t);
      dark.push(box(0.12, 2.4, 0.12, x, y - 2.4, z));
      const seat = new THREE.BoxGeometry(2.0, 0.14, 0.6).rotateY(yaw + Math.PI / 2).translate(x, y - 2.5, z);
      const back = new THREE.BoxGeometry(2.0, 0.7, 0.1).rotateY(yaw + Math.PI / 2).translate(x - px * 0.3 * Math.sign(side), y - 2.1, z - pz * 0.3 * Math.sign(side));
      seats.push(seat, back);
      dark.push(new THREE.BoxGeometry(2.0, 0.06, 0.06).rotateY(yaw + Math.PI / 2).translate(x + px * 0.35 * Math.sign(side), y - 1.6, z + pz * 0.35 * Math.sign(side)));
    }
  }

  // ---- Runs: two open runs either side of the lift line; trees fill the rest of the slope.
  const runs = [
    (x) => -78 + Math.sin((x + 40) / 60) * 10,  // north run, gently winding
    (x) => 48 + (x + 40) * 0.12,                // south run
  ];
  const liftPerp = (x, z) => Math.abs((x - BOTTOM[0]) * px + (z - BOTTOM[1]) * pz);
  const open = (x, z) => liftPerp(x, z) < 14 || Math.abs(z - runs[0](x)) < 24 || Math.abs(z - runs[1](x)) < 26;

  // Run edge marker poles (orange), every 24 m down both edges of each run.
  runs.forEach((f, i) => {
    const half = i === 0 ? 23 : 25;
    for (let x = -280; x <= -50; x += 24) {
      for (const sgn of [-1, 1]) {
        const z = f(x) + sgn * half;
        poles.push(box(0.12, 2.2, 0.12, x, G(x, z) - 0.2, z));
      }
    }
  });

  // Trail map board by the bottom terminal.
  {
    const [x, z] = at(-14, -10);
    const y0 = G(x, z);
    dark.push(box(0.2, 2.2, 0.2, x - 1.6, y0, z), box(0.2, 2.2, 0.2, x + 1.6, y0, z));
    wood.push(box(4, 2.2, 0.2, x, y0 + 2.0, z));
  }

  // Trees: spruce and a few golden aspens on the slope, not on the runs or the lift line.
  const spruce = [], aspen = [];
  for (let x = -315; x <= -46; x += 9) {
    for (let z = -175; z <= 155; z += 9) {
      const jx = x + (rand() - 0.5) * 7, jz = z + (rand() - 0.5) * 7;
      if (open(jx, jz)) continue;
      if (jx > -60 && Math.abs(jz - 30) < 50) continue; // keep the lodge area clear
      if (rand() < 0.25 || ctx.onRoad?.(jx, jz)) continue;
      (rand() < 0.78 ? spruce : aspen).push([jx, G(jx, jz) - 0.3, jz, 0.75 + rand() * 0.6]);
    }
  }
  const spruceGeo = merge([
    new THREE.CylinderGeometry(0.25, 0.35, 2.4, 5).translate(0, 1.2, 0),
    new THREE.ConeGeometry(2.6, 6, 7).translate(0, 4.5, 0),
    new THREE.ConeGeometry(1.9, 5, 7).translate(0, 7.6, 0),
  ]);
  const aspenGeo = merge([
    new THREE.CylinderGeometry(0.2, 0.3, 4, 5).translate(0, 2, 0),
    new THREE.IcosahedronGeometry(2.6, 0).scale(1, 1.4, 1).translate(0, 6.2, 0),
  ]);
  const inst = (geo, mat, list, tints) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    list.forEach(([x, y, z, s], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHex(tints[Math.floor(rand() * tints.length)]));
    });
    return mesh;
  };
  const treeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });

  // ---- Big entrance sign facing cars arriving at the lot (from the north-east).
  {
    const x = 33, z = -38, y0 = G(x, z);
    const face = Math.atan2(0.6, -0.8); // board faces north-east
    for (const o of [-3.6, 3.6]) dark.push(new THREE.BoxGeometry(0.35, 4.2, 0.35).translate(o, 2.1, 0).rotateY(face).translate(x, y0 - 0.3, z));
    trim.push(new THREE.BoxGeometry(9.4, 3.6, 0.3).translate(0, 4.6, -0.2).rotateY(face).translate(x, y0, z));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.375).translate(0, 4.6, 0).rotateY(face).translate(x, y0, z),
      new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.6 }));
    g.add(board);
  }

  g.add(
    new THREE.Mesh(merge(wood), ctx.mat(0xa07a52)),
    new THREE.Mesh(merge(stone), ctx.mat(0x8b8478)),
    new THREE.Mesh(merge(roofG), ctx.mat(0x4e3f35)),
    new THREE.Mesh(merge(glass), ctx.mat(0x2e3c4a, 'glossy')),
    new THREE.Mesh(merge(steel), ctx.mat(0x9a9ea3, 'metal')),
    new THREE.Mesh(merge(cable), ctx.mat(0x2a2a2a)),
    new THREE.Mesh(merge(seats), ctx.mat(0x2456a6, 'glossy')),
    new THREE.Mesh(merge(trim), ctx.mat(0x5a3d2a)),
    new THREE.Mesh(merge(poles), ctx.mat(0xe8642a)),
    new THREE.Mesh(merge(dark), ctx.mat(0x2f2f33)),
    inst(spruceGeo, treeMat, spruce, [0x2f5a3a, 0x355f3c, 0x284d33, 0x3c6a44]),
    inst(aspenGeo, treeMat, aspen, [0xd9a52b, 0xe0b43c, 0xc98e22, 0xb8a03a]),
  );
  return g;
}
