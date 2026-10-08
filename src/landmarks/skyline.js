import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SKYLINE_TOWERS } from './skyline-data.js';

// Downtown Edmonton skyline: the towers that make the view read as Edmonton from 0.5-1.7 km.
// The origin is ground level under Stantec Tower; every other tower is placed with
// ctx.local(lon, lat) from the positions in skyline-data.js. Each tower is a few boxes or a
// prism with its real height and rough footprint plus one or two signature details (fins,
// spires, a notch, a flared top). All geometry is merged into one mesh per material.

const DEG = Math.PI / 180;
// The game gives landmarks no environment map, so plain 'glass' (metalness 0.7) would render
// almost black: dark glass keeps the finish with more diffuse, light glass is 'glossy'.
const GLASS = { metalness: 0.4, roughness: 0.3 };

class Parts {
  constructor(ctx) { this.ctx = ctx; this.map = new Map(); }
  add(geom, color, finish = 'matte') {
    const key = `${color}|${finish}`;
    if (!this.map.has(key)) this.map.set(key, { mat: this.ctx.mat(color, finish, finish === 'glass' ? GLASS : undefined), geoms: [] });
    this.map.get(key).geoms.push(geom.index ? geom.toNonIndexed() : geom);
  }
  // Box of w (east-west) x d (north-south), base at y0, centred on (x, z).
  box(w, h, d, x, y0, z, color, finish) {
    this.add(new THREE.BoxGeometry(w, h, d).translate(x, y0 + h / 2, z), color, finish);
  }
  // Vertical prism over a plan of [x, z] points (z = south), base at y0.
  prism(pts, h, y0, color, finish) {
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2).translate(0, y0, 0); // shape (x, -z) + depth -> world (x, y, z)
    this.add(g, color, finish);
  }
  // Profile of [z, y] points extruded w metres along x, centred on x.
  profileX(pts, w, x, color, finish) {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 1 });
    g.rotateY(Math.PI / 2).translate(x - w / 2, 0, 0); // shape (-z, y) + depth -> world (x, y, z)
    this.add(g, color, finish);
  }
  cyl(rTop, rBot, h, x, y0, z, seg, color, finish) {
    this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg).translate(x, y0 + h / 2, z), color, finish);
  }
  // Thin vertical bars along the four faces of a w x d block (plus corner piers): the
  // mullions, fins and ribs that make a far-away box read as a tower.
  bars(w, d, x, y0, h, z, spacing, size, color, finish, corners = true) {
    const t = size, out = size * 0.45;
    const run = (len, place) => {
      const n = Math.max(1, Math.round(len / spacing));
      for (let i = 1; i < n; i++) place(-len / 2 + (len * i) / n);
    };
    run(w, (u) => { this.box(t, h, t, x + u, y0, z - d / 2 - out + t / 2, color, finish); this.box(t, h, t, x + u, y0, z + d / 2 + out - t / 2, color, finish); });
    run(d, (v) => { this.box(t, h, t, x - w / 2 - out + t / 2, y0, z + v, color, finish); this.box(t, h, t, x + w / 2 + out - t / 2, y0, z + v, color, finish); });
    if (corners) {
      const c = t * 1.5;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(c, h, c, x + sx * (w / 2 + out - c / 2), y0, z + sz * (d / 2 + out - c / 2), color, finish);
    }
  }
  // Horizontal ring bands around a w x d block every `step` metres between y0 and y1.
  bands(w, d, x, z, y0, y1, step, thick, color, finish) {
    for (let y = y0 + step; y < y1 - 1; y += step) this.box(w + 0.8, thick, d + 0.8, x, y - thick / 2, z, color, finish);
  }
  group() {
    const g = new THREE.Group();
    for (const { mat, geoms } of this.map.values()) g.add(new THREE.Mesh(mergeGeometries(geoms, false), mat));
    return g;
  }
}

// Rotate plan points clockwise (seen from above) by yaw degrees and move them to (x, z).
const place = (pts, x, z, yaw) => {
  const c = Math.cos(yaw * DEG), s = Math.sin(yaw * DEG);
  return pts.map(([px, pz]) => [x + px * c - pz * s, z + px * s + pz * c]);
};
const scalePlan = (pts, k, cx = 0, cz = 0) => pts.map(([px, pz]) => [cx + (px - cx) * k, cz + (pz - cz) * k]);

