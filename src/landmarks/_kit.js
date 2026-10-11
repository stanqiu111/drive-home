import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Shared helpers for the landmark models (not a landmark itself: it has no build()).
// Plans are [x, z] points in metres (x = east, z = south); y is up. A plan with a positive
// planArea() runs clockwise seen from above.

// Flatten any geometry to position/normal/uv, non-indexed, so everything merges.
function flatGeo(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  return n;
}
export const merge = (list) => mergeGeometries(list.map(flatGeo));

// Geometry collected per material and merged once: one mesh (one draw call) per material.
export class Parts {
  constructor() { this.bins = new Map(); }
  add(mat, ...geos) {
    if (!this.bins.has(mat)) this.bins.set(mat, []);
    this.bins.get(mat).push(...geos);
    return this;
  }
  group(into = new THREE.Group()) {
    for (const [mat, geos] of this.bins) if (geos.length) into.add(new THREE.Mesh(merge(geos), mat));
    return into;
  }
}

// Flat-shaded triangles from a flat [x, y, z, ...] list (counter-clockwise = front).
export function tris(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Reverse the winding (and normals) of a geometry; returns a non-indexed copy when indexed.
export function flipFaces(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
  }
  g.attributes.position.needsUpdate = true;
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

// Flip individual triangles so their normals agree with dir(x, y, z) at their centre.
export function fixOutward(geo, dir) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const [dx, dy, dz] = dir((p[i] + p[i + 3] + p[i + 6]) / 3, (p[i + 1] + p[i + 4] + p[i + 7]) / 3, (p[i + 2] + p[i + 5] + p[i + 8]) / 3);
    if (nx * dx + ny * dy + nz * dz < 0) {
      for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
    }
  }
  g.attributes.position.needsUpdate = true;
  if (g.attributes.normal) g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

// Axis-aligned box from extents.
export const box = (x0, x1, y0, y1, z0, z1) =>
  new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

// Box w (local x) x h x d standing on y0, centred on (x, z), turned by yaw (radians,
// counter-clockwise seen from above, as rotateY).
export const orientedBox = (w, h, d, x, y0, z, yaw = 0) =>
  new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).rotateY(yaw).translate(x, y0, z);

// Signed area of a plan (positive = clockwise seen from above, z pointing south).
export const planArea = (poly) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

// Horizontal fill of a plan at height y, facing up (or down).
export function cap(poly, y, down = false) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z))));
  g.rotateX(-Math.PI / 2).translate(0, y, 0); // shape (x, -z) -> world (x, y, z), facing up
  return down ? flipFaces(g) : g;
}

// Vertical walls around a plan from y0 to y1, facing outward (no top or bottom). With
// uv = [metres per texture repeat along the wall, metres per repeat up the wall] the walls
// get texture coordinates (u runs along the outline, v up from y = 0).
export function walls(poly, y0, y1, uv = null) {
  const cw = planArea(poly) > 0;
  const pos = [], tex = [];
  let run = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // On a clockwise plan the outside of edge a->b is on its left; quads are wound so that
    // their front face is the outside.
    const [p, q] = cw ? [b, a] : [a, b];
    pos.push(p[0], y0, p[1], q[0], y0, q[1], q[0], y1, q[1], p[0], y0, p[1], q[0], y1, q[1], p[0], y1, p[1]);
    if (uv) {
      const [u0, u1] = cw ? [run + len, run] : [run, run + len];
      const U0 = u0 / uv[0], U1 = u1 / uv[0], V0 = y0 / uv[1], V1 = y1 / uv[1];
      tex.push(U0, V0, U1, V0, U1, V1, U0, V0, U1, V1, U0, V1);
    }
    run += len;
  }
  const g = tris(pos);
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(tex, 2));
  return g;
}

