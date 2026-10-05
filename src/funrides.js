import * as THREE from 'three';
import { makeRider, sharedCarMaterials, getCarEnvMap, softShadow } from './cars.js';

// Fun rides: silly vehicles built from simple shapes (boxes, spheres, cylinders…).
// Each design is a list of parts in metres; y is up, the front faces -z.
// buildFun() scales it to a rideable size and adds wheels (or a hover pad), a rider,
// and tail lights.

// Rocket parts, in metres (size [1, 1, 1]); all point their nose along -z.
const ogive = (y) => {
  // Body radius at height y along a 4.2 m rocket (tail at -2.1, nose tip at +2.1).
  if (y < -1.9) return 0.44 + (y + 2.1) * 0.4;
  if (y < 0.5) return 0.52;
  const t = (y - 0.5) / 1.6;
  return 0.52 * Math.sqrt(Math.max(0, 1 - t * t));
};
const latheSection = (y0, y1, steps = 14) => {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    pts.push(new THREE.Vector2(Math.max(0.001, ogive(y)), y));
  }
  return pts;
};
function rocketGeos() {
  const toZ = (g) => g.rotateX(-Math.PI / 2); // lathe axis (+y) → forward (-z)
  const body = toZ(new THREE.LatheGeometry([new THREE.Vector2(0.001, -2.1), ...latheSection(-2.1, 0.75)], 32));
  const nose = toZ(new THREE.LatheGeometry([...latheSection(0.75, 2.1, 18)], 32));
  const band = toZ(new THREE.LatheGeometry([new THREE.Vector2(0.535, -0.05), new THREE.Vector2(0.545, 0), new THREE.Vector2(0.545, 0.14), new THREE.Vector2(0.535, 0.19)], 32));
  const nozzle = toZ(new THREE.LatheGeometry([
    new THREE.Vector2(0.3, 0.05), new THREE.Vector2(0.34, -0.12), new THREE.Vector2(0.44, -0.5), new THREE.Vector2(0.47, -0.56),
    new THREE.Vector2(0.43, -0.56), new THREE.Vector2(0.3, -0.16), new THREE.Vector2(0.2, 0.05),
  ], 28));
  // Swept fin: root along the body (from z=0.5 back to 2.05), tip swept back and out to 1.25 m.
  const fs = new THREE.Shape();
  fs.moveTo(0.5, 0.4);
  fs.lineTo(1.65, 1.25);
  fs.lineTo(2.2, 1.25);
  fs.lineTo(2.05, 0.4);
  fs.closePath();
  const fin = new THREE.ExtrudeGeometry(fs, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.03, bevelSegments: 2 });
  fin.translate(0, 0, -0.035).rotateY(-Math.PI / 2); // shape x → +z (back), shape y → up
  const flame = new THREE.ConeGeometry(0.36, 1.6, 20, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.8);
  const core = new THREE.ConeGeometry(0.2, 0.95, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.47);
  const porthole = new THREE.TorusGeometry(0.17, 0.035, 8, 24).rotateY(Math.PI / 2);
  const glass = new THREE.CircleGeometry(0.15, 20).rotateY(Math.PI / 2);
  // Curved windscreen in front of the rider.
  const screen = new THREE.CylinderGeometry(0.34, 0.3, 0.3, 16, 1, true, Math.PI - 0.95, 1.9).rotateX(-0.25);
  return { body, nose, band, nozzle, fin, flame, core, porthole, glass, screen };
}

// Unit shapes, each filling a 1×1×1 box before scaling.
const GEOS = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 24, 16),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
  cone: new THREE.ConeGeometry(0.5, 1, 24),
  torus: new THREE.TorusGeometry(0.35, 0.15, 14, 36),
  capsule: new THREE.CapsuleGeometry(0.25, 0.5, 8, 16).scale(2, 1, 2),
  ...Object.fromEntries(Object.entries(rocketGeos()).map(([k, g]) => [`rocket_${k}`, g])),
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const matCache = new Map();
function materialFor(color, finish) {
  const key = `${color}|${finish}`;
  if (matCache.has(key)) return matCache.get(key);
  const envMap = getCarEnvMap();
  let m;
  switch (finish) {
    case 'glossy':
      m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, envMap, envMapIntensity: 0.6 });
      break;
    case 'metal':
      m = new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.25, envMap });
      break;
    case 'glass':
      m = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.05, transparent: true, opacity: 0.7, envMap });
      break;
    case 'glow':
      m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 });
      break;
    case 'flame':
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      break;
    case 'metal2':
      m = new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.3, envMap, side: THREE.DoubleSide });
      break;
    case 'glass2':
      m = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.05, transparent: true, opacity: 0.45, envMap, side: THREE.DoubleSide, depthWrite: false });
      break;
    default:
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  }
  matCache.set(key, m);
  return m;
}

