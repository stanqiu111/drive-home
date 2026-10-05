import * as THREE from 'three';
import { Route, LANE_W } from './route.js';

const FOG_NEAR = 250;
const FOG_FAR = 1800;

export async function loadMapData(id) {
  const res = await fetch(`maps/${id}.json`);
  if (!res.ok) throw new Error(`Could not load map "${id}" (${res.status})`);
  return res.json();
}

// ---------- textures ----------
function canvasTexture(w, h, draw, { repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function asphaltTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#45474b';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const v = (55 + Math.random() * 25) | 0;
      g.fillStyle = `rgb(${v},${v},${v + 2})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    g.strokeStyle = 'rgba(30,30,32,0.5)';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      let x = Math.random() * w;
      let y = Math.random() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (Math.random() - 0.5) * 30;
        y += Math.random() * 25;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

// Tall buildings: 4×4 windows per texture tile (one tile = 4 floors).
function towerTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = '#5a6170';
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const lit = Math.random() < 0.4;
        g.fillStyle = lit ? (Math.random() < 0.5 ? '#ffd27a' : '#fff1c4') : '#20252e';
        g.fillRect(x * 16 + 3, y * 16 + 3, 10, 11);
      }
    }
    g.fillStyle = '#3b3f47';
    g.fillRect(60, 60, 4, 4); // roof texel
  });
}

// Houses: one window per bay and storey.
function houseTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = '#d8d2c4';
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 4) {
      g.fillStyle = 'rgba(0,0,0,0.06)';
      g.fillRect(0, y, 64, 1);
    }
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const lit = Math.random() < 0.35;
        g.fillStyle = '#f4f1ea';
        g.fillRect(x * 32 + 8, y * 32 + 9, 16, 15);
        g.fillStyle = lit ? '#ffcf73' : '#2a313b';
        g.fillRect(x * 32 + 10, y * 32 + 11, 12, 11);
      }
    }
    g.fillStyle = '#4a4a4f';
    g.fillRect(60, 60, 4, 4); // roof texel
  });
}

function skyTexture() {
  return canvasTexture(2, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1d2b53');
    grad.addColorStop(0.3, '#7a4b7d');
    grad.addColorStop(0.5, '#f08a5d');
    grad.addColorStop(1, '#f6b26b');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, { repeat: false });
}

function bannerTexture(text) {
  return canvasTexture(1024, 128, (g, w, h) => {
    g.fillStyle = '#1f7a4d';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.font = 'bold 76px -apple-system, Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  }, { repeat: false });
}

// ---------- geometry helpers ----------
class MeshBuilder {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.col = [];
    this.nor = [];
  }
  vert(p, u = 0, v = 0, c = null, n = null) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    if (c) this.col.push(c.r, c.g, c.b);
    if (n) this.nor.push(n.x, n.y, n.z);
  }
  // Quad a-b-c-d, counter-clockwise seen from the front.
  quad(a, b, c, d, uvs = [0, 0, 1, 0, 1, 1, 0, 1], col = null, n = null) {
    this.vert(a, uvs[0], uvs[1], col, n);
    this.vert(b, uvs[2], uvs[3], col, n);
    this.vert(c, uvs[4], uvs[5], col, n);
    this.vert(a, uvs[0], uvs[1], col, n);
    this.vert(c, uvs[4], uvs[5], col, n);
    this.vert(d, uvs[6], uvs[7], col, n);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.nor.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    else g.computeVertexNormals();
    return g;
  }
}

function hash(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// ---------- terrain ----------
function decodeHeights(t) {
  const bin = atob(t.h);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function makeHeightAt(t, h) {
  const { x0, z0, cell, nx, nz } = t;
  return (x, z) => {
    const fi = (x - x0) / cell;
    const fj = (z - z0) / cell;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return null;
    const a = h[j * nx + i];
    const b = h[j * nx + i + 1];
    const c = h[(j + 1) * nx + i];
    const d = h[(j + 1) * nx + i + 1];
    if (a === -32768 || b === -32768 || c === -32768 || d === -32768) return null;
    const u = fi - i;
    const v = fj - j;
    // Same triangle split as the terrain mesh: (a, c, b) and (b, c, d).
    const y = u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
    return y / 10;
  };
}

// The 30 m elevation grid is too coarse for roads cut into valley walls, so the
// ground can end up above the asphalt. Lower any grid point under the road.
function carveRoadCut(route, t, h) {
  const { x0, z0, cell, nx, nz } = t;
  const p = new THREE.Vector3();
  for (let i = 0; i < route.n; i++) {
    if (route.bridge[i]) continue;
    const s = i * route.step;
    for (let lat = route.leftArr[i] - 2; lat <= route.rightArr[i] + 2; lat += 1) {
      route.toWorld(s, lat, 0, p);
      const ci = Math.floor((p.x - x0) / cell);
      const cj = Math.floor((p.z - z0) / cell);
      if (ci < 0 || cj < 0 || ci >= nx - 1 || cj >= nz - 1) continue;
      const max = Math.floor((p.y - 0.25) * 10);
      for (const k of [cj * nx + ci, cj * nx + ci + 1, (cj + 1) * nx + ci, (cj + 1) * nx + ci + 1]) {
        if (h[k] !== -32768 && h[k] > max) h[k] = max;
      }
    }
  }
}

function buildTerrain(t, h, waterLevel) {
  const { x0, z0, cell, nx, nz } = t;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const grass = new THREE.Color(0x86a04c);
  const dry = new THREE.Color(0xb3a76a);
  const dirt = new THREE.Color(0x6b5a43);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const y = h[k] === -32768 ? -200 : h[k] / 10;
      pos[k * 3] = x0 + i * cell;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z0 + j * cell;
      // Steep valley walls get dirt.
      const hr = i < nx - 1 ? h[k + 1] : h[k];
      const hd = j < nz - 1 ? h[k + nx] : h[k];
      const slope = (Math.abs(hr - h[k]) + Math.abs(hd - h[k])) / 10 / cell;
      c.copy(grass).lerp(dry, hash(i * 0.7, j * 0.7) * 0.8);
      if (slope > 0.12 && slope < 100) c.lerp(dirt, Math.min(1, (slope - 0.12) * 4));
      if (y < waterLevel + 1.5) c.lerp(dirt, 0.5);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  }
  const idx = [];
  const water = new MeshBuilder();
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const cc = a + nx;
      const d = cc + 1;
      if (h[a] === -32768 || h[b] === -32768 || h[cc] === -32768 || h[d] === -32768) continue;
      idx.push(a, cc, b, b, cc, d);
      if (Math.min(h[a], h[b], h[cc], h[d]) / 10 < waterLevel) {
        const X = x0 + i * cell;
        const Z = z0 + j * cell;
        const v = (dx, dz) => new THREE.Vector3(X + dx, waterLevel, Z + dz);
        water.quad(v(0, 0), v(0, cell), v(cell, cell), v(cell, 0));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  const waterMesh = new THREE.Mesh(
    water.build(),
    new THREE.MeshStandardMaterial({ color: 0x3d6f8f, roughness: 0.15, metalness: 0.4 }),
  );
  return [terrain, waterMesh];
}

// ---------- the route road ----------
function bridgeRuns(route) {
  const runs = [];
  for (let i = 0; i < route.n; i++) {
    if (!route.bridge[i]) continue;
    let j = i;
    while (j < route.n && route.bridge[j]) j++;
    runs.push([i * route.step, (j - 1) * route.step]);
    i = j;
  }
  return runs;
}

function buildRouteRoad(route, heightAt, waterLevel, withArches, asphalt) {
  const road = new MeshBuilder();
  const skirt = new MeshBuilder();
  const deck = new MeshBuilder();
  const rail = new MeshBuilder();
  const P = (s, lat, h) => route.toWorld(s, lat, h);
  const step = route.step;

  for (let i = 0; i < route.n - 1; i++) {
    const s0 = i * step;
    const s1 = s0 + step;
    const L0 = route.leftArr[i] - 0.5;
    const L1 = route.leftArr[i + 1] - 0.5;
    const R0 = route.rightArr[i] + 0.5;
    const R1 = route.rightArr[i + 1] + 0.5;
    const v0 = s0 / 8;
    const v1 = s1 / 8;
    road.quad(P(s0, L0, 0.02), P(s0, R0, 0.02), P(s1, R1, 0.02), P(s1, L1, 0.02), [L0 / 8, v0, R0 / 8, v0, R1 / 8, v1, L1 / 8, v1]);

    if (route.bridge[i]) {
      deck.quad(P(s0, R0, 0.02), P(s0, R0, -1.6), P(s1, R1, -1.6), P(s1, R1, 0.02));
      deck.quad(P(s1, L1, 0.02), P(s1, L1, -1.6), P(s0, L0, -1.6), P(s0, L0, 0.02));
      deck.quad(P(s0, L0, -1.6), P(s1, L1, -1.6), P(s1, R1, -1.6), P(s0, R0, -1.6));
      rail.quad(P(s0, R0, 0), P(s1, R1, 0), P(s1, R1, 1.1), P(s0, R0, 1.1));
      rail.quad(P(s1, L1, 0), P(s0, L0, 0), P(s0, L0, 1.1), P(s1, L1, 1.1));
    } else {
      // Embankment skirts so the road never floats above the ground.
      skirt.quad(P(s0, R0, 0.02), P(s0, R0 + 2, -6), P(s1, R1 + 2, -6), P(s1, R1, 0.02));
      skirt.quad(P(s1, L1, 0.02), P(s1, L1 - 2, -6), P(s0, L0 - 2, -6), P(s0, L0, 0.02));
    }
  }

  const runs = bridgeRuns(route);
  const pier = new MeshBuilder();
  for (const [a, b] of runs) {
    for (let s = a + 20; s < b - 10; s += 35) {
      const f = route.frame(s);
      const mid = (f.left + f.right) / 2;
      const top = P(s, mid, -1.6);
      const ground = Math.max(heightAt(top.x, top.z) ?? waterLevel, waterLevel) - 3;
      if (top.y - ground < 2) continue;
      const hw = (f.right - f.left) * 0.25;
      const corners = [P(s - 1.5, mid - hw, -1.6), P(s - 1.5, mid + hw, -1.6), P(s + 1.5, mid + hw, -1.6), P(s + 1.5, mid - hw, -1.6)];
      for (let k = 0; k < 4; k++) {
        const p = corners[k];
        const q = corners[(k + 1) % 4];
        pier.quad(new THREE.Vector3(p.x, ground, p.z), new THREE.Vector3(q.x, ground, q.z), q, p);
      }
    }
  }
  const group = new THREE.Group();
  const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.9, side: THREE.DoubleSide });
  group.add(
    new THREE.Mesh(road.build(), roadMat),
    new THREE.Mesh(skirt.build(), new THREE.MeshStandardMaterial({ color: 0x5f5a50, roughness: 1, side: THREE.DoubleSide })),
    new THREE.Mesh(deck.build(), concrete),
    new THREE.Mesh(rail.build(), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.6, side: THREE.DoubleSide })),
    new THREE.Mesh(pier.build(), concrete),
  );

  // White tied arches over the longest bridge (the Walterdale Bridge on the downtown route).
  if (withArches && runs.length) {
    const [a, b] = runs.reduce((m, r) => (r[1] - r[0] > m[1] - m[0] ? r : m));
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4 });
    const len = b - a;
    const rise = Math.min(48, len * 0.22);
    for (const side of [-1, 1]) {
      const latAt = (s) => {
        const f = route.frame(s);
        return side < 0 ? f.left - 1.2 : f.right + 1.2;
      };
      const pts = [];
      for (let k = 0; k <= 24; k++) {
        const s = a + (len * k) / 24;
        const u = k / 24;
        pts.push(P(s, latAt(s), 4 * u * (1 - u) * rise));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.9, 10, false), white));
      for (let k = 2; k < 23; k++) {
        const top = curve.getPoint(k / 24);
        const s = a + (len * k) / 24;
        const bottom = P(s, latAt(s), 0);
        const hgt = top.y - bottom.y;
        if (hgt < 1) continue;
        const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, hgt, 5), white);
        hanger.position.set(bottom.x, bottom.y + hgt / 2, bottom.z);
        group.add(hanger);
      }
    }
  }
  return group;
}

function buildMarkings(route) {
  const white = new MeshBuilder();
  const yellow = new MeshBuilder();
  const step = route.step;
  const H = 0.05;
  const strip = (mb, s0, s1, lat, w) => {
    for (let s = s0; s < s1 - 0.01; s += step) {
      const e = Math.min(s + step, s1);
      mb.quad(route.toWorld(s, lat - w / 2, H), route.toWorld(s, lat + w / 2, H), route.toWorld(e, lat + w / 2, H), route.toWorld(e, lat - w / 2, H));
    }
  };
  for (let s = 0; s < route.length - 12; s += 12) {
    const f = route.frame(s);
    const lanes = route.lanes(s);
    const ourLeft = f.right - lanes * LANE_W;
    const twoWay = f.left < ourLeft - 1;
    for (let k = 1; k < lanes; k++) strip(white, s, s + 3, f.right - k * LANE_W, 0.15);
    if (twoWay) {
      const theirs = Math.round((ourLeft - f.left) / LANE_W);
      for (let k = 1; k < theirs; k++) strip(white, s, s + 3, ourLeft - k * LANE_W, 0.15);
      strip(yellow, s, s + 12, ourLeft - 0.12, 0.1);
      strip(yellow, s, s + 12, ourLeft + 0.12, 0.1);
    }
    strip(white, s, s + 12, f.right - 0.25, 0.15);
    strip(white, s, s + 12, f.left + 0.25, 0.15);
  }
  const mat = (color) => new THREE.MeshStandardMaterial({
    color, roughness: 0.6, emissive: color, emissiveIntensity: 0.15, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(white.build(), mat(0xe8e8e8)), new THREE.Mesh(yellow.build(), mat(0xf2c230)));
  return group;
}

// ---------- side streets ----------
// Height of the route surface where a side street meets it, so junctions
// ramp smoothly into the main road instead of ending in a step.
function junctionBlend(route) {
  const CELL = 25;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  for (let i = 0; i < route.n; i += 2) {
    const k = key(route.x[i], route.z[i]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const RAMP = 18;
  return (x, z, y) => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = -1;
    let bd = Infinity;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const i of grid.get(`${cx + a},${cz + b}`) || []) {
          const d = (route.x[i] - x) ** 2 + (route.z[i] - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    if (best < 0 || route.bridge[best]) return y;
    const edge = Math.max(-route.leftArr[best], route.rightArr[best]);
    const w = 1 - Math.min(1, Math.max(0, (Math.sqrt(bd) - edge) / RAMP));
    const target = route.y[best] - 0.03;
    if (w <= 0 || Math.abs(target - y) > 4) return y;
    return y + (target - y) * w;
  };
}

function buildSideRoads(roads, heightAt, asphalt, route) {
  const blend = junctionBlend(route);
  const mb = new MeshBuilder();
  const deck = new MeshBuilder();
  const up = new THREE.Vector3(0, 1, 0);
  for (const r of roads) {
    const raw = [];
    for (let k = 0; k < r.p.length; k += 2) raw.push([r.p[k] / 10, r.p[k + 1] / 10]);
    // Subdivide so the ribbon follows the terrain.
    const pts = [raw[0]];
    for (let k = 1; k < raw.length; k++) {
      const [ax, az] = raw[k - 1];
      const [bx, bz] = raw[k];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 8));
      for (let m = 1; m <= n; m++) pts.push([ax + ((bx - ax) * m) / n, az + ((bz - az) * m) / n]);
    }
    let total = 0;
    const acc = [0];
    for (let k = 1; k < pts.length; k++) {
      total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      acc.push(total);
    }
    const ys = pts.map(([x, z], k) => {
      if (r.b && r.y) return r.y[0] + (r.y[1] - r.y[0]) * (acc[k] / (total || 1)) + 0.4;
      const g = heightAt(x, z);
      return g == null ? null : blend(x, z, g + 0.08);
    });
    const hw = r.w / 2;
    for (let k = 0; k < pts.length - 1; k++) {
      if (ys[k] == null || ys[k + 1] == null) continue;
      const [ax, az] = pts[k];
      const [bx, bz] = pts[k + 1];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      const nx = (-(bz - az) / l) * hw;
      const nz = ((bx - ax) / l) * hw;
      // a/d on the right (+n) side; wound a→d→c→b so the top faces up.
      const a = new THREE.Vector3(ax + nx, ys[k], az + nz);
      const b = new THREE.Vector3(ax - nx, ys[k], az - nz);
      const c = new THREE.Vector3(bx - nx, ys[k + 1], bz - nz);
      const d = new THREE.Vector3(bx + nx, ys[k + 1], bz + nz);
      mb.quad(a, d, c, b, [0, acc[k] / 8, 0, acc[k + 1] / 8, 1, acc[k + 1] / 8, 1, acc[k] / 8], null, up);
      if (r.b) {
        const down = (p) => new THREE.Vector3(p.x, p.y - 1.4, p.z);
        deck.quad(a, down(a), down(d), d);
        deck.quad(c, down(c), down(b), b);
        deck.quad(down(a), down(b), down(c), down(d));
      }
    }
  }
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(mb.build(), new THREE.MeshStandardMaterial({
      map: asphalt, color: 0xcfcfcf, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    })),
    new THREE.Mesh(deck.build(), new THREE.MeshStandardMaterial({ color: 0xa9a59c, side: THREE.DoubleSide })),
  );
  return group;
}

// ---------- buildings ----------
const TOWER_TINTS = [0xb8c4d6, 0xd9c2a7, 0x9fb0a8, 0xc9a9a6, 0xa8b8d8, 0xe0ddd5];
const HOUSE_TINTS = [0xf2e6d0, 0xd8dde3, 0xc9d6c3, 0xe8d3b8, 0xb9c4cf, 0xd7c6c0, 0xf0efe9];

function buildBuildings(list, heightAt, occupancy) {
  const chunks = new Map();
  const getChunk = (key) => {
    if (!chunks.has(key)) chunks.set(key, new MeshBuilder());
    return chunks.get(key);
  };
  const color = new THREE.Color();
  const n = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const b of list) {
    const h = b[0] / 10;
    let ring = [];
    for (let k = 1; k < b.length; k += 2) ring.push([b[k] / 10, b[k + 1] / 10]);
    let base = Infinity;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of ring) {
      const g = heightAt(x, z);
      if (g != null) base = Math.min(base, g);
      cx += x;
      cz += z;
    }
    if (base === Infinity) continue;
    cx /= ring.length;
    cz /= ring.length;
    base -= 0.5;
    const top = base + 0.5 + h;
    const tower = h >= 12;
    const tints = tower ? TOWER_TINTS : HOUSE_TINTS;
    color.setHex(tints[Math.floor(hash(cx, cz) * tints.length)]);

    // Orient the ring so each edge's normal (-dz, dx) points outward.
    let out = 0;
    for (let k = 0; k < ring.length; k++) {
      const [x1, z1] = ring[k];
      const [x2, z2] = ring[(k + 1) % ring.length];
      out += -(z2 - z1) * ((x1 + x2) / 2 - cx) + (x2 - x1) * ((z1 + z2) / 2 - cz);
    }
    if (out < 0) ring = ring.reverse();

    const mb = getChunk(`${Math.floor(cx / 800)},${Math.floor(cz / 800)},${tower ? 't' : 'h'}`);
    const winH = tower ? 3.5 : 3;
    const winW = tower ? 3.5 : 4;
    let u = 0;
    for (let k = 0; k < ring.length; k++) {
      const [x1, z1] = ring[k];
      const [x2, z2] = ring[(k + 1) % ring.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.01) continue;
      n.set(-(z2 - z1) / len, 0, (x2 - x1) / len);
      const u1 = u + len / winW;
      const v1 = (top - base) / winH;
      mb.quad(
        new THREE.Vector3(x1, base, z1), new THREE.Vector3(x2, base, z2),
        new THREE.Vector3(x2, top, z2), new THREE.Vector3(x1, top, z1),
        [u, 0, u1, 0, u1, v1, u, v1], color, n,
      );
      u = u1;
    }
    // Flat roof.
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    for (const [ia, ib, ic] of tris) {
      const pa = new THREE.Vector3(ring[ia][0], top, ring[ia][1]);
      const pb = new THREE.Vector3(ring[ib][0], top, ring[ib][1]);
      const pc = new THREE.Vector3(ring[ic][0], top, ring[ic][1]);
      const upward = ab.subVectors(pb, pa).cross(ac.subVectors(pc, pa)).y >= 0;
      for (const p of upward ? [pa, pb, pc] : [pa, pc, pb]) mb.vert(p, 0.97, 0.03, color, up);
    }
    occupancy.addPolygon(ring);
  }
  const towerTex = towerTexture();
  const houseTex = houseTexture();
  const towerMat = new THREE.MeshStandardMaterial({ map: towerTex, emissiveMap: towerTex, emissive: 0xffffff, emissiveIntensity: 0.3, vertexColors: true, roughness: 0.8 });
  const houseMat = new THREE.MeshStandardMaterial({ map: houseTex, emissiveMap: houseTex, emissive: 0xffffff, emissiveIntensity: 0.12, vertexColors: true, roughness: 0.9 });
  const group = new THREE.Group();
  for (const [key, mb] of chunks) group.add(new THREE.Mesh(mb.build(), key.endsWith('t') ? towerMat : houseMat));
  return group;
}

// Coarse grid of blocked ground (buildings, roads), used to place trees.
class Occupancy {
  constructor(cell = 4) {
    this.cell = cell;
    this.set = new Set();
  }
  key(x, z) { return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; }
  mark(x, z) { this.set.add(this.key(x, z)); }
  has(x, z) { return this.set.has(this.key(x, z)); }
  addPolygon(ring) {
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const [x, z] of ring) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    for (let x = minX - 2; x <= maxX + 2; x += this.cell) for (let z = minZ - 2; z <= maxZ + 2; z += this.cell) this.mark(x, z);
  }
  addLine(ax, az, bx, bz, hw) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 2) + 1;
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      for (let dx = -hw; dx <= hw; dx += this.cell) for (let dz = -hw; dz <= hw; dz += this.cell) this.mark(x + dx, z + dz);
    }
  }
}

// ---------- trees, street lights, finish banner ----------
function buildTrees(route, heightAt, occupancy, waterLevel) {
  const spots = [];
  for (let s = 20; s < route.length; s += 7) {
    for (const side of [-1, 1]) {
      if (hash(s, side) < 0.45) continue;
      const f = route.frame(s);
      const edge = side > 0 ? f.right : f.left;
      const p = route.toWorld(s, edge + side * (5 + hash(s * 1.3, side * 7) * 70), 0);
      if (occupancy.has(p.x, p.z)) continue;
      const g = heightAt(p.x, p.z);
      if (g == null || g < waterLevel + 0.5) continue;
      spots.push([p.x, g, p.z, hash(p.x, p.z)]);
    }
  }
  const spruce = spots.filter((t) => t[3] < 0.45);
  const leafy = spots.filter((t) => t[3] >= 0.45);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  const autumn = [0xe0a326, 0xd9772b, 0xc4432b, 0xb8b33a, 0x7f9a3a];

  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.2, 0.3, 2.4, 6).translate(0, 1.2, 0),
    new THREE.MeshStandardMaterial({ color: 0x5a3d2b }),
    Math.max(1, spots.length),
  );
  const cones = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.2, 7, 7).translate(0, 5.5, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    Math.max(1, spruce.length),
  );
  const blobs = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(2.6, 0).translate(0, 4.2, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
    Math.max(1, leafy.length),
  );
  spots.forEach(([x, y, z, r], i) => {
    const s = 0.8 + r * 0.6;
    trunks.setMatrixAt(i, m.compose(v.set(x, y, z), q, sc.set(s, s, s)));
  });
  spruce.forEach(([x, y, z, r], i) => {
    const s = 0.8 + r * 0.8;
    cones.setMatrixAt(i, m.compose(v.set(x, y, z), q, sc.set(s, s, s)));
    cones.setColorAt(i, c.setHex(0x2f5a3a).offsetHSL(0, 0, (r - 0.2) * 0.15));
  });
  leafy.forEach(([x, y, z, r], i) => {
    const s = 0.8 + (r - 0.45) * 1.2;
    blobs.setMatrixAt(i, m.compose(v.set(x, y, z), q, sc.set(s, s * 0.9, s)));
    blobs.setColorAt(i, c.setHex(autumn[Math.floor(r * 1000) % autumn.length]));
  });
  trunks.count = spots.length;
  cones.count = spruce.length;
  blobs.count = leafy.length;
  const group = new THREE.Group();
  group.add(trunks, cones, blobs);
  return group;
}

function buildStreetLights(route) {
  const spots = [];
  // None in the last stretch, where the ending camera looks back at the couch.
  for (let s = 30; s < route.length - 120; s += 50) {
    if (route.cls[route.idx(s)] >= 1) spots.push(s);
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffd27a, emissiveIntensity: 2 });
  const count = Math.max(1, spots.length);
  const meshes = [
    new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.15, 8, 6).translate(0, 4, 0), poleMat, count),
    new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.12, 0.12).translate(-1.1, 8, 0), poleMat, count),
    new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.15, 0.4).translate(-2.1, 7.9, 0), lampMat, count),
  ];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  spots.forEach((s, i) => {
    // With the route's yaw applied, local -x points across the road to the left.
    q.setFromAxisAngle(yAxis, route.yaw(s));
    m.compose(route.toWorld(s, route.rightEdge(s) + 1.4, 0), q, one);
    for (const mesh of meshes) mesh.setMatrixAt(i, m);
  });
  for (const mesh of meshes) mesh.count = spots.length;
  const group = new THREE.Group();
  group.add(...meshes);
  return group;
}

function buildFinish(route, label) {
  const s = route.length - 14;
  const f = route.frame(s);
  const width = f.right - f.left + 3;
  const g = new THREE.Group();
  g.name = 'finishBanner';
  g.position.copy(route.toWorld(s, (f.right + f.left) / 2, 0));
  g.rotation.y = route.yaw(s);
  const plain = new THREE.MeshStandardMaterial({ color: 0x1f7a4d });
  const textMat = new THREE.MeshStandardMaterial({ map: bannerTexture(label), emissive: 0xffffff, emissiveIntensity: 0.25 });
  textMat.emissiveMap = textMat.map;
  const banner = new THREE.Mesh(new THREE.BoxGeometry(width, 1.8, 0.3), [plain, plain, plain, plain, textMat, plain]);
  banner.position.y = 7;
  g.add(banner);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2e35 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 7.9, 8), postMat);
    post.position.set((side * width) / 2, 3.95, 0);
    g.add(post);
  }
  return g;
}

// ---------- main entry ----------
export function createWorld(scene, data, { maxAnisotropy = 1 } = {}) {
  const route = new Route({ step: data.step, ...data.route });
  const heights = decodeHeights(data.terrain);
  carveRoadCut(route, data.terrain, heights);
  const heightAt = makeHeightAt(data.terrain, heights);

  const group = new THREE.Group();
  scene.add(group);
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xe0866a, FOG_NEAR, FOG_FAR);
  const sun = new THREE.DirectionalLight(0xffc28f, 2.0);
  sun.position.set(-300, 250, -600);
  group.add(new THREE.HemisphereLight(0xffe2c4, 0x3a3a4a, 1.6), sun);

  const asphalt = asphaltTexture();
  asphalt.anisotropy = maxAnisotropy;
  const occupancy = new Occupancy();
  for (let s = 0; s < route.length; s += 4) {
    const f = route.frame(s);
    const a = route.toWorld(s, f.left - 2, 0);
    const b = route.toWorld(s, f.right + 2, 0);
    occupancy.addLine(a.x, a.z, b.x, b.z, 2);
  }
  for (const r of data.roads) {
    for (let k = 2; k < r.p.length; k += 2) occupancy.addLine(r.p[k - 2] / 10, r.p[k - 1] / 10, r.p[k] / 10, r.p[k + 1] / 10, r.w / 2 + 1);
  }

  group.add(
    ...buildTerrain(data.terrain, heights, data.water),
    buildRouteRoad(route, heightAt, data.water, data.id === 'home', asphalt),
    buildMarkings(route),
    buildSideRoads(data.roads, heightAt, asphalt, route),
    buildBuildings(data.buildings, heightAt, occupancy),
    buildTrees(route, heightAt, occupancy, data.water),
    buildStreetLights(route),
    buildFinish(route, data.id === 'home' ? 'HOME SWEET HOME' : data.name.toUpperCase()),
  );

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mat of mats) {
        mat.map?.dispose();
        mat.dispose();
      }
    });
  }

  return { route, heightAt, group, dispose, data };
}