// Box-mapped texture coordinates from world positions (each triangle uses the two axes across
// its normal), `scale` metres per texture repeat. For grid textures on odd-shaped parts.
export function boxUV(geo, scale) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    const nx = Math.abs(n.getX(i) + n.getX(i + 1) + n.getX(i + 2)), ny = Math.abs(n.getY(i) + n.getY(i + 1) + n.getY(i + 2)), nz = Math.abs(n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2));
    for (let k = i; k < i + 3; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const [a, b] = ny >= nx && ny >= nz ? [x, z] : nx >= nz ? [z, y] : [x, y];
      uv[k * 2] = a / scale; uv[k * 2 + 1] = b / scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Materials for open parking decks (see parkingDeck): concrete parapets over dark open floors
// with columns, and a striped top deck. deckH = storey height.
export function deckMaterials(ctx, deckH = 3.2) {
  const face = tileTexture(64, 32, (g, w, h) => {
    g.fillStyle = '#4b4f53'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c3c5c5';
    const p = h * (1.15 / deckH); // parapet at the bottom of each storey (texture v runs up)
    g.fillRect(0, h - p, w, p);
    g.fillRect(0, 0, w * 0.08, h); // column
    g.fillStyle = '#9a9c9d'; g.fillRect(0, h - p - 2, w, 2);
  });
  const lines = tileTexture(32, 256, (g, w, h) => {
    g.fillStyle = '#9b9e9f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8e8e2';
    const m = h / 18; // tile = 2.75 m x 18 m: two rows of stalls back to back across an aisle
    g.fillRect(0, 0, 2, 5.5 * m); g.fillRect(0, 12.5 * m, 2, 5.5 * m);
  });
  lines.repeat.set(1 / 2.75, 1 / 18);
  return {
    deckH,
    face: new THREE.MeshStandardMaterial({ map: face, roughness: 0.9 }),
    top: new THREE.MeshStandardMaterial({ map: lines, roughness: 0.95 }),
    edge: ctx.mat(0xc8cacb),
  };
}

// An open parking deck over a plan: `decks` storeys above the ground at g0, parapet on top,
// two stair towers. Adds its geometry to Parts P.
export function parkingDeck(P, D, plan, decks, g0, foot = g0 - 1) {
  const top = g0 + decks * D.deckH;
  P.add(D.edge, walls(plan, foot, g0));
  const face = walls(plan, g0, top, [8, D.deckH]);
  // Shift v so each storey's parapet lines up with the deck levels above g0.
  const uv = face.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) - g0 / D.deckH);
  P.add(D.face, face);
  const inner = offsetPlan(plan, -0.3);
  P.add(D.edge, walls(plan, top, top + 1.1), cap(inner, top + 1.1));
  P.add(D.top, cap(inner, top + 0.04));
  const towers = offsetPlan(plan, -3);
  for (const i of [0, Math.floor(plan.length / 2)]) {
    const [x, z] = towers[i];
    P.add(D.edge, box(x - 2.5, x + 2.5, top, top + 2.8, z - 2.5, z + 2.5));
  }
  return top;
}

// Repeating canvas texture: draw(g, w, h) paints one tile.
export function tileTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Solid prism over a plan from y0 to y1 (walls and top; the bottom too when asked).
export function prism(poly, y0, y1, bottom = false) {
  const list = [walls(poly, y0, y1), cap(poly, y1)];
  if (bottom) list.push(cap(poly, y0, true));
  return merge(list);
}

// Outward unit normal of each edge of a plan.
function edgeNormals(poly) {
  const s = planArea(poly) > 0 ? 1 : -1;
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [(dz / l) * s, (-dx / l) * s];
  });
}

// Edges of a plan with length, unit tangent and outward unit normal.
export function edges(poly) {
  const N = edgeNormals(poly);
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    return { a, b, len, t: [dx / len, dz / len], n: N[i] };
  });
}

