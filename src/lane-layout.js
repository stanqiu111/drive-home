// Painted road lines and lane positions, worked out in route space from the lane data the
// map builder writes. This is the ONLY place that decides where lines go: world.js turns
// the plan into meshes, signals.js asks it where stop lines end, route.js asks it how many
// lanes traffic can use, and tools/check-roads.mjs checks the same plan for every map, so
// none of them can disagree. Plain JavaScript with no three.js import, so the checker
// runs in Node. Rules: see "Road lines" in CLAUDE.md.
//
// Route data per 2 m sample (written by tools/build-maps.mjs, laneFormat 2):
//   right, left  road edges, metres right (+) / left (-) of the route line
//   lanes        our lanes (direction of travel)
//   ow           1 = one-way carriageway, 0 = two-way road, 2 = unmarked two-way (parking
//                lots and service roads at the route ends)
//   ctr          two-way roads only: lanes in the middle (a centre turn lane), else 0
// On two-way roads the middle of the road (between the two directions) is the route line,
// so the centre lines sit at lat 0. One-way carriageways have their lanes counted in from
// the right edge.

export const LANE_W = 3.5;
export const LANE_FORMAT = 2;
export const DASH = 3;          // dash length (m)
export const DASH_EVERY = 12;   // dash period (m)
export const TAPER_MAX = 0.18;  // m per sample: most a road edge may move sideways (builder)
export const EDGE_ROUND = 0.1;  // the builder stores edges rounded to 0.1 m
export const MAX_SIDESTEP = TAPER_MAX + EDGE_ROUND + 0.02; // per sample, for the checker
export const OW_ZONE = 12;      // samples either side of a one-way/two-way change without dashes
const EDGE_IN = 0.25;           // solid edge line, inset from the asphalt edge
const ROOM = 0.75 * LANE_W;     // a lane line needs at least this much road beyond it
// Lines stop at a signal's stop line and start again past the intersection. The builder
// writes each signal as [s, stop, end] from the real junction; old map files have plain
// numbers, which use these fixed distances.
export const STOP_BACK = 7;     // stop line distance before the signal (m), old files
export const BOX_AFTER = 9;     // intersection ends this far past the signal (m), old files
const MIN_DASH = 1.5;           // m: shorter dash pieces (where a lane starts) are left out
const FOLD = 0.8;               // a line closer than this share of the turn radius to the turn's centre folds over

// The lane data every function here takes, built from a map file's route the same way by
// the game (route.js) and the checker, so the checker always tests what the game draws.
export function laneInput(d) {
  return { step: d.step, x: d.x, z: d.z, right: d.right, left: d.left, lanes: d.lanes, ow: d.ow, ctr: d.ctr, laneFormat: d.laneFormat };
}

export function hasLaneData(rd) {
  return rd.laneFormat === LANE_FORMAT && Array.isArray(rd.ow);
}

// Index helpers on route arrays.
const clampI = (rd, i) => Math.max(0, Math.min(rd.right.length - 1, i));
export function lerpAt(rd, arr, s) {
  const n = arr.length;
  const f = Math.max(0, Math.min(n - 1.001, s / rd.step));
  const i = Math.floor(f);
  return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
}
const near = (rd, arr, s) => arr[clampI(rd, Math.round(s / rd.step))];
const twoWayAt = (rd, s) => near(rd, rd.ow, s) !== 1;

// Half the width of a centre turn lane, tapered like the road edges (the builder's 21-sample
// moving average), so lines beside it glide instead of jumping when it starts or ends.
const halfCache = new WeakMap();
function centreHalf(rd, s) {
  if (!rd.ctr) return 0;
  let h = halfCache.get(rd);
  if (!h) {
    const n = rd.ctr.length;
    h = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.min(10, i, n - 1 - i);
      let sum = 0;
      for (let j = i - k; j <= i + k; j++) sum += rd.ctr[j];
      h[i] = (sum / (2 * k + 1)) * LANE_W / 2;
    }
    halfCache.set(rd, h);
  }
  return lerpAt(rd, h, s);
}

