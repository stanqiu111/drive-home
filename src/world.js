import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Route } from './route.js';
import { markingPlan, activeSignals, foldCurvature } from './lane-layout.js';
import { overheadClearance } from './clearance.js';
import { buildLandmarks, landmarkFootprints, projectTo } from './landmarks.js';

const FOG_NEAR = 250;
export const FOG_FAR = 1800;

// Map files, fetched once (the menu prefetches them in the background so switching maps
// doesn't wait for the network). Only the text is kept; it is parsed when the map loads.
const mapText = new Map();
function fetchMapText(id) {
  if (!mapText.has(id)) {
    const p = fetch(`maps/${id}.json`).then((res) => {
      if (!res.ok) throw new Error(`Could not load map "${id}" (${res.status})`);
      return res.text();
    });
    p.catch(() => mapText.delete(id)); // try again next time
    mapText.set(id, p);
  }
  return mapText.get(id);
}
export async function loadMapData(id) {
  return JSON.parse(await fetchMapText(id));
}
export function prefetchMaps(ids) {
  for (const id of ids) fetchMapText(id).catch(() => {});
}

// ---------- building in slices ----------
// Building a map takes a second or more of work. It runs in slices of a few milliseconds, so
// the menu keeps drawing and answering clicks meanwhile: long loops call `if (sl.due())
// await sl.wait()`. `cancelled()` stops a build that is no longer wanted (another map was
// picked); it then throws BuildCancelled.
export class BuildCancelled extends Error {}
// A plain task (not requestAnimationFrame) so the build can use the gaps between frames too.
const channel = new MessageChannel();
const waiting = [];
channel.port1.onmessage = () => waiting.shift()?.();
const yieldToBrowser = () => new Promise((resolve) => {
  waiting.push(resolve);
  channel.port2.postMessage(0);
});
export function slicer(budgetMs = 8, cancelled = () => false) {
  let t0 = performance.now();
  return {
    due: () => performance.now() - t0 > budgetMs,
    async wait() {
      await yieldToBrowser();
      if (cancelled()) throw new BuildCancelled('cancelled');
      t0 = performance.now();
    },
    async tick() {
      if (performance.now() - t0 > budgetMs) await this.wait();
    },
  };
}
const NO_SLICES = { due: () => false, wait: async () => {}, tick: async () => {} };

// ---------- textures ----------
// Texture noise (asphalt specks, lit windows) comes from a fixed seed, reset for every map,
// so a map looks the same each time it loads.
let seed = 1;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

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
      const v = (55 + rand() * 25) | 0;
      g.fillStyle = `rgb(${v},${v},${v + 2})`;
      g.fillRect(rand() * w, rand() * h, 1.5, 1.5);
    }
    g.strokeStyle = 'rgba(30,30,32,0.5)';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      let x = rand() * w;
      let y = rand() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (rand() - 0.5) * 30;
        y += rand() * 25;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

// Sidewalk concrete: one tile = one 1.5 m panel, with a joint line and a little speckle.
function concreteTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#b9b5ad';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const v = (165 + rand() * 40) | 0;
      g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
      g.fillRect(rand() * w, rand() * h, 1.2, 1.2);
    }
    g.fillStyle = 'rgba(70,66,60,0.55)';
    g.fillRect(0, 0, w, 2);
  });
}

// Asphalt shingles: one tile is about 1 m of roof, with courses every ~25 cm.
function shingleTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = (110 + rand() * 60) | 0;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(rand() * w, rand() * h, 1.5, 1.5);
    }
    for (let y = 0; y < 4; y++) {
      g.fillStyle = 'rgba(30,30,30,0.55)';
      g.fillRect(0, y * 16, w, 2);
      for (let x = 0; x < 4; x++) g.fillRect(x * 16 + (y % 2) * 8, y * 16, 1.5, 16);
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
        const lit = rand() < 0.4;
        g.fillStyle = lit ? (rand() < 0.5 ? '#ffd27a' : '#fff1c4') : '#20252e';
        g.fillRect(x * 16 + 3, y * 16 + 3, 10, 11);
      }
    }
    g.fillStyle = '#3b3f47';
    g.fillRect(60, 60, 4, 4); // roof texel
  });
}

// Houses: one tile = one storey (3 m) × two bays (6 m) of vinyl siding with a window per bay.
function houseTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = '#ece6da';
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 4) {
      g.fillStyle = 'rgba(0,0,0,0.07)';
      g.fillRect(0, y, 64, 1);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(0, y + 1, 64, 1);
    }
    for (let x = 0; x < 2; x++) {
      const lit = rand() < 0.3;
      g.fillStyle = '#fbfaf6';
      g.fillRect(x * 32 + 7, 16, 18, 26);
      g.fillStyle = lit ? '#ffcf73' : '#2a313b';
      g.fillRect(x * 32 + 9, 18, 14, 22);
      g.fillStyle = '#fbfaf6';
      g.fillRect(x * 32 + 15, 18, 2, 22); // mullion
    }
    g.fillStyle = '#4a4a4f';
    g.fillRect(60, 60, 4, 4); // roof texel
  });
}

// Mid-rise apartments / hotels: stucco with punched windows and a balcony slab per floor.
// One tile = 1 floor (3 m) × 2 bays (6 m).
function aptTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = '#d6cfc2';
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.08})`;
      g.fillRect(rand() * 64, rand() * 64, 2, 2);
    }
    for (let x = 0; x < 2; x++) {
      const lit = rand() < 0.3;
      g.fillStyle = '#f6f4ee';
      g.fillRect(x * 32 + 6, 12, 20, 30);
      g.fillStyle = lit ? '#ffcf73' : '#2b323c';
      g.fillRect(x * 32 + 8, 14, 16, 26);
    }
    // Balcony slab and railing at the bottom of the floor.
    g.fillStyle = '#9a948a';
    g.fillRect(0, 44, 64, 5);
    g.fillStyle = 'rgba(40,40,45,0.5)';
    for (let x = 2; x < 64; x += 6) g.fillRect(x, 34, 1, 10);
    g.fillStyle = '#4a4a4f';
    g.fillRect(60, 60, 4, 4); // roof texel
  });
}

// Red/brown brick for schools, churches, civic and older walk-ups: 1 tile = 1 storey × 2 bays.
function brickTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = '#9a5a46';
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 4) {
      for (let x = (y / 4) % 2 ? -4 : 0; x < 64; x += 8) {
        const v = 140 + rand() * 40;
        g.fillStyle = `rgb(${v | 0},${(v * 0.6) | 0},${(v * 0.5) | 0})`;
        g.fillRect(x + 1, y + 1, 6, 3);
      }
    }
    for (let x = 0; x < 2; x++) {
      const lit = rand() < 0.2;
      g.fillStyle = '#e8e2d4';
      g.fillRect(x * 32 + 7, 14, 18, 28);
      g.fillStyle = lit ? '#ffcf73' : '#2a313b';
      g.fillRect(x * 32 + 9, 16, 14, 24);
      g.fillStyle = '#e8e2d4';
      g.fillRect(x * 32 + 15, 16, 2, 24);
    }
    g.fillStyle = '#4a4a4f';
    g.fillRect(60, 60, 4, 4);
  });
}

// Big-box stores and strip malls: tilt-up concrete panels with joints and a coloured
// accent band along the top. One tile = 8 m wide × the whole wall height.
function bigboxTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = '#d9d3c6';
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.06})`;
      g.fillRect(rand() * 64, rand() * 64, 2, 2);
    }
    g.fillStyle = 'rgba(60,55,50,0.5)';
    g.fillRect(0, 0, 1, 64);
    g.fillRect(32, 0, 1, 64);
    // Accent band near the top (tinted by vertex colour).
    g.fillStyle = '#b8b0a2';
    g.fillRect(0, 6, 64, 8);
    // Low plinth.
    g.fillStyle = '#a8a195';
    g.fillRect(0, 58, 64, 6);
    g.fillStyle = '#8d8b86';
    g.fillRect(60, 60, 4, 4);
  });
}

// Warehouses / industrial: ribbed metal cladding with a strip of high windows.
// One tile = 4 m wide × 4 m tall.
function industrialTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = '#b9bcc0';
    g.fillRect(0, 0, 64, 64);
    for (let x = 0; x < 64; x += 4) {
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x, 0, 1, 64);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x + 2, 0, 1, 64);
    }
    g.fillStyle = '#5a6068';
    g.fillRect(0, 60, 64, 4);
    g.fillStyle = '#7d8187';
    g.fillRect(60, 60, 4, 4);
  });
}

// 1960s-80s concrete apartment slab: balcony grid with dark recesses. One tile = 1 floor × 2 bays.
function slabTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = '#cfc8bb';
    g.fillRect(0, 0, 64, 64);
    for (let x = 0; x < 2; x++) {
      g.fillStyle = '#2a3038';
      g.fillRect(x * 32 + 4, 8, 24, 36); // recessed balcony/glass
      g.fillStyle = '#e6e0d0';
      g.fillRect(x * 32 + 4, 36, 24, 10); // balcony front
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x * 32 + 4, 44, 24, 2);
    }
    g.fillStyle = '#b8b2a4';
    g.fillRect(0, 48, 64, 16); // floor band
    g.fillStyle = '#8d8b86';
    g.fillRect(60, 60, 4, 4);
  });
}

// Parkades: open decks, a dark void between concrete slabs. One tile = 1 level × 8 m.
function parkadeTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = '#22252b';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#b4b0a8';
    g.fillRect(0, 0, 64, 10);
    g.fillRect(0, 44, 64, 20);
    g.fillStyle = '#8d8b86';
    g.fillRect(60, 60, 4, 4);
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

// Exact numeric key for a grid cell (cells within ±50 000 of the origin).
const cellKey = (ix, iz) => (ix + 50000) * 100000 + (iz + 50000);

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