// Plan resampled to points about `step` metres apart along its outline (corners kept).
export function resamplePlan(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

// Skin between two rings with the same number of points: ring A at heights yA[i] and ring B at
// heights yB[i] (numbers or per-point arrays), faces pointing away from the plan's middle.
export function loft(A, yA, B, yB) {
  const n = A.length, hA = (i) => (Array.isArray(yA) ? yA[i] : yA), hB = (i) => (Array.isArray(yB) ? yB[i] : yB);
  const cw = planArea(A) > 0;
  const pos = [];
  for (let k = 0; k < n; k++) {
    // Same winding rule as walls(): on a clockwise plan run each edge backwards.
    const [i, j] = cw ? [(k + 1) % n, k] : [k, (k + 1) % n];
    const a0 = [A[i][0], hA(i), A[i][1]], a1 = [A[j][0], hA(j), A[j][1]], b0 = [B[i][0], hB(i), B[i][1]], b1 = [B[j][0], hB(j), B[j][1]];
    pos.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
  }
  return tris(pos);
}

// Plan offset outward by d (inward when negative), mitred, with spikes limited at sharp corners.
export function offsetPlan(poly, d) {
  const N = edgeNormals(poly), n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const n0 = N[(i + n - 1) % n], n1 = N[i];
    let mx = n0[0] + n1[0], mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const k = d / Math.max(mx * n1[0] + mz * n1[1], 0.35);
    out.push([poly[i][0] + mx * k, poly[i][1] + mz * k]);
  }
  return out;
}

// Point-in-polygon test for a plan.
export function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// Barrel vault along the local x axis, centred on the origin: length L, span S (along z),
// rising R above the springing height y0, in `segs` arc pieces. Returns the roof surface, the
// two end walls (filling the arch down to y0) and the arc as [z, y] points.
export function vault(L, S, R, y0, segs = 10) {
  const rad = (S * S / 4 + R * R) / (2 * R); // circle through the springing points and the crown
  const a0 = Math.asin(Math.min(1, S / 2 / rad));
  const cy = y0 + R - rad;
  const arc = [];
  for (let i = 0; i <= segs; i++) {
    const a = -a0 + (2 * a0 * i) / segs;
    arc.push([rad * Math.sin(a), cy + rad * Math.cos(a)]);
  }
  const pos = [], endPos = [];
  for (let i = 0; i < segs; i++) {
    const [z0, ya] = arc[i], [z1, yb] = arc[i + 1];
    pos.push(-L / 2, ya, z0, L / 2, ya, z0, L / 2, yb, z1, -L / 2, ya, z0, L / 2, yb, z1, -L / 2, yb, z1);
    for (const x of [-L / 2, L / 2]) endPos.push(x, y0, 0, x, ya, z0, x, yb, z1);
  }
  const roof = fixOutward(tris(pos), (x, y, z) => [0, y - cy, z]);
  const ends = fixOutward(tris(endPos), (x) => [Math.sign(x), 0, 0]);
  return { roof, ends, arc, rad, cy };
}

// Glazed dome over a stadium-shaped (racetrack) plan along the local x axis, centred on the
// origin: overall length L, span S, rising R above y0: a barrel vault between two half domes
// with the same profile. Returns the roof surface and the crown line's half length.
export function capsuleVault(L, S, R, y0, segs = 8) {
  const r = S / 2, straight = Math.max(0, L - S);
  const rad = (r * r + R * R) / (2 * R), theta = Math.asin(Math.min(1, r / rad)), cy = y0 + R - rad;
  const list = [];
  if (straight > 0) list.push(vault(straight, S, R, y0, segs * 2).roof);
  for (const s of [1, -1]) {
    const dome = new THREE.SphereGeometry(rad, segs * 2, segs, s > 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI, 0, theta);
    list.push(dome.translate((s * straight) / 2, cy, 0));
  }
  return { roof: merge(list), straight };
}