// Oil-drop plan for Rogers Place: round end north, tail south. w = width, len = length.
function teardrop(w, len) {
  const R = w / 2, cz = -(len / 2 - R); // centre of the round end
  const pts = [];
  for (let a = 180; a <= 360; a += 12) pts.push([R * Math.cos(a * DEG), cz + R * Math.sin(a * DEG)]);
  const tip = [0, len / 2], side = (sx) => {
    const P0 = [sx * R, cz], C = [sx * R * 0.78, len * 0.27], P2 = [sx * 9, len / 2 - 8];
    const out = [];
    for (let i = 1; i <= 9; i++) {
      const t = i / 9, u = 1 - t;
      out.push([u * u * P0[0] + 2 * u * t * C[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * C[1] + t * t * P2[1]]);
    }
    return out;
  };
  pts.push(...side(1), [4, len / 2 - 1.5], tip, [-4, len / 2 - 1.5], ...side(-1).reverse());
  return pts;
}

const BUILDERS = {
  stantec(P, x, z, T) {
    // Podium (shared Ice District block), office floors, slimmer residential floors, notched top.
    P.box(96, 30, 72, x, -8, z, 0x46525e);
    P.box(97, 5, 73, x, 1, z, 0x3a5f7a, 'glass');
    P.box(52, 110, 46, x, 22, z, 0x5f8fb3, 'glass');
    P.bars(52, 46, x, 22, 110, z, 5.8, 1.2, 0xe4ebf0, 'matte', false);
    P.box(46, 100, 40, x, 132, z, 0x5f8fb3, 'glass');
    P.bars(46, 40, x, 132, 100, z, 5.7, 1.2, 0xe4ebf0, 'matte', false);
    P.box(46, 15, 26, x, 232, z + 7, 0x5f8fb3, 'glass'); // the top steps back on the north side
    P.bars(46, 26, x, 232, 15, z + 7, 5.7, 1.2, 0xe4ebf0, 'matte', false);
    P.box(46.8, 1.8, 14.8, x, 232, z - 13, 0xdfe9f0, 'glow'); // lit edge on the step
    P.box(44, T.h - 247, 24, x, 247, z + 7, 0xdfe9f0, 'glow'); // lit crown
  },
  marriott(P, x, z, T) {
    P.box(62, 30, 66, x, -8, z, 0x46525e);
    P.box(63, 5, 67, x, 1, z, 0x3a5f7a, 'glass');
    P.box(62, 159, 40, x, 22, z, 0x5e86a6, 'glass');
    P.box(22.6, 158.5, 40.6, x - 20, 22, z, 0x7a4a3e, 'glass'); // brownish-red glass strip, west side
    P.box(50, 6, 32, x + 2, 181, z, 0x8fb0c8, 'glossy');
    P.box(36, T.h - 187, 24, x + 2, 187, z, 0x8fb0c8, 'glossy');
  },
  epcor(P, x, z, T) {
    const roof = 137;
    P.box(82, roof + 8, 58, x, -8, z, 0xa9c6cf, 'glossy');
    P.bars(82, 58, x, 0, roof, z, 8.2, 1.1, 0xf2f4f5);
    P.bands(82, 58, x, z, 0, roof, 19.6, 0.8, 0xf2f4f5);
    P.box(83.2, 2.2, 59.2, x, roof, z, 0xf2f4f5);
    for (const dx of [16, 30]) P.cyl(0.35, 1.1, T.h - roof - 2, x + dx, roof + 2, z, 8, 0xf7f8f8); // the two spires
  },
  atb(P, x, z, T) {
    P.box(42, T.h + 8, 58, x, -8, z, 0x3f5a4e, 'glass');
    P.bars(42, 58, x, 0, T.h, z, 7, 1.0, 0x6a5a44);
    P.box(43, 2, 59, x, T.h - 1, z, 0x5a4a3a);
  },
  edmontonhouse(P, x, z, T) {
    const floors = 45, fh = (T.h - 2) / floors;
    P.box(31, T.h + 8, 30, x, -8, z, 0x6e6a60);
    for (let i = 0; i <= floors; i++) P.box(33, 0.4, 32, x, i * fh, z, 0xd9d2c4); // balcony slabs
    P.bars(31, 30, x, 0, T.h, z, 10.5, 1.1, 0xc8bfae);
    P.box(33, 2, 32, x, T.h - 2, z, 0xc8bfae);
  },
  lacombe(P, x, z, T) {
    P.box(52, 20, 44, x, -8, z, 0x7d6553);
    P.cyl(15, 15, 80, x, -8, z, 24, 0x6b5443);
    for (let i = 0; i < 24; i++) { // vertical concrete ribs
      const a = (i / 24) * Math.PI * 2;
      P.add(new THREE.BoxGeometry(0.9, 72, 0.9).rotateY(-a).translate(x + Math.cos(a) * 15.2, 36, z + Math.sin(a) * 15.2), 0x7d6553);
    }
    P.cyl(19.5, 15, 6, x, 72, z, 24, 0x5a4538); // flared revolving restaurant
    P.cyl(19.8, 19.8, 1.5, x, 78, z, 24, 0x3f3a36);
    P.cyl(5, 5, T.h - 79.5, x, 79.5, z, 12, 0x5a4538);
  },
  rogers(P, x, z, T) {
    const plan = teardrop(T.w, T.d), c = [0, -18];
    const at = (pts) => place(pts, x, z, T.yaw);
    P.prism(at(plan), 32, -6, 0xd4d7da, 'glossy'); // brushed stainless shell
    P.prism(at(scalePlan(plan, 1.012, ...c)), 7, 10, 0x2f4458, 'glass'); // glass band
    P.prism(at(scalePlan(plan, 0.86, ...c)), 9, 26, 0x4d5157); // stepped dark roof
    P.prism(at(scalePlan(plan, 0.62, ...c)), T.h - 35, 35, 0x4d5157);
  },
  nationalbank(P, x, z, T, ctx) {
    const [px, pz] = ctx.local(-113.494594, 53.542587);
    P.box(92, 15, 82, px, -8, pz, 0x9aa0a4); // shopping podium
    P.box(40, 148, 58, x, -8, z, 0x2f4d45, 'glass');
    P.bars(40, 58, x, 0, 140, z, 40, 1.4, 0x3d5c53, 'glass'); // corner piers only
    P.box(34, T.h - 140, 50, x, 140, z, 0x3b5c53, 'glass');
  },
  bell(P, x, z, T) {
    const a = 21.5, b = 11.5; // 43 m square with 10 m corner notches
    const plan = [[-a, -b], [-a, b], [-b, b], [-b, a], [b, a], [b, b], [a, b], [a, -b], [b, -b], [b, -a], [-b, -a], [-b, -b]];
    const at = (pts) => place(pts, x, z, 0);
    P.prism(at(plan), T.h + 8, -8, 0x7c8791, 'glossy');
    const band = at(scalePlan(plan, 1.02));
    for (let y = 8.1; y < T.h - 2; y += 8.1) P.prism(band, 0.8, y, 0xc9cdd1); // aluminium bands
    P.prism(band, 2, T.h - 1, 0xc9cdd1);
  },
  edmontontower(P, x, z, T) {
    P.box(92, 26, 53, x, -8, z, 0x8b949c); // block-long podium
    P.box(50, 108, 36, x - 10, 18, z, 0x8fb3cf, 'glossy');
    P.bars(50, 36, x - 10, 18, 110, z, 60, 1.6, 0xf1f3f4, 'matte'); // white picture frame: corners
    P.profileX([[-18.5, 126], [18.5, 126], [18.5, T.h], [-18.5, 126.6]], 51, x - 10, 0xf1f3f4); // sloped roof
  },
  commerce(P, x, z, T, ctx) {
    const [px, pz] = ctx.local(-113.494848, 53.541704);
    P.box(90, 20, 136, px, -8, pz, 0xb57865); // the Shops at Commerce Place
    P.box(37, 121, 67, x, -8, z, 0x74a5a9, 'glossy');
    P.bands(37, 67, x, z, 0, 113, 7.5, 0.9, 0xb59b92);
    P.box(31, 6, 57, x, 113, z, 0xb59b92); // stepped granite crown
    P.box(23, T.h - 119, 45, x, 119, z, 0xb59b92);
  },
  cntower(P, x, z, T) {
    P.box(46, 20, 79, x, -8, z, 0xc9bda6);
    P.box(28, 117, 70, x, -8, z, 0x3b3f44);
    P.bars(28, 70, x, 0, T.h - 2, z, 4.1, 1.0, 0xd5cab2); // concrete grid: verticals
    P.bands(28, 70, x, z, 0, T.h - 2, 4.0, 0.7, 0xd5cab2); // and floor lines
    P.box(29.2, 2, 71.2, x, T.h - 2, z, 0xd5cab2);
  },
  enbridge(P, x, z, T) {
    P.box(68, 28, 50, x, -8, z, 0x8a4a3c); // red-brick heritage base
    P.box(69, 1, 51, x, 18.5, z, 0xd9c7a8); // stone cornice
    P.box(38, 89, 40, x, 20, z, 0x6f94ad, 'glossy');
    P.bars(38, 40, x, 20, 91, z, 40, 1.6, 0xe9ecee);
    P.box(39.2, 2, 41.2, x, T.h - 2, z, 0xe9ecee);
  },
  encore(P, x, z, T) {
    P.box(34, T.h + 6, 35, x, -8, z, 0x7fa2b4, 'glossy');
    for (let y = 6; y < T.h - 3; y += 6) P.box(36, 0.5, 37, x, y, z, 0xe4e6e6); // balcony slabs
    P.bars(34, 35, x, 0, T.h, z, 40, 1.6, 0xe4e6e6);
    P.box(36, 2, 37, x, T.h - 2, z, 0xe4e6e6);
  },
};

export function build(ctx) {
  const P = new Parts(ctx);
  for (const T of SKYLINE_TOWERS) {
    const [x, z] = ctx.local(T.lon, T.lat);
    BUILDERS[T.id]?.(P, x, z, T, ctx);
  }
  return P.group();
}