// Big meshes are cut into pieces about this size (m), so the ones out of view are skipped.
const CHUNK = 500;
const TILE = 16; // terrain cells per tile side (480 m)
const chunkKey = (x, z) => cellKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));

// The terrain as tiles. Normals are worked out once for the whole grid (exactly as
// computeVertexNormals would for one mesh), so tile edges don't show.
async function buildTerrain(t, h, waterLevel, sl = NO_SLICES) {
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
    if ((j & 31) === 0 && sl.due()) await sl.wait();
  }
  // Vertex normals: the sum of the (unnormalised) face normals around each vertex, added up
  // in the same order and precision as BufferGeometry.computeVertexNormals.
  const nor = new Float32Array(nx * nz * 3);
  const hasCell = (a) => h[a] !== -32768 && h[a + 1] !== -32768 && h[a + nx] !== -32768 && h[a + nx + 1] !== -32768;
  const face = (vA, vB, vC) => {
    const bx = pos[vB * 3]; const by = pos[vB * 3 + 1]; const bz = pos[vB * 3 + 2];
    const cbx = pos[vC * 3] - bx; const cby = pos[vC * 3 + 1] - by; const cbz = pos[vC * 3 + 2] - bz;
    const abx = pos[vA * 3] - bx; const aby = pos[vA * 3 + 1] - by; const abz = pos[vA * 3 + 2] - bz;
    const x = cby * abz - cbz * aby;
    const y = cbz * abx - cbx * abz;
    const z = cbx * aby - cby * abx;
    for (const v of [vA, vB, vC]) {
      nor[v * 3] += x;
      nor[v * 3 + 1] += y;
      nor[v * 3 + 2] += z;
    }
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      if (!hasCell(a)) continue;
      face(a, a + nx, a + 1);
      face(a + 1, a + nx, a + nx + 1);
    }
    if ((j & 31) === 0 && sl.due()) await sl.wait();
  }
  for (let k = 0; k < nx * nz; k++) {
    const x = nor[k * 3]; const y = nor[k * 3 + 1]; const z = nor[k * 3 + 2];
    const m = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    nor[k * 3] = x * m;
    nor[k * 3 + 1] = y * m;
    nor[k * 3 + 2] = z * m;
  }

  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x3d6f8f, roughness: 0.15, metalness: 0.4 });
  const out = [];
  for (let tj = 0; tj < nz - 1; tj += TILE) {
    for (let ti = 0; ti < nx - 1; ti += TILE) {
      const i1 = Math.min(nx - 1, ti + TILE);
      const j1 = Math.min(nz - 1, tj + TILE);
      const w = i1 - ti + 1;
      const idx = [];
      const water = new MeshBuilder();
      for (let j = tj; j < j1; j++) {
        for (let i = ti; i < i1; i++) {
          const a = j * nx + i;
          if (!hasCell(a)) continue;
          const la = (j - tj) * w + (i - ti);
          idx.push(la, la + w, la + 1, la + 1, la + w, la + w + 1);
          if (Math.min(h[a], h[a + 1], h[a + nx], h[a + nx + 1]) / 10 < waterLevel) {
            const X = x0 + i * cell;
            const Z = z0 + j * cell;
            const v = (dx, dz) => new THREE.Vector3(X + dx, waterLevel, Z + dz);
            water.quad(v(0, 0), v(0, cell), v(cell, cell), v(cell, 0));
          }
        }
      }
      if (!idx.length) continue;
      const n = w * (j1 - tj + 1);
      const tp = new Float32Array(n * 3);
      const tc = new Float32Array(n * 3);
      const tn = new Float32Array(n * 3);
      for (let j = tj; j <= j1; j++) {
        const from = (j * nx + ti) * 3;
        const to = (j - tj) * w * 3;
        tp.set(pos.subarray(from, from + w * 3), to);
        tc.set(col.subarray(from, from + w * 3), to);
        tn.set(nor.subarray(from, from + w * 3), to);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(tp, 3));
      g.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(tn, 3));
      g.setIndex(idx);
      out.push(new THREE.Mesh(g, terrainMat));
      if (water.pos.length) out.push(new THREE.Mesh(water.build(), waterMat));
      if (sl.due()) await sl.wait();
    }
  }
  return out;
}

// Nearest route sample to a point (grid-accelerated). Returns {i, d} or null beyond maxR.
function routeLookup(route) {
  const CELL = 40;
  const grid = new Map();
  for (let i = 0; i < route.n; i += 2) {
    const k = cellKey(Math.floor(route.x[i] / CELL), Math.floor(route.z[i] / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  return (x, z, maxR) => {
    const r = Math.ceil(maxR / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = null;
    let bd = maxR * maxR;
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        for (const i of grid.get(cellKey(cx + a, cz + b)) || []) {
          const d = (route.x[i] - x) ** 2 + (route.z[i] - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return best == null ? null : { i: best, d: Math.sqrt(bd) };
  };
}

// The driven road nearest a map point: { s, lat, left, right, y } (lat = metres right of the
// route line), or null more than 80 m from the route. Used by landmark models.
function routeAtFor(route) {
  const nearest = routeLookup(route);
  return (x, z) => {
    const nr = nearest(x, z, 80);
    if (!nr) return null;
    const f0 = route.frame(nr.i * route.step);
    const along = nr.i * route.step + (x - f0.x) * f0.tx + (z - f0.z) * f0.tz;
    const s = Math.max(0, Math.min(route.length, along));
    const f = route.frame(s);
    // `beyond`: before the start or past the finish, where the road doesn't go on.
    return { s, lat: -(x - f.x) * f.tz + (z - f.z) * f.tx, left: f.left, right: f.right, y: f.y, beyond: along < 0 || along > route.length };
  };
}

// ---------- the route road ----------
// Spatial index of side-street centrelines, to find where they meet the route.
function sideStreetIndex(roads) {
  const CELL = 30;
  const grid = new Map();
  const key = (x, z) => cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
  for (const r of roads) {
    for (let k = 2; k < r.p.length; k += 2) {
      const seg = [r.p[k - 2] / 10, r.p[k - 1] / 10, r.p[k] / 10, r.p[k + 1] / 10, r.w / 2];
      const n = Math.ceil(Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) / CELL) + 1;
      const seen = new Set();
      for (let m = 0; m <= n; m++) {
        const kk = key(seg[0] + ((seg[2] - seg[0]) * m) / n, seg[1] + ((seg[3] - seg[1]) * m) / n);
        if (seen.has(kk)) continue;
        seen.add(kk);
        if (!grid.has(kk)) grid.set(kk, []);
        grid.get(kk).push(seg);
      }
    }
  }
  // True when a side street passes within `pad` metres of its edge at (x, z).
  return (x, z, pad) => {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const [ax, az, bx, bz, hw] of grid.get(cellKey(cx + a, cz + b)) || []) {
          const dx = bx - ax;
          const dz = bz - az;
          const l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          if (Math.hypot(ax + dx * t - x, az + dz * t - z) < hw + pad) return true;
        }
      }
    }
    return false;
  };
}

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

const WALK_W = 2.0; // sidewalk width (m)
const CURB_H = 0.15;

// The Walterdale Bridge (middle of its deck): any route over it gets its white arches.
const WALTERDALE = [-113.501693, 53.528396];

async function buildRouteRoad(route, heightAt, waterLevel, archAt, asphalt, roads, sl = NO_SLICES) {
  // One set of meshes per ~500 m of road, so stretches out of view are skipped.
  const segSamples = Math.max(1, Math.round(CHUNK / route.step));
  const segs = new Map();
  const seg = (i) => {
    const k = Math.floor(i / segSamples);
    if (!segs.has(k)) {
      segs.set(k, {
        road: new MeshBuilder(), skirt: new MeshBuilder(), walk: new MeshBuilder(), curb: new MeshBuilder(),
        deck: new MeshBuilder(), rail: new MeshBuilder(), pier: new MeshBuilder(),
      });
    }
    return segs.get(k);
  };
  const nearStreet = sideStreetIndex(roads);
  const selfNear = routeLookup(route);
  const foldCurv = foldCurvature(route.laneData);
  // Sidewalk on each side of each sample: city streets only, broken at intersections.
  const hasWalk = [new Uint8Array(route.n), new Uint8Array(route.n)];
  const tmpV = new THREE.Vector3();
  for (let i = 0; i < route.n; i++) {
    if (route.bridge[i] || route.cls[i] > 2) continue;
    const s = i * route.step;
    for (const [side, lat] of [[0, route.rightArr[i] + 0.5 + WALK_W / 2], [1, route.leftArr[i] - 0.5 - WALK_W / 2]]) {
      route.toWorld(s, lat, 0, tmpV);
      // No sidewalk on the inside of a turn tighter than the road is wide: it would fold
      // back across the lanes (same rule as the lane lines in lane-layout.js).
      const outer = lat + Math.sign(lat) * WALK_W / 2;
      // Nor where it would lie on another stretch of the route (a U-turn back alongside itself).
      const other = selfNear(tmpV.x, tmpV.z, 15);
      const onOther = other && Math.abs(other.i - i) > 4
        && Math.abs(-(tmpV.x - route.x[other.i]) * route.tz[other.i] + (tmpV.z - route.z[other.i]) * route.tx[other.i])
          < Math.max(route.rightArr[other.i], -route.leftArr[other.i]) + 0.3 + WALK_W / 2;
      hasWalk[side][i] = nearStreet(tmpV.x, tmpV.z, 2.5) || outer * foldCurv[i] > 0.7 || onOther ? 0 : 1;
    }
    if ((i & 255) === 0 && sl.due()) await sl.wait();
  }
  const P = (s, lat, h) => route.toWorld(s, lat, h);
  const step = route.step;

  for (let i = 0; i < route.n - 1; i++) {
    if ((i & 255) === 0 && sl.due()) await sl.wait();
    const { road, skirt, walk, curb, deck, rail } = seg(i);
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
      // Curb + sidewalk where there is one, then embankment skirts so nothing floats above the ground.
      const v0 = s0 / 1.5;
      const v1 = s1 / 1.5;
      if (hasWalk[0][i]) {
        curb.quad(P(s0, R0, 0.02), P(s1, R1, 0.02), P(s1, R1, CURB_H + 0.02), P(s0, R0, CURB_H + 0.02));
        walk.quad(P(s0, R0, CURB_H + 0.02), P(s0, R0 + WALK_W, CURB_H + 0.02), P(s1, R1 + WALK_W, CURB_H + 0.02), P(s1, R1, CURB_H + 0.02), [0, v0, 1, v0, 1, v1, 0, v1]);
        skirt.quad(P(s0, R0 + WALK_W, CURB_H + 0.02), P(s0, R0 + WALK_W + 2, -6), P(s1, R1 + WALK_W + 2, -6), P(s1, R1 + WALK_W, CURB_H + 0.02));
        // Close the sidewalk off where it stops at a side street.
        if (!hasWalk[0][i - 1]) curb.quad(P(s0, R0, 0.02), P(s0, R0, CURB_H + 0.02), P(s0, R0 + WALK_W, CURB_H + 0.02), P(s0, R0 + WALK_W, 0.02));
        if (!hasWalk[0][i + 1]) curb.quad(P(s1, R1 + WALK_W, 0.02), P(s1, R1 + WALK_W, CURB_H + 0.02), P(s1, R1, CURB_H + 0.02), P(s1, R1, 0.02));
      } else {
        skirt.quad(P(s0, R0, 0.02), P(s0, R0 + 2, -6), P(s1, R1 + 2, -6), P(s1, R1, 0.02));
      }
      if (hasWalk[1][i]) {
        curb.quad(P(s1, L1, 0.02), P(s0, L0, 0.02), P(s0, L0, CURB_H + 0.02), P(s1, L1, CURB_H + 0.02));
        walk.quad(P(s0, L0 - WALK_W, CURB_H + 0.02), P(s0, L0, CURB_H + 0.02), P(s1, L1, CURB_H + 0.02), P(s1, L1 - WALK_W, CURB_H + 0.02), [0, v0, 1, v0, 1, v1, 0, v1]);
        skirt.quad(P(s1, L1 - WALK_W, CURB_H + 0.02), P(s1, L1 - WALK_W - 2, -6), P(s0, L0 - WALK_W - 2, -6), P(s0, L0 - WALK_W, CURB_H + 0.02));
        if (!hasWalk[1][i - 1]) curb.quad(P(s0, L0 - WALK_W, 0.02), P(s0, L0 - WALK_W, CURB_H + 0.02), P(s0, L0, CURB_H + 0.02), P(s0, L0, 0.02));
        if (!hasWalk[1][i + 1]) curb.quad(P(s1, L1, 0.02), P(s1, L1, CURB_H + 0.02), P(s1, L1 - WALK_W, CURB_H + 0.02), P(s1, L1 - WALK_W, 0.02));
      } else {
        skirt.quad(P(s1, L1, 0.02), P(s1, L1 - 2, -6), P(s0, L0 - 2, -6), P(s0, L0, 0.02));
      }
    }
  }

  const runs = bridgeRuns(route);
  for (const [a, b] of runs) {
    for (let s = a + 20; s < b - 10; s += 35) {
      const { pier } = seg(Math.floor(s / step));
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
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x5f5a50, roughness: 1, side: THREE.DoubleSide });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.6, side: THREE.DoubleSide });
  const walkTex = concreteTexture();
  walkTex.anisotropy = asphalt.anisotropy;
  const walkMat = new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.95 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xa8a49c, roughness: 0.9, side: THREE.DoubleSide });
  for (const b of segs.values()) {
    for (const [mb, mat] of [[b.road, roadMat], [b.skirt, skirtMat], [b.deck, concrete], [b.rail, railMat], [b.pier, concrete], [b.walk, walkMat], [b.curb, curbMat]]) {
      if (mb.pos.length) group.add(new THREE.Mesh(mb.build(), mat));
    }
    if (sl.due()) await sl.wait();
  }

  // White tied arches over the Walterdale Bridge (the bridge run whose middle is within
  // 150 m of it), with their hangers, as one mesh.
  const archRun = runs.find(([ra, rb]) => {
    const f = route.frame((ra + rb) / 2);
    return Math.hypot(f.x - archAt[0], f.z - archAt[1]) < 150;
  });
  if (archRun) {
    const [a, b] = archRun;
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4 });
    const parts = [];
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
      parts.push(new THREE.TubeGeometry(curve, 80, 0.9, 10, false));
      for (let k = 2; k < 23; k++) {
        const top = curve.getPoint(k / 24);
        const s = a + (len * k) / 24;
        const bottom = P(s, latAt(s), 0);
        const hgt = top.y - bottom.y;
        if (hgt < 1) continue;
        parts.push(new THREE.CylinderGeometry(0.08, 0.08, hgt, 5).translate(bottom.x, bottom.y + hgt / 2, bottom.z));
      }
    }
    group.add(new THREE.Mesh(mergeGeometries(parts), white));
  }
  return group;
}

