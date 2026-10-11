import * as THREE from 'three';

// Talus Dome (Ball-Nogues Studio, 2011) beside Whitemud Drive at the south-east end of the
// Quesnell Bridge: a hollow pile of nearly 1,000 mirror-polished stainless steel balls of many
// sizes, heaped into two or three merged cone-shaped mounds about 5 m tall, named after the
// rock talus that lay here before the bridge. Footprint from OpenStreetMap (way 582712469,
// about 9 x 10 m); the three mounds, their heights and the ball sizes are from photos. Only the
// outer layer of balls is drawn (as one instanced mesh) over a shaded core.
// Origin = the OSM centroid of the sculpture.
export const sink = 0;

// Mounds: centre, base radius, height.
const MOUNDS = [
  { x: -0.9, z: 2.3, r: 2.7, h: 5.0 },
  { x: -3.1, z: -1.7, r: 2.4, h: 4.0 },
  { x: 1.6, z: -1.6, r: 2.5, h: 4.6 },
];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Height of the pile's surface at (x, z): the highest mound there (rounded cone).
function surface(x, z) {
  let best = -1;
  for (const m of MOUNDS) {
    const d = Math.hypot(x - m.x, z - m.z) / m.r;
    if (d >= 1) continue;
    best = Math.max(best, m.h * (1 - d));
  }
  return best;
}

export function build(ctx) {
  const rand = rng(2011);
  const balls = [];
  // Rings of balls up each mound's surface, packed edge to edge, sizes varied; balls that end up
  // inside a neighbouring mound are dropped (the pile is one merged surface).
  for (const m of MOUNDS) {
    const rings = Math.round(m.h / 0.5);
    for (let k = 0; k <= rings; k++) {
      const t = k / rings, ringR = m.r * (1 - t) * 0.98;
      const y0 = m.h * t;
      const n = Math.max(1, Math.round((2 * Math.PI * ringR) / 0.62));
      const phase = rand() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = phase + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.15;
        const rr = ringR + (rand() - 0.5) * 0.12;
        const x = m.x + Math.cos(a) * rr, z = m.z + Math.sin(a) * rr;
        const y = y0 + (rand() - 0.5) * 0.08;
        if (surface(x, z) > y0 + 0.35) continue; // under another mound
        const r = 0.26 + rand() * 0.16 + (t < 0.15 ? 0.08 : 0) - t * 0.06;
        balls.push([x, y, z, r]);
      }
    }
  }
  // Polished steel: without an environment map in the game, pure metal renders dark, so the
  // balls are a bright glossy grey with a little metal and their own faint sheen.
  const mat = ctx.mat(0xd7dde2, 'glossy', { metalness: 0.45, roughness: 0.18, emissive: 0x30363b });
  // A 20-face ball with smooth normals (round enough at this size, cheap for hundreds of them).
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  const mesh = new THREE.InstancedMesh(geo, mat, balls.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  balls.forEach(([x, y, z, r], i) => {
    const g = ctx.ground(x, z) ?? 0;
    p.set(x, g + y, z);
    s.setScalar(r);
    q.setFromEuler(e.set(rand() * 6.3, rand() * 6.3, 0));
    m4.compose(p, q, s);
    mesh.setMatrixAt(i, m4);
  });
  mesh.computeBoundingSphere();
  const group = new THREE.Group();
  group.add(mesh);
  // A shaded core inside each mound, so the gaps between balls look like more steel in shadow.
  const coreMat = ctx.mat(0x6f767c, 'glossy', { metalness: 0.4, roughness: 0.3 });
  for (const m of MOUNDS) {
    const g = ctx.ground(m.x, m.z) ?? 0;
    const core = new THREE.Mesh(new THREE.ConeGeometry(m.r * 0.93, m.h * 0.93, 14, 1, true).translate(m.x, g + (m.h * 0.93) / 2, m.z), coreMat);
    group.add(core);
  }
  return group;
}
