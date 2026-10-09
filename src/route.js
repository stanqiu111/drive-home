import * as THREE from 'three';
import { LANE_W, drivableLanes } from './lane-layout.js';

export { LANE_W };
export const MAX_LANES = 4;
const LAT_ACCEL = 22; // m/s², how hard cars can corner

// The driving line along a real road. Game logic works in route space:
//   s   = distance along the route (m), increasing towards the destination
//   lat = sideways offset (m), positive = right of the direction of travel
// toWorld() converts to three.js coordinates (x = east, z = south, y = up).
export class Route {
  constructor(d) {
    this.step = d.step;
    this.x = d.x;
    this.z = d.z;
    this.y = d.y;
    this.lanesArr = d.lanes;
    this.rightArr = d.right;
    this.leftArr = d.left;
    this.liftArr = d.lift ?? null; // metres each sample is raised for an overpass hump
    // Lane data for lane-layout.js (one-way flags, centre turn lanes), in its own shape.
    this.laneData = { step: d.step, right: d.right, left: d.left, lanes: d.lanes, ow: d.ow, ctr: d.ctr, laneFormat: d.laneFormat };
    this.cls = d.cls;
    this.bridge = d.bridge;
    this.names = d.names;
    this.n = d.x.length;
    this.length = (this.n - 1) * this.step;

    const n = this.n;
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2);
      const b = Math.min(n - 1, i + 2);
      const dx = this.x[b] - this.x[a];
      const dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }

    // Signed curvature (1/m), positive = turning right.
    const k = new Float32Array(n);
    const W = 4;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - W);
      const b = Math.min(n - 1, i + W);
      const cross = this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b];
      const dot = this.tx[a] * this.tx[b] + this.tz[a] * this.tz[b];
      k[i] = Math.atan2(cross, dot) / ((b - a) * this.step || 1);
    }
    this.curv = k;
    // Comfortable cornering speed at each sample.
    this.vmax = new Float32Array(n);
    for (let i = 0; i < n; i++) this.vmax[i] = Math.sqrt(LAT_ACCEL / Math.max(Math.abs(k[i]), 1e-4));
  }

  idx(s) {
    return Math.max(0, Math.min(this.n - 1, Math.round(s / this.step)));
  }

  // Interpolated centreline point and direction.
  frame(s, out = {}) {
    const f = Math.max(0, Math.min(this.n - 1.001, s / this.step));
    const i = Math.floor(f);
    const t = f - i;
    const lerp = (a) => a[i] + (a[i + 1] - a[i]) * t;
    out.x = lerp(this.x);
    out.z = lerp(this.z);
    out.y = lerp(this.y);
    let tx = lerp(this.tx);
    let tz = lerp(this.tz);
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    out.right = lerp(this.rightArr);
    out.left = lerp(this.leftArr);
    out.grade = (this.y[i + 1] - this.y[i]) / this.step;
    return out;
  }

  toWorld(s, lat, h, out = new THREE.Vector3()) {
    const f = this.frame(s, tmp);
    // Right-hand normal of the direction (tx, tz) is (-tz, tx).
    return out.set(f.x - f.tz * lat, f.y + h, f.z + f.tx * lat);
  }

  // Rotation (about y) that makes a -z-facing model point along the route.
  yaw(s) {
    const f = this.frame(s, tmp);
    return Math.atan2(-f.tx, -f.tz);
  }

  pitch(s) {
    return Math.atan(this.frame(s, tmp).grade);
  }

  // Lanes traffic and pickups may use at s: the lanes that fit (lane-layout.js), at most
  // MAX_LANES. Painted lines and stop lines use the real count from lane-layout.js.
  lanes(s) {
    const n = this.laneData.ow ? drivableLanes(this.laneData, s) : this.lanesArr[this.idx(s)];
    return Math.max(1, Math.min(MAX_LANES, n));
  }

  rightEdge(s) {
    return this.frame(s, tmp).right;
  }

  // Lane 0 is the rightmost lane in the direction of travel.
  laneLat(lane, s) {
    return this.rightEdge(s) - LANE_W * (lane + 0.5);
  }

  // Sideways limits for the player: the whole road, including the oncoming side
  // of two-way streets (traffic only drives our way, so it's free to pass there).
  latLimits(s, halfCar) {
    const f = this.frame(s, tmp);
    return [f.left - 0.3 + halfCar, f.right + 0.6 - halfCar];
  }

  // Lowest corner speed in the next `ahead` metres, and which way it turns.
  cornerAhead(s, ahead) {
    let v = Infinity;
    let dir = 0;
    const a = this.idx(s);
    const b = this.idx(s + ahead);
    for (let i = a; i <= b; i++) {
      if (this.vmax[i] < v) {
        v = this.vmax[i];
        dir = Math.sign(this.curv[i]);
      }
    }
    return { v, dir };
  }

  vmaxAt(s) {
    return this.vmax[this.idx(s)];
  }

  curvAt(s) {
    return this.curv[this.idx(s)];
  }

  nameAt(s) {
    const i = this.idx(s);
    let name = '';
    for (const [start, n] of this.names) {
      if (start > i) break;
      name = n;
    }
    return name;
  }
}

const tmp = {};