// Painted lines come only from markingPlan() in lane-layout.js (also used by
// tools/check-roads.mjs); this just turns each line into thin quads on the road, one mesh
// per colour per ~500 m of road.
async function buildMarkings(route, routeData, signals, sl = NO_SLICES) {
  const segs = new Map();
  const H = 0.05;
  const plan = markingPlan(routeData, signals);
  await sl.tick();
  for (const m of plan) {
    if (sl.due()) await sl.wait();
    const hw = m.width / 2;
    for (let k = 1; k < m.pts.length; k++) {
      const [s0, a] = m.pts[k - 1];
      const [s1, b] = m.pts[k];
      const key = `${m.color}|${Math.floor(s0 / CHUNK)}`;
      if (!segs.has(key)) segs.set(key, new MeshBuilder());
      segs.get(key).quad(route.toWorld(s0, a - hw, H), route.toWorld(s0, a + hw, H), route.toWorld(s1, b + hw, H), route.toWorld(s1, b - hw, H));
    }
  }
  const mat = (color) => new THREE.MeshStandardMaterial({
    color, roughness: 0.6, emissive: color, emissiveIntensity: 0.15, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const mats = { white: mat(0xe8e8e8), yellow: mat(0xf2c230) };
  const group = new THREE.Group();
  for (const [key, mb] of segs) {
    group.add(new THREE.Mesh(mb.build(), mats[key.split('|')[0]]));
    if (sl.due()) await sl.wait();
  }
  return group;
}

// ---------- side streets ----------
// Height of the route surface where a side street meets it, so junctions
// ramp smoothly into the main road instead of ending in a step.
function junctionBlend(route) {
  const CELL = 25;
  const grid = new Map();
  const key = (x, z) => cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
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
        for (const i of grid.get(cellKey(cx + a, cz + b)) || []) {
          const d = (route.x[i] - x) ** 2 + (route.z[i] - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    // No blending on bridges or raised hump ramps: side roads there stay at their own level.
    if (best < 0 || route.bridge[best] || (route.liftArr && route.liftArr[best] > 0.5)) return y;
    const edge = Math.max(-route.leftArr[best], route.rightArr[best]);
    const w = 1 - Math.min(1, Math.max(0, (Math.sqrt(bd) - edge) / RAMP));
    const target = route.y[best] - 0.03;
    if (w <= 0 || Math.abs(target - y) > 4) return y;
    return y + (target - y) * w;
  };
}

// Overpass piers, placed by the map builder off every road: [x, z, top, bottom, nx, nz, halfWidth]
// with (nx, nz) pointing across the deck.
function buildPiers(piers = []) {
  const mb = new MeshBuilder();
  for (const [x, z, top, bot, nx, nz, w] of piers) {
    const ax = nx * w;
    const az = nz * w;
    const tx = -nz * 0.6;
    const tz = nx * 0.6;
    const c = [[x - ax - tx, z - az - tz], [x + ax - tx, z + az - tz], [x + ax + tx, z + az + tz], [x - ax + tx, z - az + tz]];
    for (let q = 0; q < 4; q++) {
      const p1 = c[q];
      const p2 = c[(q + 1) % 4];
      mb.quad(new THREE.Vector3(p1[0], bot, p1[1]), new THREE.Vector3(p2[0], bot, p2[1]), new THREE.Vector3(p2[0], top, p2[1]), new THREE.Vector3(p1[0], top, p1[1]));
    }
  }
  return new THREE.Mesh(mb.build(), new THREE.MeshStandardMaterial({ color: 0xa9a59c, side: THREE.DoubleSide }));
}

async function buildSideRoads(roads, heightAt, asphalt, route, sl = NO_SLICES) {
  const blend = junctionBlend(route);
  // Asphalt and deck/embankment meshes per ~500 m square, by where each piece lies.
  const cells = new Map();
  const cellAt = (ax, az, bx, bz) => {
    const k = chunkKey((ax + bx) / 2, (az + bz) / 2);
    if (!cells.has(k)) cells.set(k, { mb: new MeshBuilder(), deck: new MeshBuilder() });
    return cells.get(k);
  };
  const up = new THREE.Vector3(0, 1, 0);
  for (const r of roads) {
    if (sl.due()) await sl.wait();
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
    // Heights. The map builder decides every raised road (see "Road structures" in CLAUDE.md):
    // `h` gives the height of each point for overpass decks (`o`), their ramps and roads on
    // embankments (`e`). Other bridges are a straight deck between their ends; everything
    // else follows the ground and blends into junctions.
    const rawAcc = [0];
    for (let k = 1; k < raw.length; k++) rawAcc.push(rawAcc[k - 1] + Math.hypot(raw[k][0] - raw[k - 1][0], raw[k][1] - raw[k - 1][1]));
    const givenAt = (d) => {
      let k = 0;
      while (k < rawAcc.length - 2 && rawAcc[k + 1] < d) k++;
      const t = (d - rawAcc[k]) / ((rawAcc[k + 1] - rawAcc[k]) || 1);
      return r.h[k] + (r.h[k + 1] - r.h[k]) * Math.max(0, Math.min(1, t));
    };
    const ys = pts.map(([x, z], k) => {
      if (r.h) return givenAt(acc[k]);
      if (r.b && r.y) return r.y[0] + (r.y[1] - r.y[0]) * (acc[k] / (total || 1)) + 0.4;
      const g = heightAt(x, z);
      return g == null ? null : blend(x, z, g + 0.08);
    });
    const hw = r.w / 2;
    if (r.e) {
      // Earth embankment sides from the road edges down to the ground.
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k];
        const [bx, bz] = pts[k + 1];
        const ga = heightAt(ax, az);
        const gb = heightAt(bx, bz);
        if (ga == null || gb == null || (ys[k] - ga < 0.4 && ys[k + 1] - gb < 0.4)) continue;
        const l = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (-(bz - az) / l) * hw;
        const nz = ((bx - ax) / l) * hw;
        const { deck } = cellAt(ax, az, bx, bz);
        for (const sgn of [1, -1]) {
          const top1 = new THREE.Vector3(ax + sgn * nx, ys[k], az + sgn * nz);
          const top2 = new THREE.Vector3(bx + sgn * nx, ys[k + 1], bz + sgn * nz);
          const spread = (y, g) => 1 + Math.max(0, y - g) * 0.35 / Math.max(hw, 1);
          const sa = spread(ys[k], ga);
          const sb = spread(ys[k + 1], gb);
          const bot1 = new THREE.Vector3(ax + sgn * nx * sa, Math.min(ga, ys[k]) - 0.5, az + sgn * nz * sa);
          const bot2 = new THREE.Vector3(bx + sgn * nx * sb, Math.min(gb, ys[k + 1]) - 0.5, bz + sgn * nz * sb);
          deck.quad(top1, bot1, bot2, top2);
        }
      }
    }
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
      const { mb, deck } = cellAt(ax, az, bx, bz);
      mb.quad(a, d, c, b, [0, acc[k] / 8, 0, acc[k + 1] / 8, 1, acc[k + 1] / 8, 1, acc[k] / 8], null, up);
      if (r.b || r.o) {
        const down = (p) => new THREE.Vector3(p.x, p.y - 1.4, p.z);
        deck.quad(a, down(a), down(d), d);
        deck.quad(c, down(c), down(b), b);
        deck.quad(down(a), down(b), down(c), down(d));
      }
    }
  }
  const group = new THREE.Group();
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphalt, color: 0xcfcfcf, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xa9a59c, side: THREE.DoubleSide });
  for (const { mb, deck } of cells.values()) {
    if (mb.pos.length) group.add(new THREE.Mesh(mb.build(), roadMat));
    if (deck.pos.length) group.add(new THREE.Mesh(deck.build(), deckMat));
    if (sl.due()) await sl.wait();
  }
  return group;
}