// Where our side of the road starts: the left edge of a one-way carriageway, or the
// middle of a two-way road (past any centre turn lane).
export function ourInnerEdge(rd, s) {
  return twoWayAt(rd, s) ? centreHalf(rd, s) : lerpAt(rd, rd.left, s);
}

// How many of our lanes fit at s (the lane count steps while the edges taper).
export function drivableLanes(rd, s) {
  const width = lerpAt(rd, rd.right, s) - ourInnerEdge(rd, s);
  return Math.max(1, Math.min(near(rd, rd.lanes, s), Math.floor(width / LANE_W + 0.25)));
}

// Stop line extent at s: across our lanes only.
export function stopLineExtent(rd, s) {
  return [ourInnerEdge(rd, s) + 0.15, lerpAt(rd, rd.right, s) - 0.15];
}

// Signals as { s, stop, end }.
export function signalList(signals = []) {
  return signals.map((v) => (Array.isArray(v) ? { s: v[0], stop: v[1], end: v[2] } : { s: v, stop: v - STOP_BACK, end: v + BOX_AFTER }));
}

// Signals the game builds: none in the last 120 m (the finish).
export function activeSignals(signals = [], length) {
  return signalList(signals).filter((g) => g.s < length - 120);
}

// Signed curvature of the route line per sample (1/m, + = turning right), as in route.js.
const curvCache = new WeakMap();
export function routeCurvature(rd) {
  let k = curvCache.get(rd);
  if (k) return k;
  const n = rd.x.length;
  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2);
    const b = Math.min(n - 1, i + 2);
    const l = Math.hypot(rd.x[b] - rd.x[a], rd.z[b] - rd.z[a]) || 1;
    tx[i] = (rd.x[b] - rd.x[a]) / l;
    tz[i] = (rd.z[b] - rd.z[a]) / l;
  }
  k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 4);
    const b = Math.min(n - 1, i + 4);
    k[i] = Math.atan2(tx[a] * tz[b] - tz[a] * tx[b], tx[a] * tx[b] + tz[a] * tz[b]) / ((b - a) * rd.step || 1);
  }
  curvCache.set(rd, k);
  return k;
}

// Sample flags shared by the plan and the checker.
export function laneZones(rd, signals = []) {
  const n = rd.right.length;
  const owZone = new Uint8Array(n);
  for (let i = 1; i < n; i++) {
    if ((rd.ow[i] === 1) === (rd.ow[i - 1] === 1)) continue;
    for (let j = Math.max(0, i - OW_ZONE); j < Math.min(n, i + OW_ZONE); j++) owZone[j] = 1;
  }
  const boxes = signals.map((g) => [g.stop + 0.3, g.end]);
  return { owZone, boxes };
}