// Plan of a stadium shape (two half circles joined by straights) along the local x axis.
export function stadiumPlan(L, S, n = 10, cx = 0, cz = 0, yaw = 0) {
  const r = S / 2, h = Math.max(0, L - S) / 2, pts = [];
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (Math.PI * i) / n; pts.push([h + r * Math.cos(a), r * Math.sin(a)]); }
  for (let i = 0; i <= n; i++) { const a = Math.PI / 2 + (Math.PI * i) / n; pts.push([-h + r * Math.cos(a), r * Math.sin(a)]); }
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return pts.map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
}

// Turn plan points by yaw (radians, counter-clockwise from above, as rotateY) about (0, 0),
// then move them by (dx, dz).
export function turnPlan(pts, yaw, dx = 0, dz = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return pts.map(([x, z]) => [dx + x * c + z * s, dz - x * s + z * c]);
}

// Smooth ribbon through control points: pts = [[x, y, z], ...], across = [[ax, ay, az], ...]
// (the direction the ribbon spreads at each point), widths = [...] (full width at each point).
// Catmull-Rom through the points, `n` pieces; smooth normals (use a double-sided material).
export function ribbon(pts, across, widths, n = 40) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const m = pts.length - 1;
  const pos = [], idx = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const u = i / n, f = u * m, k = Math.min(m - 1, Math.floor(f)), t = f - k;
    const c = curve.getPoint(u);
    A.set(...across[k]).lerp(B.set(...across[k + 1]), t).normalize();
    const w = (widths[k] + (widths[k + 1] - widths[k]) * t) / 2;
    pos.push(c.x - A.x * w, c.y - A.y * w, c.z - A.z * w, c.x + A.x * w, c.y + A.y * w, c.z + A.z * w);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Rotate a geometry by yaw (radians, counter-clockwise from above) and move it to (x, y, z).
export const place = (g, x, y, z, yaw = 0) => g.rotateY(yaw).translate(x, y, z);

// Thin bar from a to b (THREE.Vector3), square section t.
const UP = new THREE.Vector3(0, 1, 0);
export function bar(a, b, t) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.BoxGeometry(t, d.length(), t);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

// Ground height at model-local (x, z), or `fallback` where the map has none (and in the studio).
export const groundAt = (ctx, x, z, fallback = 0) => ctx.ground(x, z) ?? fallback;

// Lowest ground under a set of points (to sink a part's foundations below the terrain).
export const lowestGround = (ctx, pts, fallback = 0) => pts.reduce((m, [x, z]) => Math.min(m, ctx.ground(x, z) ?? fallback), Infinity);

// True when model-local (x, z) is at least `margin` metres outside the driven road's edges.
export function clearOfRoute(ctx, x, z, margin = 1.5) {
  const r = ctx.route(x, z);
  if (!r) return true;
  return r.lat < r.left - margin || r.lat > r.right + margin;
}

// Canvas texture for a flat sign. lines = [{ text, size (fraction of the height), y and x
// (fractions), color, weight, font, maxW (fraction of the width) }].
export function signTexture(w, h, bg, lines, border = null) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = Math.max(2, h * 0.05);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const L of lines) {
    g.fillStyle = L.color ?? '#fff';
    g.font = `${L.weight ?? 'bold'} ${Math.round(h * (L.size ?? 0.5))}px ${L.font ?? 'Helvetica, Arial, sans-serif'}`;
    const maxW = w * (L.maxW ?? 0.92);
    const m = g.measureText(L.text).width;
    g.save();
    g.translate(w * (L.x ?? 0.5), h * (L.y ?? 0.5));
    if (m > maxW) g.scale(maxW / m, 1);
    g.fillText(L.text, 0, 0);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Glass that still reads as glass in the game, which gives landmarks no environment map
// (plain 'glass' would render nearly black there): less metal, a little rougher.
export const glass = (ctx, color) => ctx.mat(color, 'glass', { metalness: 0.35, roughness: 0.25 });