// ---------- buildings ----------
const TOWER_TINTS = [0xb8c4d6, 0xd9c2a7, 0x9fb0a8, 0xc9a9a6, 0xa8b8d8, 0xe0ddd5];
const HOUSE_TINTS = [0xf2e6d0, 0xd8dde3, 0xc9d6c3, 0xe8d3b8, 0xb9c4cf, 0xd7c6c0, 0xf0efe9];
const APT_TINTS = [0xe3d9c6, 0xcfc8bd, 0xd9d2c2, 0xc2c9bb, 0xd8cfc9, 0xe6e0d4];
const BIGBOX_TINTS = [0xece6da, 0xe0dcd4, 0xf1efe9, 0xd9d4c8, 0xe9e3d3];
const INDUSTRIAL_TINTS = [0xd5d8dc, 0xc3c8ce, 0xe3e5e8, 0xb9c4cf, 0xd8d3c6];
const BRICK_TINTS = [0xffffff, 0xe8d9cf, 0xd8c7bd, 0xf0e4dc];
// Well-known chains get their colours (walls or accent band) so the boxes read instantly.
const BRANDS = [
  [/ikea/i, { wall: 0x0a58c7, band: 0xffd21a }],
  [/canadian tire/i, { wall: 0xe8e4dc, band: 0xd9271f }],
  [/walmart|wal-mart/i, { wall: 0xe9e9e6, band: 0x1f6fd1 }],
  [/home depot/i, { wall: 0xe2ddd3, band: 0xf27b1b }],
  [/best buy/i, { wall: 0xe8e8e8, band: 0x1a4fb5 }],
  [/costco/i, { wall: 0xe6e3dc, band: 0xd43a2a }],
  [/superstore|loblaw/i, { wall: 0xeadf3a, band: 0x1c1c1e }],
  [/rona/i, { wall: 0xdcdcd8, band: 0x2f7a46 }],
  [/save-on|safeway|sobeys/i, { wall: 0xe4e0d6, band: 0xc8102e }],
  [/london drugs/i, { wall: 0xe2dfd8, band: 0x7a1f3a }],
  [/staples/i, { wall: 0xe8e6e0, band: 0xcc0000 }],
  [/cineplex|cinema/i, { wall: 0x2a2d33, band: 0x1f6fd1 }],
  [/universiade|butterdome/i, { wall: 0xf2c230, band: 0xf2c230 }],
  [/ritchie mill/i, { brick: true }],
  [/rossdale/i, { brick: true }],
  [/holiday inn/i, { wall: 0xe6e0d0, band: 0x2a7d3f }],
  [/sandman/i, { wall: 0x4a4d52, band: 0xb3202a }],
];
function brandFor(name) {
  if (!name) return null;
  for (const [re, v] of BRANDS) if (re.test(name)) return v;
  return null;
}
// Building classes written by tools/build-maps.mjs.
const C = { unknown: 0, house: 1, rowhouse: 2, apartments: 3, retail: 4, industrial: 5, office: 6, civic: 7, outbuilding: 8, hotel: 9, parking: 10, church: 11, school: 12, bigbox: 13 };
// Wall style per class: texture key, tile size in metres (u, v), tints, and whether it is
// a glass tower. Tall buildings of any class become towers.
function wallStyle(cls, h, area, b) {
  const brand = brandFor(b?.n);
  if (brand?.brick) return { key: 'brick', uw: 6, vh: 3, tints: BRICK_TINTS };
  // Old main-street zones (Whyte Ave, Jasper Ave): brick blocks.
  if (b?.hz && h < 16 && cls !== C.house && cls !== C.outbuilding) return { key: 'brick', uw: 6, vh: 3, tints: BRICK_TINTS };
  // Tall residential: 1970s concrete slabs with balcony grids, not glass towers.
  if (h >= 30 && (cls === C.apartments || cls === C.hotel)) return { key: 'slab', uw: 7, vh: 2.9, tints: [0xc8bfae, 0xb8b2a4, 0xd6d0c4, 0xcfc8bd] };
  if (h >= 30) return { key: 'tower', uw: 14, vh: 14, tints: TOWER_TINTS };
  switch (cls) {
    case C.apartments: case C.hotel: return { key: 'apt', uw: 6, vh: 3, tints: APT_TINTS };
    case C.retail: return area >= 1200 || h < 6 ? { key: 'bigbox', uw: 8, vh: h, tints: BIGBOX_TINTS } : { key: 'apt', uw: 6, vh: 3, tints: APT_TINTS };
    case C.bigbox: return { key: 'bigbox', uw: 8, vh: h, tints: BIGBOX_TINTS };
    case C.industrial: return { key: 'industrial', uw: 4, vh: 4, tints: INDUSTRIAL_TINTS };
    case C.office: return h >= 14 ? { key: 'tower', uw: 14, vh: 14, tints: TOWER_TINTS } : { key: 'bigbox', uw: 8, vh: h, tints: BIGBOX_TINTS };
    case C.civic: case C.school: case C.church: return { key: 'brick', uw: 6, vh: 3, tints: BRICK_TINTS };
    case C.parking: return { key: 'parkade', uw: 8, vh: 3, tints: INDUSTRIAL_TINTS };
    case C.outbuilding: return { key: 'house', uw: 6, vh: 3, tints: HOUSE_TINTS };
    case C.house: case C.rowhouse: return { key: 'house', uw: 6, vh: 3, tints: HOUSE_TINTS };
    default:
      if (h >= 12) return { key: 'apt', uw: 6, vh: 3, tints: APT_TINTS };
      if (area >= 900) return { key: 'bigbox', uw: 8, vh: h, tints: BIGBOX_TINTS };
      return { key: 'house', uw: 6, vh: 3, tints: HOUSE_TINTS };
  }
}
const ROOF_TINTS = [0x4a4d52, 0x5b4a3e, 0x3d4247, 0x6b5b4d, 0x2f3236, 0x5d6066];
const FLAT_ROOF = 0x8d8b86;