// Every painted line: { color: 'white' | 'yellow', width, slot, pts: [[s, lat], ...] }.
// `lat` is metres right of the route line, as in Route.toWorld(). Dashes of one lane
// boundary share a `slot`, so the checker can follow them from dash to dash.
export function markingPlan(rd, signals = []) {
  if (!hasLaneData(rd)) {
    // Old map file: no reliable one-way data, so draw no lines rather than guess.
    console.error('Map has no lane data (laneFormat 2): rebuild it with node tools/build-maps.mjs');
    return [];
  }
  const { step } = rd;
  const n = rd.right.length;
  const R = rd.right;
  const L = rd.left;
  const last = (n - 1) * step - 12; // lines stop just before the finish banner
  const { owZone, boxes } = laneZones(rd, signals);
  const inBox = (s) => boxes.some(([a, b]) => s > a && s < b);
  const at = (arr, s) => lerpAt(rd, arr, s);
  const curv = routeCurvature(rd);
  // On a turn tighter than the road is wide, lines on the inside would fold over.
  const folds = (s, lat) => lat * curv[clampI(rd, Math.round(s / step))] > FOLD;

  const out = [];
  // A line along the route made of runs where `latAt(s)` is not null. `dashed` keeps only
  // the first DASH metres of every DASH_EVERY.
  const line = (color, width, slot, latAt, dashed = false) => {
    let cur = null;
    const push = (s) => {
      let lat = inBox(s) ? null : latAt(s);
      if (lat != null && folds(s, lat)) lat = null;
      if (lat == null) { cur = null; return; }
      if (!cur) { cur = { color, width, slot, pts: [] }; out.push(cur); }
      cur.pts.push([s, lat]);
    };
    if (!dashed) {
      for (let s = 0; s <= last + 1e-6; s += step) push(s);
      return;
    }
    for (let s0 = 0; s0 < last; s0 += DASH_EVERY) {
      cur = null;
      for (let s = s0; s < s0 + DASH - 1e-6; s += step) push(s);
      push(Math.min(s0 + DASH, last));
      const d = out[out.length - 1];
      if (cur && d === cur && d.pts[d.pts.length - 1][0] - d.pts[0][0] < MIN_DASH) out.pop();
      cur = null;
    }
  };
  const ow = (s) => near(rd, rd.ow, s);
  const zone = (s) => owZone[clampI(rd, Math.round(s / step))] === 1;
  const maxLanes = Math.max(...rd.lanes);

  // Solid edges, everywhere (also on unmarked roads).
  line('white', 0.15, 'edge-r', (s) => at(R, s) - EDGE_IN);
  line('white', 0.15, 'edge-l', (s) => at(L, s) + EDGE_IN);

  // One-way carriageways: dashes between our lanes, counted in from the right edge (lane 0
  // is the rightmost), as many as fit.
  for (let k = 1; k < maxLanes; k++) {
    line('white', 0.15, `ow-${k}`, (s) => {
      if (ow(s) !== 1 || zone(s) || near(rd, rd.lanes, s) <= k) return null;
      const lat = at(R, s) - k * LANE_W;
      return lat - at(L, s) >= ROOM * 0.66 ? lat : null;
    }, true);
  }

  // Two-way roads: centre lines at the middle of the road (lat 0), or around a centre turn
  // lane; lane dashes whole lanes either side. When a lane is added or dropped the outer
  // edge tapers and that lane's dashes stop once it is too narrow, so no line slides.
  const marked = (s) => ow(s) === 0 && at(R, s) >= ROOM && -at(L, s) >= ROOM;
  const half = (s) => centreHalf(rd, s);
  // A plain double yellow where there is no centre turn lane; once the turn lane is at least
  // a metre wide, solid yellow outside and dashed yellow inside it, on both sides.
  const turn = (s) => half(s) >= 0.5;
  for (const off of [-0.12, 0.12]) line('yellow', 0.1, `ctr${off}`, (s) => (marked(s) && !turn(s) ? off : null));
  for (const side of [-1, 1]) {
    line('yellow', 0.1, `turn-solid${side}`, (s) => (marked(s) && turn(s) ? side * (half(s) + 0.1) : null));
    line('yellow', 0.1, `turn-dash${side}`, (s) => (marked(s) && turn(s) ? side * (half(s) - 0.1) : null), true);
  }
  for (let k = 1; k < maxLanes; k++) {
    line('white', 0.15, `tw-r${k}`, (s) => {
      if (!marked(s) || zone(s)) return null;
      const lat = half(s) + k * LANE_W;
      return at(R, s) - lat >= ROOM * 0.66 ? lat : null;
    }, true);
    line('white', 0.15, `tw-l${k}`, (s) => {
      if (!marked(s) || zone(s)) return null;
      const lat = -half(s) - k * LANE_W;
      return lat - at(L, s) >= ROOM * 0.66 ? lat : null;
    }, true);
  }
  return out;
}