// Drop a point straight down onto the body so the rider sits on it.
function seatOnSurface(vehicle, body, top, z) {
  vehicle.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, top + 2, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObjects(body.children.filter((m) => !m.material.transparent), false)[0];
  return new THREE.Vector3(0, (hit ? hit.point.y : top) - 0.05, z);
}

export function buildFun(spec) {
  const { tireMat, rimMat } = sharedCarMaterials();
  const vehicle = new THREE.Group();
  const body = new THREE.Group();
  const d = THREE.MathUtils.degToRad;
  for (const [shape, size, pos, color, finish = 'matte', rot = [0, 0, 0]] of spec.parts) {
    const mesh = new THREE.Mesh(GEOS[shape], materialFor(color, finish));
    mesh.scale.set(...size);
    mesh.position.set(...pos);
    mesh.rotation.set(d(rot[0]), d(rot[1]), d(rot[2]));
    body.add(mesh);
  }
  vehicle.add(body);

  // Scale to a rideable size, then centre it and stand it on its wheels (or hover pad).
  // Glowing flames don't count towards the size.
  const solid = () => {
    const b = new THREE.Box3();
    body.updateMatrixWorld(true);
    for (const m of body.children) if (m.material.blending !== THREE.AdditiveBlending) b.expandByObject(m);
    return b;
  };
  let box = solid();
  let size = box.getSize(new THREE.Vector3());
  let k = 1;
  const longest = Math.max(size.x, size.z);
  if (longest > 6) k = 6 / longest;
  if (longest < 1.6) k = 1.6 / longest;
  if (size.x * k > 2.6) k = 2.6 / size.x;
  if (size.y * k > 4) k = Math.min(k, 4 / size.y);
  body.scale.setScalar(k);
  box = solid();
  size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const wheelR = spec.wheels ? clamp(size.y * 0.16, 0.24, 0.42) : 0;
  const lift = spec.wheels ? wheelR * 1.1 : 0.4;
  body.position.set(-center.x, lift - box.min.y, -center.z);
  const len = size.z;
  const width = size.x;
  const top = lift + size.y;

  const wheels = [];
  if (spec.wheels) {
    const tire = new THREE.CylinderGeometry(wheelR, wheelR, 0.28, 20).rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, 0.3, 12).rotateZ(Math.PI / 2);
    for (const zs of [-1, 1]) {
      for (const xs of [-1, 1]) {
        const w = new THREE.Group();
        w.add(new THREE.Mesh(tire, tireMat), new THREE.Mesh(rim, rimMat));
        w.position.set(xs * (width / 2 - 0.05), wheelR, zs * Math.max(0.4, len / 2 - wheelR * 1.3));
        vehicle.add(w);
        wheels.push(w);
      }
    }
  } else if (spec.pad !== false) {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(width, len) * 0.35, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x5fd4ff, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    pad.position.y = 0.06;
    vehicle.add(pad);
  }

  const tail = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.6 });
  for (const s of spec.lights === false ? [] : [-1, 1]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.05), tail);
    light.position.set(s * width * 0.3, lift + size.y * 0.3, len / 2 + 0.03);
    vehicle.add(light);
  }

  const seat = seatOnSurface(vehicle, body, top, spec.seatZ ?? len * 0.08);
  const { rider } = makeRider(seat, seat.clone().add(new THREE.Vector3(0, 0.25, -0.55)));
  vehicle.add(rider);

  vehicle.add(softShadow(width * 1.3, len * 1.15, spec.wheels ? 0.6 : 0.4));

  vehicle.rotation.order = 'YXZ';
  vehicle.userData = {
    bodyMat: new THREE.MeshStandardMaterial(), tailMat: tail, wheels, rider,
    len: Math.max(1.2, len), width: Math.max(0.6, width), wheelR: wheelR || 0.3,
  };
  return vehicle;
}