const polyArea = (ring) => {
  let a = 0;
  for (let k = 0; k < ring.length; k++) {
    const [x1, z1] = ring[k];
    const [x2, z2] = ring[(k + 1) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
};

// Smallest rectangle around a footprint, trying each edge's direction.
function orientedBox(ring) {
  let best = null;
  for (let k = 0; k < ring.length; k++) {
    const [x1, z1] = ring[k];
    const [x2, z2] = ring[(k + 1) % ring.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.5) continue;
    const ax = (x2 - x1) / len;
    const az = (z2 - z1) / len;
    let minA = Infinity; let maxA = -Infinity; let minB = Infinity; let maxB = -Infinity;
    for (const [x, z] of ring) {
      const a = x * ax + z * az;
      const b = -x * az + z * ax;
      minA = Math.min(minA, a); maxA = Math.max(maxA, a); minB = Math.min(minB, b); maxB = Math.max(maxB, b);
    }
    const area = (maxA - minA) * (maxB - minB);
    if (!best || area < best.area) best = { area, ax, az, minA, maxA, minB, maxB };
  }
  if (!best) return null;
  const { ax, az, minA, maxA, minB, maxB } = best;
  const ca = (minA + maxA) / 2;
  const cb = (minB + maxB) / 2;
  let A = (maxA - minA) / 2;
  let B = (maxB - minB) / 2;
  let ux = ax; let uz = az; // long axis
  if (B > A) {
    [A, B] = [B, A];
    ux = -az; uz = ax;
  }
  return { cx: ca * ax - cb * az, cz: ca * az + cb * ax, ux, uz, A, B, area: best.area };
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = true !== inside;
  }
  return inside;
}

// Quad a-b-c-d whose front (visible) side faces along `hint`, whatever order the corners come in.
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
function faceQuad(mb, a, b, c, d, uvs, col, hint) {
  const n = _e1.subVectors(b, a).cross(_e2.subVectors(c, a));
  if (n.dot(hint) >= 0) mb.quad(a, b, c, d, uvs, col, hint);
  else mb.quad(a, d, c, b, [uvs[0], uvs[1], uvs[6], uvs[7], uvs[4], uvs[5], uvs[2], uvs[3]], col, hint);
}
const SOLID_UV = [0.97, 0.03, 0.97, 0.03, 0.97, 0.03, 0.97, 0.03];

async function buildBuildings(list, heightAt, occupancy, sl = NO_SLICES) {
  const chunks = new Map();
  const getChunk = (key) => {
    if (!chunks.has(key)) chunks.set(key, new MeshBuilder());
    return chunks.get(key);
  };
  const color = new THREE.Color();
  const bandColor = new THREE.Color();
  const roofColor = new THREE.Color();
  const flat = new THREE.Color(FLAT_ROOF);
  const n = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // A sloped roof face from an eave edge (a→b) up to the ridge (c→d), UVs in metres.
  const roofFace = (mb, a, b, c, d, col) => {
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const el = Math.hypot(ex, ez) || 1;
    const along = (p) => ((p.x - a.x) * ex + (p.z - a.z) * ez) / el;
    const slope = (p) => Math.hypot(p.x - (a.x + (ex * along(p)) / el), p.z - (a.z + (ez * along(p)) / el), p.y - a.y);
    const nn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c.equals(a) ? d : c, a)).normalize();
    if (nn.y < 0) nn.negate();
    faceQuad(mb, a, b, c, d, [along(a), slope(a) * 1.3, along(b), slope(b) * 1.3, along(c), slope(c) * 1.3, along(d), slope(d) * 1.3], col, nn);
  };
  for (const b of list) {
    if (sl.due()) await sl.wait();
    const h = b.h / 10;
    let ring = [];
    for (let k = 0; k < b.p.length; k += 2) ring.push([b.p[k] / 10, b.p[k + 1] / 10]);
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
    const area0 = polyArea(ring);
    const style = wallStyle(b.c ?? 0, h, area0, b);
    const tower = style.key === 'tower';
    const brand = brandFor(b.n);
    color.setHex(brand?.wall && (style.key === 'bigbox' || style.key === 'apt') ? brand.wall : style.tints[Math.floor(hash(cx, cz) * style.tints.length)]);
    // Big boxes: the accent band and plinth come from the texture; the body gets the tint.

    // Orient the ring so each edge's normal (-dz, dx) points outward.
    let out = 0;
    for (let k = 0; k < ring.length; k++) {
      const [x1, z1] = ring[k];
      const [x2, z2] = ring[(k + 1) % ring.length];
      out += -(z2 - z1) * ((x1 + x2) / 2 - cx) + (x2 - x1) * ((z1 + z2) / 2 - cz);
    }
    if (out < 0) ring = ring.reverse();

    // Houses (and churches, garages) get a pitched (hip) roof when the footprint is roughly a rectangle.
    const area = area0;
    const roofable = style.key === 'house' || b.c === C.church;
    const box = roofable && area < 900 ? orientedBox(ring) : null;
    const pitched = box && area / box.area > 0.72 && box.B > 2;
    const roofH = pitched ? Math.min(box.B * 0.55, h * 0.4, 4) : 0;
    const top = base + 0.5 + h - roofH;
    const parapet = !pitched ? (tower ? 1.0 : 0.6) : 0;
    const roofY = top - parapet;

    const chunkKey = `${Math.floor(cx / 800)},${Math.floor(cz / 800)}`;
    const mb = getChunk(`${chunkKey},${style.key}`);
    // Texture tile size in metres for this wall style.
    const winH = style.vh;
    const winW = style.uw;
    let u = 0;
    for (let k = 0; k < ring.length; k++) {
      const [x1, z1] = ring[k];
      const [x2, z2] = ring[(k + 1) % ring.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.01) continue;
      n.set(-(z2 - z1) / len, 0, (x2 - x1) / len);
      const u1 = u + len / winW;
      const v1 = (top - base) / winH;
      mb.quad(V(x1, base, z1), V(x2, base, z2), V(x2, top, z2), V(x1, top, z1), [u, 0, u1, 0, u1, v1, u, v1], color, n);
      if (parapet && brand?.band && style.key === 'bigbox') {
        // Brand accent band along the top of the wall.
        bandColor.setHex(brand.band);
        const yb = top - 1.6;
        faceQuad(mb, V(x1 + n.x * 0.05, yb, z1 + n.z * 0.05), V(x2 + n.x * 0.05, yb, z2 + n.z * 0.05), V(x2 + n.x * 0.05, yb + 1.1, z2 + n.z * 0.05), V(x1 + n.x * 0.05, yb + 1.1, z1 + n.z * 0.05), SOLID_UV, bandColor, n);
      }
      if (parapet) {
        // Inside face of the parapet, so the roof edge has thickness from above.
        const i1x = x1 - n.x * 0.3;
        const i1z = z1 - n.z * 0.3;
        const i2x = x2 - n.x * 0.3;
        const i2z = z2 - n.z * 0.3;
        const inward = n.clone().negate();
        faceQuad(mb, V(i2x, roofY, i2z), V(i1x, roofY, i1z), V(i1x, top, i1z), V(i2x, top, i2z), SOLID_UV, flat, inward);
        faceQuad(mb, V(x1, top, z1), V(x2, top, z2), V(i2x, top, i2z), V(i1x, top, i1z), SOLID_UV, color, up);
      }
      u = u1;
    }

    if (pitched) {
      // Hip roof on the footprint's rectangle, with a little eave overhang.
      const roofs = getChunk(`${chunkKey},r`);
      roofColor.setHex(ROOF_TINTS[Math.floor(hash(cz, cx) * ROOF_TINTS.length)]);
      const A = box.A + 0.35;
      const B = box.B + 0.35;
      const ridge = Math.max(0, A - B);
      const P = (a, bb, y) => V(box.cx + box.ux * a - box.uz * bb, y, box.cz + box.uz * a + box.ux * bb);
      const eave = top - 0.15;
      const peak = top + roofH;
      const c00 = P(-A, -B, eave);
      const c10 = P(A, -B, eave);
      const c11 = P(A, B, eave);
      const c01 = P(-A, B, eave);
      const r0 = P(-ridge, 0, peak);
      const r1 = P(ridge, 0, peak);
      roofFace(roofs, c00, c10, r1, r0, roofColor);
      roofFace(roofs, c11, c01, r0, r1, roofColor);
      roofFace(roofs, c10, c11, r1, r1, roofColor);
      roofFace(roofs, c01, c00, r0, r0, roofColor);
      // Soffit under the overhang.
      for (const [p, q] of [[c00, c10], [c10, c11], [c11, c01], [c01, c00]]) {
        const ip = P(0, 0, eave);
        faceQuad(mb, q, p, p.clone().lerp(ip, 0.04), q.clone().lerp(ip, 0.04), SOLID_UV, color, new THREE.Vector3(0, -1, 0));
      }
    }

    // Flat roof (sunk below the parapet when there is one).
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const flatY = pitched ? top - 0.2 : roofY;
    for (const [ia, ib, ic] of tris) {
      const pa = V(ring[ia][0], flatY, ring[ia][1]);
      const pb = V(ring[ib][0], flatY, ring[ib][1]);
      const pc = V(ring[ic][0], flatY, ring[ic][1]);
      const upward = ab.subVectors(pb, pa).cross(ac.subVectors(pc, pa)).y >= 0;
      for (const p of upward ? [pa, pb, pc] : [pa, pc, pb]) mb.vert(p, 0.97, 0.03, pitched ? color : flat, up);
    }

    // Rooftop units on big flat roofs.
    if (!pitched && area > 350) {
      const units = 1 + Math.floor(hash(cx * 3.1, cz * 1.7) * Math.min(4, area / 400));
      for (let k = 0; k < units; k++) {
        const px = cx + (hash(cx + k * 7.3, cz) - 0.5) * Math.sqrt(area) * 0.6;
        const pz = cz + (hash(cz + k * 3.7, cx) - 0.5) * Math.sqrt(area) * 0.6;
        if (!pointInRing(px, pz, ring)) continue;
        const w = 2 + hash(px, pz) * 3;
        const d = 1.5 + hash(pz, px) * 2.5;
        const hh = 1.2 + hash(px * 2, pz) * 1.2;
        const unit = new THREE.Color(0xb7b9bb);
        const yb = roofY;
        const c = [V(px - w / 2, 0, pz - d / 2), V(px + w / 2, 0, pz - d / 2), V(px + w / 2, 0, pz + d / 2), V(px - w / 2, 0, pz + d / 2)];
        const wall = (p, q, nx, nz) => faceQuad(mb, V(p.x, yb, p.z), V(q.x, yb, q.z), V(q.x, yb + hh, q.z), V(p.x, yb + hh, p.z), SOLID_UV, unit, new THREE.Vector3(nx, 0, nz));
        wall(c[1], c[0], 0, -1);
        wall(c[2], c[1], 1, 0);
        wall(c[3], c[2], 0, 1);
        wall(c[0], c[3], -1, 0);
        faceQuad(mb, V(c[0].x, yb + hh, c[0].z), V(c[3].x, yb + hh, c[3].z), V(c[2].x, yb + hh, c[2].z), V(c[1].x, yb + hh, c[1].z), SOLID_UV, unit, up);
      }
    }
    occupancy.addPolygon(ring);
  }
  const lit = (tex, glow, roughness = 0.9) => new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow, vertexColors: true, roughness });
  const mats = {
    tower: lit(towerTexture(), 0.3, 0.8),
    house: lit(houseTexture(), 0.12),
    apt: lit(aptTexture(), 0.12),
    brick: lit(brickTexture(), 0.1),
    bigbox: new THREE.MeshStandardMaterial({ map: bigboxTexture(), vertexColors: true, roughness: 0.95 }),
    industrial: new THREE.MeshStandardMaterial({ map: industrialTexture(), vertexColors: true, roughness: 0.6, metalness: 0.2 }),
    parkade: new THREE.MeshStandardMaterial({ map: parkadeTexture(), vertexColors: true, roughness: 0.95 }),
    slab: lit(slabTexture(), 0.08),
    r: new THREE.MeshStandardMaterial({ map: shingleTexture(), vertexColors: true, roughness: 0.95 }),
  };
  const group = new THREE.Group();
  for (const [key, mb] of chunks) {
    group.add(new THREE.Mesh(mb.build(), mats[key.split(',')[2]] ?? mats.house));
    if (sl.due()) await sl.wait();
  }
  return group;
}

