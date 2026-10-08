import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// CPKC Edmonton intermodal terminal: a flat 303 m (east-west) x 545 m (north-south) yard.
// West side: three loading tracks with a double-stack train under rail-mounted gantry
// cranes. Middle: long north-south blocks of stacked containers. East side: trucks and
// chassis parked in rows. Origin = yard centre; the yard is flat so nothing needs ctx.ground.
export const sink = 0;

const HALF_W = 151, HALF_D = 272;
const CL = 12.2, CW = 2.44, CH = 2.59; // a 40 ft container
const COLORS = [0xb23a2e, 0x1f4e8a, 0xd9772b, 0x7c8288, 0x2f6b4a, 0x6b2f2f, 0xc9c3b5, 0x1f4e8a, 0xb23a2e];

// Small deterministic random so the yard looks the same every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

// Corrugated side panels: light and dark vertical ribs, tinted by each container's colour.
function ribTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#c8c8c8' : '#ffffff';
    g.fillRect(i * 4, 0, 4, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function build(ctx) {
  const g = new THREE.Group();
  const rand = rng(1907);
  const slots = []; // [x, y, z, colour]

  // Yard surface: gravel with paved lanes.
  const pad = new THREE.Mesh(box(HALF_W * 2, 0.12, HALF_D * 2, 0, 0, 0), ctx.mat(0x8f8a80));
  const laneGeos = [];
  for (const x of [-85, -50, 2, 54]) laneGeos.push(box(10, 0.05, HALF_D * 2 - 8, x, 0.12, 0));
  for (const z of [-180, -60, 60, 180]) laneGeos.push(box(HALF_W * 2 - 8, 0.05, 9, 0, 0.12, z));
  const lanes = new THREE.Mesh(mergeGeometries(laneGeos), ctx.mat(0x5b5b5e));

  // Loading tracks: ballast, ties shown as a darker strip, two steel rails each.
  const TRACKS = [-130, -121, -112];
  const ballast = [], rails = [];
  for (const x of TRACKS) {
    ballast.push(box(4.2, 0.25, HALF_D * 2 - 10, x, 0.05, 0));
    for (const o of [-0.72, 0.72]) rails.push(box(0.12, 0.18, HALF_D * 2 - 10, x + o, 0.3, 0));
  }
  // Double-stack well cars on two of the tracks, with gaps between cuts of cars.
  const railCarGeos = [];
  for (const x of [-130, -112]) {
    for (let z = -240; z < 240; z += 21) {
      if (rand() < 0.18) continue;
      railCarGeos.push(box(2.9, 0.9, 19.5, x, 0.9, z)); // well car frame
      slots.push([x, 1.0, z - 3.3, 0], [x, 1.0, z + 3.3, 0]);
      if (rand() < 0.8) slots.push([x, 1.0 + CH, z, 0]); // second tier
    }
  }

  // Stacking blocks: rows of containers 1-4 high, a few empty ground slots.
  const BLOCKS = [[-100, 6], [-74, 7], [-38, 10], [12, 10]]; // [west edge x, rows]
  for (const [x0, rows] of BLOCKS) {
    for (let r = 0; r < rows; r++) {
      const x = x0 + r * (CW + 0.35) + CW / 2;
      for (let z = -HALF_D + 14; z < HALF_D - 14; z += CL + 0.6) {
        if ([-180, -60, 60, 180].some((lz) => Math.abs(z - lz) < 11)) continue; // cross lanes
        const roll = rand();
        const high = roll < 0.12 ? 0 : roll < 0.3 ? 1 : roll < 0.65 ? 2 : roll < 0.92 ? 3 : 4;
        for (let k = 0; k < high; k++) slots.push([x, 0.12 + k * CH, z, 0]);
      }
    }
  }

  // Trucks with containers on chassis, parked nose-north in the east lot.
  const truckGeos = [], cabGeos = [], wheelGeos = [];
  const truck = (x, z, loaded) => {
    truckGeos.push(box(2.5, 0.35, 13, x, 1.05, z + 1));               // chassis
    cabGeos.push(box(2.5, 2.9, 3.2, x, 0.9, z - 7.3));                 // cab
    cabGeos.push(box(2.5, 1.2, 1.4, x, 0.9, z - 9.5));                 // hood
    for (const wz of [z - 8.5, z - 5.6, z + 4.5, z + 6]) wheelGeos.push(box(2.6, 1.0, 1.0, x, 0, wz));
    if (loaded) slots.push([x, 1.4, z + 1, 0]);
  };
  for (let r = 0; r < 6; r++) {
    for (let z = -230; z < 230; z += 34) {
      if (rand() < 0.35) continue;
      truck(78 + r * 11, z, rand() < 0.8);
    }
  }
  // A few trucks moving along the lanes.
  truck(54, -120, true); truck(54, 95, true); truck(-50, 20, false); truck(2, -210, true);

  // Instanced containers in mixed colours.
  const cgeo = new THREE.BoxGeometry(CW, CH, CL).translate(0, CH / 2, 0);
  // Ribs run across the long sides; scale UVs so each side shows ~30 ribs.
  const uv = cgeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 2);
  const cmat = new THREE.MeshStandardMaterial({ map: ribTexture(), roughness: 0.75, metalness: 0.15 });
  const containers = new THREE.InstancedMesh(cgeo, cmat, slots.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  slots.forEach(([x, y, z], i) => {
    m.makeTranslation(x, y, z);
    containers.setMatrixAt(i, m);
    containers.setColorAt(i, col.setHex(COLORS[Math.floor(rand() * COLORS.length)]));
  });
  containers.instanceMatrix.needsUpdate = true;

  // Rail-mounted gantry cranes straddling the tracks and the first block.
  const craneGeos = [], trolleyGeos = [];
  const X0 = -137, X1 = -82, TOP = 20;
  for (const zc of [-150, 10, 165]) {
    for (const x of [X0, X1]) {
      for (const dz of [-7, 7]) craneGeos.push(box(1.2, TOP, 1.2, x, 0, zc + dz)); // legs
      craneGeos.push(box(1.6, 1.4, 17, x, 0.3, zc));                              // sill beam
      craneGeos.push(box(1.2, 1.2, 15, x, TOP - 3.5, zc));                        // portal tie
    }
    for (const dz of [-6.2, 6.2]) craneGeos.push(box(X1 - X0 + 12, 2.2, 1.6, (X0 + X1) / 2, TOP, zc + dz)); // girders
    const tx = X0 + 12 + ((zc + 150) % 30);
    trolleyGeos.push(box(5, 3, 14, tx, TOP - 0.6, zc));                              // trolley
    trolleyGeos.push(box(0.25, 9, 0.25, tx - 1.2, TOP - 9.6, zc), box(0.25, 9, 0.25, tx + 1.2, TOP - 9.6, zc)); // hoist ropes
    trolleyGeos.push(box(2.8, 0.6, 12.6, tx, TOP - 10.2, zc));                       // spreader
  }

  // Floodlight masts.
  const mastGeos = [], lampGeos = [];
  for (const [x, z] of [[-90, -240], [-90, 0], [-90, 240], [45, -120], [45, 120]]) {
    mastGeos.push(new THREE.CylinderGeometry(0.35, 0.6, 30, 8).translate(x, 15, z));
    lampGeos.push(box(4, 1.2, 1.6, x, 30, z));
  }

  // Perimeter fence: a low dark band reads as chain-link from the road.
  const fenceGeos = [];
  for (const s of [-1, 1]) {
    fenceGeos.push(box(0.08, 2.4, HALF_D * 2, s * HALF_W, 0, 0));
    fenceGeos.push(box(HALF_W * 2, 2.4, 0.08, 0, 0, s * HALF_D));
  }

  g.add(
    pad, lanes, containers,
    new THREE.Mesh(mergeGeometries(ballast), ctx.mat(0x4a4540)),
    new THREE.Mesh(mergeGeometries(rails), ctx.mat(0x9a9ea3, 'metal')),
    new THREE.Mesh(mergeGeometries(railCarGeos), ctx.mat(0x3a302a)),
    new THREE.Mesh(mergeGeometries(craneGeos), ctx.mat(0xe8a21a, 'glossy')),
    new THREE.Mesh(mergeGeometries(trolleyGeos), ctx.mat(0x3b3f45)),
    new THREE.Mesh(mergeGeometries(truckGeos), ctx.mat(0x2b2b2e)),
    new THREE.Mesh(mergeGeometries(cabGeos), ctx.mat(0xe9e6df, 'glossy')),
    new THREE.Mesh(mergeGeometries(wheelGeos), ctx.mat(0x1a1a1a)),
    new THREE.Mesh(mergeGeometries(mastGeos), ctx.mat(0x9a9ea3, 'metal')),
    new THREE.Mesh(mergeGeometries(lampGeos), ctx.mat(0xfff3cf, 'glow')),
    new THREE.Mesh(mergeGeometries(fenceGeos), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.9, transparent: true, opacity: 0.55 })),
  );
  return g;
}