// ---------- designs ----------
// Each part: [shape, [sx, sy, sz], [x, y, z], colour, finish, [rotX, rotY, rotZ] degrees]


const fries = [
  [-0.6, -0.8, 20, -15], [-0.2, -0.9, -10, 10], [0.3, -0.85, 15, 20], [0.65, -0.6, -20, -10],
  [-0.65, 0.0, 10, 25], [0.6, 0.1, -15, -25], [-0.4, 0.7, -20, 10], [0.1, 0.85, 15, -10],
  [0.55, 0.75, -10, 15], [-0.1, -0.3, 25, 5], [0.2, 0.3, -25, -5], [-0.35, 0.35, 5, -30],
  [-0.7, -0.35, -15, 30], [0.75, -0.2, 20, -20], [-0.15, 0.95, -25, -15], [0.4, -0.15, 10, 35],
  [-0.5, -1.0, 30, 10], [0.0, 0.55, -5, 25],
];
const curds = [[-0.4, -0.5], [0.3, -0.3], [-0.1, 0.1], [0.45, 0.4], [-0.5, 0.45], [0.1, -0.7], [0.2, 0.75]];

const OILERS_BLUE = '#0a3a8c';
const OILERS_ORANGE = '#ff4c00';

export const FUN_RIDES = {
  poutine: {
    name: 'Poutine', desc: 'Gravy-powered. Extra sticky in corners',
    stats: { top: 0.9, accel: 0.9, grip: 1.25 },
    spec: {
      wheels: true,
      parts: [
        ['box', [1.8, 0.55, 2.4], [0, 0.3, 0], '#d8352a'],
        ['box', [1.84, 0.08, 2.44], [0, 0.56, 0], '#ffffff'],
        ['box', [1.84, 0.08, 2.44], [0, 0.14, 0], '#ffffff'],
        ...fries.map(([x, z, rx, rz]) => ['box', [0.075, 0.8, 0.075], [x, 0.78, z], '#f4c542', 'matte', [rx, 0, rz]]),
        ['sphere', [1.6, 0.3, 2.1], [0, 0.72, 0], '#6b3e1f', 'glossy'],
        ['sphere', [0.9, 0.25, 0.9], [0.2, 0.85, 0.2], '#7a4622', 'glossy'],
        ...curds.map(([x, z]) => ['sphere', [0.24, 0.18, 0.22], [x, 0.9, z], '#fff4d6']),
      ],
    },
  },
  oilers: {
    name: 'Oilers Jersey', desc: 'Go Oilers! Hovers on pure hockey spirit',
    stats: { top: 1.15, accel: 1.1, grip: 1.0 },
    spec: {
      wheels: false,
      seatZ: 0.3,
      parts: [
        ['box', [1.6, 0.12, 2.0], [0, 0.5, 0], OILERS_BLUE],
        ['box', [0.9, 0.12, 0.6], [-1.1, 0.5, -0.55], OILERS_BLUE, 'matte', [0, 20, 0]],
        ['box', [0.9, 0.12, 0.6], [1.1, 0.5, -0.55], OILERS_BLUE, 'matte', [0, -20, 0]],
        ['box', [0.2, 0.13, 0.62], [-1.42, 0.5, -0.43], OILERS_ORANGE, 'matte', [0, 20, 0]],
        ['box', [0.2, 0.13, 0.62], [1.42, 0.5, -0.43], OILERS_ORANGE, 'matte', [0, -20, 0]],
        ['box', [0.05, 0.13, 0.62], [-1.29, 0.5, -0.48], '#ffffff', 'matte', [0, 20, 0]],
        ['box', [0.05, 0.13, 0.62], [1.29, 0.5, -0.48], '#ffffff', 'matte', [0, -20, 0]],
        ['box', [1.62, 0.13, 0.22], [0, 0.5, 0.75], OILERS_ORANGE],
        ['box', [1.62, 0.13, 0.05], [0, 0.5, 0.6], '#ffffff'],
        ['box', [1.62, 0.13, 0.05], [0, 0.5, 0.9], '#ffffff'],
        ['box', [0.55, 0.13, 0.18], [0, 0.5, -0.93], OILERS_ORANGE],
        ['cylinder', [0.75, 0.14, 0.75], [0, 0.5, -0.2], '#ffffff'],
        ['cylinder', [0.6, 0.15, 0.6], [0, 0.5, -0.2], OILERS_ORANGE],
        ['cylinder', [0.38, 0.16, 0.38], [0, 0.5, -0.2], OILERS_BLUE],
      ],
    },
  },
  rogers: {
    name: 'Rogers Place', desc: 'Home of the Oilers, on wheels. Very heavy.', heavy: true,
    stats: { top: 0.75, accel: 0.7, grip: 0.9 },
    spec: {
      wheels: true,
      seatZ: 0.6,
      parts: [
        ['cylinder', [3.6, 1.0, 5.5], [0, 0.5, 0], '#7fb6d9', 'glass'],
        ['cylinder', [3.7, 0.15, 5.6], [0, 1.05, 0], '#2b2e35'],
        ['sphere', [4.2, 1.8, 6.0], [0, 1.1, 0.1], '#c9ced6', 'metal'],
        ['box', [0.1, 0.12, 4.6], [-0.9, 1.9, 0.1], '#9aa1ab', 'metal', [0, 0, 18]],
        ['box', [0.1, 0.12, 4.6], [0.9, 1.9, 0.1], '#9aa1ab', 'metal', [0, 0, -18]],
        ['box', [1.6, 0.1, 0.8], [0, 1.0, -2.95], '#c9ced6', 'metal'],
        ['box', [1.5, 0.6, 0.08], [0, 0.55, -2.8], '#ff7a2a', 'glow', [-10, 0, 0]],
        ['box', [0.05, 0.08, 4.4], [-1.82, 0.85, 0], '#4fa8ff', 'glow'],
        ['box', [0.05, 0.08, 4.4], [1.82, 0.85, 0], '#4fa8ff', 'glow'],
      ],
    },
  },
  rocket: {
    name: 'Rocket', desc: 'Locked: earn every achievement to fly it', heavy: true, locked: true, flame: true, smasher: true, infiniteNitro: true, liftoff: true,
    stats: { top: 1.8, accel: 1.9, grip: 1.6 },
    spec: {
      wheels: false,
      pad: false,
      lights: false,
      seatZ: -0.1,
      parts: [
        ['rocket_body', [1, 1, 1], [0, 0.8, 0], '#f4f4f0', 'glossy'],
        ['rocket_nose', [1, 1, 1], [0, 0.8, 0], '#e0312b', 'glossy'],
        ['rocket_band', [1, 1, 1], [0, 0.8, 1.3], '#e0312b', 'glossy'],
        ['rocket_band', [1, 1, 1], [0, 0.8, -0.35], '#2b2e35', 'metal'],
        ['rocket_nozzle', [1, 1, 1], [0, 0.8, 2.1], '#4a4d52', 'metal2'],
        ['rocket_fin', [1, 1, 1], [0, 0.8, 0], '#e0312b', 'glossy'],
        ['rocket_fin', [1, 1, 1], [0, 0.8, 0], '#e0312b', 'glossy', [0, 0, 120]],
        ['rocket_fin', [1, 1, 1], [0, 0.8, 0], '#e0312b', 'glossy', [0, 0, -120]],
        ['rocket_porthole', [1, 1, 1], [0.51, 0.85, 0.45], '#c9ced6', 'metal'],
        ['rocket_glass', [1, 1, 1], [0.515, 0.85, 0.45], '#5fb7ff', 'glass'],
        ['rocket_porthole', [1, 1, 1], [-0.51, 0.85, 0.45], '#c9ced6', 'metal', [0, 180, 0]],
        ['rocket_glass', [1, 1, 1], [-0.515, 0.85, 0.45], '#5fb7ff', 'glass', [0, 180, 0]],
        ['rocket_screen', [1, 1, 1], [0, 1.42, -0.12], '#bfe6ff', 'glass2'],
        ['rocket_flame', [1, 1, 1], [0, 0.8, 2.6], '#ff7a2a', 'flame'],
        ['rocket_core', [1, 1, 1], [0, 0.8, 2.6], '#fff1a8', 'flame'],
      ],
    },
  },
};
export const FUN_IDS = Object.keys(FUN_RIDES);