// ---------- store signs ----------
// Real business names on the wall that faces the road, so players recognise where
// they are (IKEA, the Gateway Blvd hotels, car dealerships…). All names share one
// texture atlas and one mesh.
const SIGN_CLASSES = new Set([4, 6, 7, 9, 12, 13]); // retail, office, civic, hotel, school, bigbox
const SIGN_STYLES = [
  ['#ffffff', '#c8102e'], ['#ffffff', '#1f4fb0'], ['#ffd84d', '#1c1c1e'], ['#1c1c1e', '#f4f4f0'], ['#ffffff', '#1d7a46'],
  ['#ffffff', '#e8731c'], ['#f4f4f0', '#4a2d8a'], ['#1c1c1e', '#ffc42e'],
];

function buildSigns(list, route, heightAt) {
  const nearest = routeLookup(route);
  const want = [];
  for (const b of list) {
    if (!b.n || !SIGN_CLASSES.has(b.c)) continue;
    const ring = [];
    for (let k = 0; k < b.p.length; k += 2) ring.push([b.p[k] / 10, b.p[k + 1] / 10]);
    let cx = 0;
    let cz = 0;
    for (const [x, z] of ring) { cx += x; cz += z; }
    cx /= ring.length;
    cz /= ring.length;
    const nr = nearest(cx, cz, 340);
    if (!nr) continue;
    const bigLot = b.c === 13 || b.c === 9 || polyArea(ring) >= 2000;
    if (!bigLot && nr.d > 220) continue; // small shops far behind a parking lot aren't worth a sign
    // The wall whose outward normal points at the road, preferring long walls.
    const rx = route.x[nr.i];
    const rz = route.z[nr.i];
    let best = null;
    for (let k = 0; k < ring.length; k++) {
      const [x1, z1] = ring[k];
      const [x2, z2] = ring[(k + 1) % ring.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 6) continue;
      const mx = (x1 + x2) / 2;
      const mz = (z1 + z2) / 2;
      // Outward normal: away from the centroid.
      let nx = -(z2 - z1) / len;
      let nz = (x2 - x1) / len;
      if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
      const toRoad = Math.hypot(rx - mx, rz - mz) || 1;
      const facing = ((rx - mx) * nx + (rz - mz) * nz) / toRoad;
      if (facing < 0.3) continue;
      const score = facing * Math.min(len, 40) - toRoad * 0.05;
      if (!best || score > best.score) best = { score, x1, z1, x2, z2, len, nx, nz, mx, mz };
    }
    if (!best) continue;
    // Where a roadside pylon sign would stand: at the road edge, on the building's side.
    const f = route.frame(nr.i * route.step);
    const side = (cx - rx) * -f.tz + (cz - rz) * f.tx > 0 ? 1 : -1;
    const edge = side > 0 ? f.right : f.left;
    const pylon = route.toWorld(nr.i * route.step, edge + side * 7, 0);
    want.push({ b, best, ring, h: b.h / 10, big: bigLot, pylon, far: nr.d, tangent: [f.tx, f.tz] });
  }
  if (!want.length) return new THREE.Group();
  // Big, close places first, so they are the ones kept if the atlas fills up.
  want.sort((a, b) => (b.big - a.big) || (a.far - b.far));

  // Pack the names into an atlas (shelf packing), sized to what this map needs.
  const SIZE = 2048;
  const ROW = 64;
  const FONT = 'bold 46px -apple-system, Helvetica, Arial, sans-serif';
  const names = [...new Set(want.map((w) => w.b.n))];
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = FONT;
  const widths = new Map(names.map((n) => [n, Math.min(SIZE, Math.ceil(measure.measureText(n).width) + 28)]));
  let rows = 1;
  let fill = 0;
  for (const n of names) {
    if (fill + widths.get(n) > SIZE) { rows++; fill = 0; }
    fill += widths.get(n);
  }
  const HEIGHT = Math.min(SIZE, 2 ** Math.ceil(Math.log2(rows * ROW)));
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = HEIGHT;
  const g = canvas.getContext('2d');
  g.font = FONT;
  g.textBaseline = 'middle';
  let px = 0;
  let py = 0;
  const slots = new Map();
  for (const w of want) {
    const name = w.b.n;
    if (slots.has(name)) continue;
    const tw = widths.get(name);
    if (px + tw > SIZE) { px = 0; py += ROW; }
    if (py + ROW > HEIGHT) break;
    const brand = brandFor(name);
    let [fg, bg] = SIGN_STYLES[Math.floor(hash(name.length * 3.1, name.charCodeAt(0)) * SIGN_STYLES.length)];
    if (brand?.band) {
      bg = `#${brand.band.toString(16).padStart(6, '0')}`;
      const c = new THREE.Color(brand.band);
      fg = (c.r * 0.299 + c.g * 0.587 + c.b * 0.114) > 0.6 ? '#1c1c1e' : '#ffffff';
      if (/ikea/i.test(name)) { bg = '#0a58c7'; fg = '#ffd21a'; }
    }
    g.fillStyle = bg;
    g.fillRect(px, py, tw, ROW);
    g.fillStyle = fg;
    g.fillText(name, px + 14, py + ROW / 2 + 2);
    slots.set(name, [px / SIZE, 1 - (py + ROW) / HEIGHT, (px + tw) / SIZE, 1 - py / HEIGHT, tw / ROW]);
    px += tw;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const mb = new MeshBuilder();
  const post = new MeshBuilder();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const { b, best, h, big, pylon, far, tangent } of want) {
    const slot = slots.get(b.n);
    if (!slot) continue;
    const [u0, v0, u1, v1, aspect] = slot;
    const base = (heightAt(best.mx, best.mz) ?? 0) - 0.5;
    const top = base + 0.5 + h;
    // Letters: big-box and hotel signs are tall; small shops get a fascia strip.
    const signH = Math.min(big ? 2.4 : 1.1, h * 0.35);
    const signW = Math.min(signH * aspect, best.len * 0.9);
    const cy = top - signH * 0.8 - (big ? 0.6 : 0.3);
    // Text runs left→right as seen from outside: the normal rotated a quarter turn.
    let ex = best.nz;
    let ez = -best.nx;
    const off = 0.08;
    const a = V(best.mx - ex * signW / 2 + best.nx * off, cy - signH / 2, best.mz - ez * signW / 2 + best.nz * off);
    const c = V(best.mx + ex * signW / 2 + best.nx * off, cy + signH / 2, best.mz + ez * signW / 2 + best.nz * off);
    const n = V(best.nx, 0, best.nz);
    faceQuad(mb, V(a.x, a.y, a.z), V(c.x, a.y, c.z), V(c.x, c.y, c.z), V(a.x, c.y, a.z), [u0, v0, u1, v0, u1, v1, u0, v1], null, n);
    // Big boxes and hotels also get a tall pylon sign at the road edge, like the real
    // ones along Gateway Blvd, so the name is readable from the car.
    if (big && best.len > 25) {
      const px2 = pylon.x;
      const pz2 = pylon.z;
      const gy = pylon.y + 0.05;
      const ph = far > 60 ? 4 : 3;
      const pw = Math.min(11, ph * aspect);
      const py0 = gy + (far > 60 ? 9 : 6);
      void tangent;
      post.quad(V(px2 - 0.2, gy, pz2 - 0.2), V(px2 + 0.2, gy, pz2 - 0.2), V(px2 + 0.2, py0, pz2 - 0.2), V(px2 - 0.2, py0, pz2 - 0.2));
      post.quad(V(px2 + 0.2, gy, pz2 + 0.2), V(px2 - 0.2, gy, pz2 + 0.2), V(px2 - 0.2, py0, pz2 + 0.2), V(px2 + 0.2, py0, pz2 + 0.2));
      post.quad(V(px2 - 0.2, gy, pz2 + 0.2), V(px2 - 0.2, gy, pz2 - 0.2), V(px2 - 0.2, py0, pz2 - 0.2), V(px2 - 0.2, py0, pz2 + 0.2));
      post.quad(V(px2 + 0.2, gy, pz2 - 0.2), V(px2 + 0.2, gy, pz2 + 0.2), V(px2 + 0.2, py0, pz2 + 0.2), V(px2 + 0.2, py0, pz2 - 0.2));
      // Two-sided panel facing along the road (readable while driving past). Each face's
      // text runs left→right as seen from its own side.
      const [tX, tZ] = tangent;
      for (const sgn of [1, -1]) {
        const nn = V(tX * sgn, 0, tZ * sgn);
        const rx = nn.z;
        const rz = -nn.x;
        const ox = nn.x * 0.03;
        const oz = nn.z * 0.03;
        faceQuad(mb, V(px2 - rx * pw / 2 + ox, py0, pz2 - rz * pw / 2 + oz), V(px2 + rx * pw / 2 + ox, py0, pz2 + rz * pw / 2 + oz),
          V(px2 + rx * pw / 2 + ox, py0 + ph, pz2 + rz * pw / 2 + oz), V(px2 - rx * pw / 2 + ox, py0 + ph, pz2 - rz * pw / 2 + oz),
          [u0, v0, u1, v0, u1, v1, u0, v1], null, nn);
      }
    }
  }
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(mb.build(), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5 })),
    new THREE.Mesh(post.build(), new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, side: THREE.DoubleSide })),
  );
  return group;
}

// ---------- highway exit signs ----------
// Green guide signs with the real ramp destinations (from OpenStreetMap `destination`
// tags): a ground sign ~300 m before the exit and a cantilever sign over the exit lane.
function guideSignTexture(lines, ref, arrow) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#146b3a';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#f4f4f0';
  g.lineWidth = 8;
  g.strokeRect(8, 8, 496, 240);
  g.fillStyle = '#f4f4f0';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  let y = 60;
  if (ref) {
    g.font = 'bold 34px -apple-system, Helvetica, Arial, sans-serif';
    g.fillText(`EXIT ${ref}`, 28, 40);
    y = 92;
  }
  const n = lines.length;
  const size = n >= 3 ? 44 : n === 2 ? 54 : 64;
  g.font = `bold ${size}px -apple-system, Helvetica, Arial, sans-serif`;
  const step = n >= 3 ? 56 : 70;
  const startY = ref ? y : 128 - ((n - 1) * step) / 2;
  lines.forEach((t, i) => {
    let text = t;
    while (g.measureText(text).width > 400 && text.length > 4) text = text.slice(0, -2);
    g.fillText(text, 28, startY + i * step);
  });
  // Arrow at the right.
  g.font = 'bold 90px -apple-system, Helvetica, Arial, sans-serif';
  g.textAlign = 'right';
  g.fillText(arrow, 492, 200);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildExitSigns(route, exits) {
  const group = new THREE.Group();
  if (!exits?.length) return group;
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6e737a, roughness: 0.5, metalness: 0.5 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x5a5e63, roughness: 0.7 });
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1, 8);
  const place = (s, lat, y, w, h, tex, armLen) => {
    if (s < 20 || s > route.length - 60) return;
    const yaw = route.yaw(s);
    const g = new THREE.Group();
    g.position.copy(route.toWorld(s, lat, 0));
    g.rotation.y = yaw;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.5 }));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), backMat);
    // Signs face oncoming drivers (+z locally, since the route runs towards -z).
    face.position.set(armLen ? -armLen : 0, y, 0.03);
    back.position.set(armLen ? -armLen : 0, y, -0.03);
    back.rotation.y = Math.PI;
    g.add(face, back);
    if (armLen) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.scale.set(2.2, y + h / 2 + 0.2, 2.2);
      post.position.y = (y + h / 2 + 0.2) / 2;
      const arm = new THREE.Mesh(postGeo, postMat);
      arm.scale.set(1.4, armLen, 1.4);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(-armLen / 2, y + h / 2 + 0.1, 0);
      g.add(post, arm);
    } else {
      for (const dx of [-w / 2 + 0.3, w / 2 - 0.3]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.scale.set(1, y - h / 2 + 0.1, 1);
        post.position.set(dx, (y - h / 2 + 0.1) / 2, 0);
        g.add(post);
      }
    }
    group.add(g);
  };
  for (const e of exits) {
    const arrow = e.side > 0 ? '➚' : '➚';
    const tex = guideSignTexture(e.text, e.ref, e.side > 0 ? '⬈' : '⬉');
    const f0 = route.frame(Math.max(0, e.s - 320));
    const edge0 = e.side > 0 ? f0.right + 3.5 : f0.left - 3.5;
    place(e.s - 320, edge0, 4.2, 7.0, 3.5, tex, 0);
    const f1 = route.frame(Math.max(0, e.s - 70));
    const edge1 = e.side > 0 ? f1.right + 1.2 : f1.left - 1.2;
    // Cantilever over the exit lane: the arm reaches back over the road from the post.
    const armLen = e.side > 0 ? 5.5 : -5.5;
    place(e.s - 70, edge1, 7.2, 7.0, 3.5, tex.clone(), armLen);
    void arrow;
  }
  return group;
}

// Coarse grid of blocked ground (buildings, roads), used to place trees. One bit per 4 m
// cell over the terrain's box (plus a margin); cells line up with multiples of 4 m from the
// map origin. Only needed while the map is built.
class Occupancy {
  constructor(t, cell = 4, margin = 200) {
    this.cell = cell;
    this.i0 = Math.floor((t.x0 - margin) / cell);
    this.j0 = Math.floor((t.z0 - margin) / cell);
    this.ni = Math.ceil(((t.nx - 1) * t.cell + 2 * margin) / cell) + 1;
    this.nj = Math.ceil(((t.nz - 1) * t.cell + 2 * margin) / cell) + 1;
    this.bits = new Uint32Array(Math.ceil((this.ni * this.nj) / 32));
  }
  index(x, z) {
    const i = Math.floor(x / this.cell) - this.i0;
    const j = Math.floor(z / this.cell) - this.j0;
    return i < 0 || j < 0 || i >= this.ni || j >= this.nj ? -1 : j * this.ni + i;
  }
  mark(x, z) {
    const k = this.index(x, z);
    if (k >= 0) this.bits[k >>> 5] |= 1 << (k & 31);
  }
  has(x, z, bits = this.bits) {
    const k = this.index(x, z);
    return k >= 0 && (bits[k >>> 5] & (1 << (k & 31))) !== 0;
  }
  addPolygon(ring) {
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const [x, z] of ring) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    for (let x = minX - 2; x <= maxX + 2; x += this.cell) for (let z = minZ - 2; z <= maxZ + 2; z += this.cell) this.mark(x, z);
  }
  addBox(x0, z0, x1, z1) {
    for (let x = x0; x <= x1; x += this.cell) for (let z = z0; z <= z1; z += this.cell) this.mark(x, z);
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
// Shapes are merged once and drawn instanced: one draw call per part for every tree.
const plainGeo = (g) => {
  const p = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(p.attributes)) if (!['position', 'normal'].includes(name)) p.deleteAttribute(name);
  return p;
};
function treeGeometries() {
  // White spruce: stacked, slightly drooping tiers.
  const tiers = [[2.1, 2.2, 1.6], [1.75, 2.0, 2.9], [1.35, 1.9, 4.1], [0.95, 1.8, 5.2], [0.5, 1.6, 6.2]];
  const spruce = mergeGeometries(tiers.map(([r, h, y]) => plainGeo(new THREE.ConeGeometry(r, h, 9).translate(0, y + h / 2, 0))));
  // Broadleaf (elm/maple/ash): a cluster of lumpy blobs.
  const blobs = [[2.0, 0, 4.3, 0], [1.5, 1.2, 3.9, 0.5], [1.55, -1.1, 4.1, -0.5], [1.3, 0.3, 5.4, 0.2], [1.2, -0.3, 4.0, 1.2]];
  const leafy = mergeGeometries(blobs.map(([r, x, y, z]) => plainGeo(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z))));
  // Trembling aspen: tall narrow crown.
  const aspen = mergeGeometries([
    plainGeo(new THREE.IcosahedronGeometry(1, 1).scale(1.3, 2.4, 1.3).translate(0, 5.6, 0)),
    plainGeo(new THREE.IcosahedronGeometry(1, 1).scale(1.0, 1.4, 1.0).translate(0.4, 7.3, 0.2)),
  ]);
  // Trunk with two short limbs into the crown.
  const trunk = mergeGeometries([
    plainGeo(new THREE.CylinderGeometry(0.11, 0.2, 3.6, 7).translate(0, 1.8, 0)),
    plainGeo(new THREE.CylinderGeometry(0.05, 0.08, 1.4, 5).rotateZ(0.7).translate(0.45, 3.4, 0)),
    plainGeo(new THREE.CylinderGeometry(0.05, 0.08, 1.3, 5).rotateZ(-0.6).rotateY(1.2).translate(-0.2, 3.5, 0.35)),
  ]);
  for (const g of [spruce, leafy, aspen, trunk]) g.computeVertexNormals();
  return { spruce, leafy, aspen, trunk };
}

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
      spots.push([p.x, g, p.z, hash(p.x, p.z), hash(p.z * 1.7, p.x * 0.3)]);
    }
  }
  const kind = (r) => (r < 0.4 ? 'spruce' : r < 0.8 ? 'leafy' : 'aspen');
  const geos = treeGeometries();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const autumn = [0xe0a326, 0xd9772b, 0xc4432b, 0xb8b33a, 0x7f9a3a, 0xe8c43a];
  const mats = {
    spruce: new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
    leafy: new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
    aspen: new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
    trunk: new THREE.MeshStandardMaterial({ roughness: 0.95 }),
  };
  // Instanced per ~500 m square (one draw call per part per square), so only the trees
  // near the camera are drawn.
  const cells = new Map();
  for (const t of spots) {
    const k = chunkKey(t[0], t[2]);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(t);
  }
  const group = new THREE.Group();
  for (const list of cells.values()) {
    const trunks = new THREE.InstancedMesh(geos.trunk, mats.trunk, list.length);
    list.forEach(([x, y, z, r, r2], i) => {
      const k = kind(r);
      const s = k === 'spruce' ? 0.8 + r2 * 0.7 : 0.75 + r2 * 0.55;
      q.setFromAxisAngle(yAxis, r2 * 6.28);
      m.compose(v.set(x, y - 0.1, z), q, sc.set(s, s * (k === 'aspen' ? 1.1 : 1), s));
      trunks.setMatrixAt(i, m);
      trunks.setColorAt(i, c.setHex(k === 'aspen' ? 0xd9d6c8 : k === 'spruce' ? 0x4a3527 : 0x5a3d2b));
    });
    group.add(trunks);
    for (const k of ['spruce', 'leafy', 'aspen']) {
      const mine = list.filter((t) => kind(t[3]) === k);
      if (!mine.length) continue;
      const mesh = new THREE.InstancedMesh(geos[k], mats[k], mine.length);
      mine.forEach(([x, y, z, , r2], i) => {
        const s = k === 'spruce' ? 0.8 + r2 * 0.7 : 0.75 + r2 * 0.55;
        q.setFromAxisAngle(yAxis, r2 * 6.28);
        mesh.setMatrixAt(i, m.compose(v.set(x, y - 0.1, z), q, sc.set(s, s * (k === 'aspen' ? 1.1 : 1), s)));
        if (k === 'spruce') c.setHex(0x2f5a3a).offsetHSL(0, 0, (r2 - 0.5) * 0.08);
        else if (k === 'aspen') c.setHex(r2 < 0.5 ? 0xf0c93a : 0xe3b52e);
        else c.setHex(autumn[Math.floor(r2 * 1000) % autumn.length]);
        mesh.setColorAt(i, c);
      });
      group.add(mesh);
    }
  }
  return group;
}

// Edmonton-style davit street light: tapered pole, curved arm, cobra-head lamp.
function streetLightGeometries() {
  const armCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 8.2, 0), new THREE.Vector3(0, 9.4, 0), new THREE.Vector3(-2.4, 9.3, 0));
  const pole = mergeGeometries([
    plainGeo(new THREE.CylinderGeometry(0.09, 0.15, 8.4, 8).translate(0, 4.2, 0)),
    plainGeo(new THREE.CylinderGeometry(0.24, 0.26, 0.5, 8).translate(0, 0.25, 0)),
    plainGeo(new THREE.TubeGeometry(armCurve, 10, 0.065, 6, false)),
    plainGeo(new THREE.SphereGeometry(1, 12, 6).scale(0.62, 0.17, 0.3).translate(-2.75, 9.25, 0)),
  ]);
  pole.computeVertexNormals();
  const lens = plainGeo(new THREE.CircleGeometry(1, 12).scale(0.45, 0.2, 1).rotateX(Math.PI / 2).translate(-2.78, 9.1, 0));
  return { pole, lens };
}

function buildStreetLights(route) {
  const spots = [];
  // None in the last stretch, where the ending camera looks back at the couch.
  for (let s = 30; s < route.length - 120; s += 50) {
    if (route.cls[route.idx(s)] >= 1) spots.push(s);
  }
  const geos = streetLightGeometries();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x6e737a, roughness: 0.45, metalness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffd27a, emissiveIntensity: 2.2, side: THREE.DoubleSide });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  // Instanced per ~500 m square, like the trees.
  const cells = new Map();
  for (const s of spots) {
    // With the route's yaw applied, local -x points across the road to the left.
    q.setFromAxisAngle(yAxis, route.yaw(s));
    const p = route.toWorld(s, route.rightEdge(s) + 1.4, 0);
    const k = chunkKey(p.x, p.z);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(m.compose(p, q, one).clone());
  }
  const group = new THREE.Group();
  for (const list of cells.values()) {
    for (const [geo, mat] of [[geos.pole, poleMat], [geos.lens, lampMat]]) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      group.add(mesh);
    }
  }
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
// Sky, fog and sunlight are the same on every map, so they are set up once for the scene:
// shaders are compiled for exactly these lights and fog, before a map is first shown.
export function setupSky(scene) {
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xe0866a, FOG_NEAR, FOG_FAR);
  const sun = new THREE.DirectionalLight(0xffc28f, 2.0);
  sun.position.set(-300, 250, -600);
  scene.add(new THREE.HemisphereLight(0xffe2c4, 0x3a3a4a, 1.6), sun);
}

// Every geometry, material and texture under an object.
export function resourcesOf(root) {
  const out = new Set();
  root.traverse((o) => {
    if (o.geometry) out.add(o.geometry);
    for (const mat of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      out.add(mat);
      for (const v of Object.values(mat)) if (v?.isTexture) out.add(v);
    }
  });
  return out;
}

// Frees what `root` uses on the GPU, except anything in `keep` (shared with what stays).
export function disposeObject(root, keep = new Set()) {
  for (const r of resourcesOf(root)) {
    // Environment maps are shared with the cars; worlds never own them.
    if (!keep.has(r) && !r.isCubeTexture && r.mapping !== THREE.CubeUVReflectionMapping) r.dispose();
  }
  // Instanced meshes hold their own per-instance buffers on the GPU.
  root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
}

// Builds a map's world in slices (see slicer). The group is not added to any scene: the
// caller shows it with scene.add(world.group) when it is ready, and frees it with dispose().
export async function buildWorld(data, { maxAnisotropy = 1, sl = NO_SLICES } = {}) {
  seed = 20261005;
  const route = new Route({ step: data.step, ...data.route });
  const heights = decodeHeights(data.terrain);
  carveRoadCut(route, data.terrain, heights);
  const heightAt = makeHeightAt(data.terrain, heights);
  const group = new THREE.Group();
  group.name = `world:${data.id}`;
  await sl.tick();

  const asphalt = asphaltTexture();
  asphalt.anisotropy = maxAnisotropy;
  // Blocked ground (roads, then buildings and landmark sites), for placing trees. Only needed
  // while building: it is dropped at the end so the finished world doesn't keep it.
  let occupancy = new Occupancy(data.terrain);
  for (let s = 0; s < route.length; s += 4) {
    const f = route.frame(s);
    const a = route.toWorld(s, f.left - 2, 0);
    const b = route.toWorld(s, f.right + 2, 0);
    occupancy.addLine(a.x, a.z, b.x, b.z, 2);
    if (sl.due()) await sl.wait();
  }
  for (const r of data.roads) {
    for (let k = 2; k < r.p.length; k += 2) occupancy.addLine(r.p[k - 2] / 10, r.p[k - 1] / 10, r.p[k] / 10, r.p[k + 1] / 10, r.w / 2 + 1);
    if (sl.due()) await sl.wait();
  }
  // Road cells only (route + side roads, with a margin), so landmark props can keep off them.
  let roadCells = occupancy.bits.slice();
  const onRoad = (x, z) => roadCells !== null && occupancy.has(x, z, roadCells);
  // No trees inside landmark sites (refineries, the Legislature grounds…).
  for (const f of landmarkFootprints(data)) occupancy.addBox(f.x - f.hw, f.z - f.hd, f.x + f.hw, f.z + f.hd);
  await sl.tick();

  const add = (name, ...parts) => {
    const g = new THREE.Group();
    g.name = name;
    g.add(...parts);
    group.add(g);
  };
  add('terrain', ...(await buildTerrain(data.terrain, heights, data.water, sl)));
  await sl.tick();
  add('road', await buildRouteRoad(route, heightAt, data.water, projectTo(data.origin, ...WALTERDALE), asphalt, data.roads, sl));
  await sl.tick();
  add('markings', await buildMarkings(route, route.laneData, activeSignals(data.signals, route.length), sl));
  await sl.tick();
  add('sideRoads', await buildSideRoads(data.roads, heightAt, asphalt, route, sl), buildPiers(data.piers));
  await sl.tick();
  add('buildings', await buildBuildings(data.buildings, heightAt, occupancy, sl));
  await sl.tick();
  add('signs', buildSigns(data.buildings, route, heightAt));
  await sl.tick();
  add('exitSigns', buildExitSigns(route, data.exits));
  await sl.tick();
  const landmarks = await buildLandmarks(data, heightAt, onRoad, routeAtFor(route), sl);
  add('landmarks', landmarks);
  await sl.tick();
  add('trees', buildTrees(route, heightAt, occupancy, data.water));
  add('streetLights', buildStreetLights(route));
  group.add(buildFinish(route, data.id === 'home' ? 'HOME SWEET HOME' : (data.custom?.to ?? data.name).toUpperCase()));
  occupancy = null;
  roadCells = null;
  await sl.tick();
  // Room above the road (bridge decks, overpasses) so flying and the camera stay under it.
  const clearance = await overheadClearance(route, data, landmarks, sl);
  await sl.tick();

  return {
    route, heightAt, group, data, clearance,
    // Frees the GPU side of everything not also used by `keep` (the world replacing it).
    dispose(keep) {
      group.parent?.remove(group);
      disposeObject(group, keep ? resourcesOf(keep) : undefined);
    },
  };
}
