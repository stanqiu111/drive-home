import * as THREE from 'three';
import { makeCar, spinWheels, TRAFFIC_MIX, TRAFFIC_COLORS } from './cars.js';

const COUNT = 14;
const SAFE_GAP = 6;
const LANE_CHANGE_SPEED = 2.5;
const GRAVITY = 20;
const AHEAD_MIN = 250;
const AHEAD_MAX = 750;
// Cruise speed range (m/s) by road class: residential, collector, arterial, highway.
const CRUISE = [[8, 11], [10, 14], [14, 19], [22, 29]];
// Chance to skip spawning on quieter roads.
const SKIP = [0.85, 0.6, 0.2, 0];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pick = (a) => a[(Math.random() * a.length) | 0];

// Traffic driving the same way as the player, in route space (s, lat).
export class Traffic {
  constructor(scene, effects) {
    this.effects = effects;
    this.cars = [];
    for (let i = 0; i < COUNT; i++) {
      const mesh = makeCar(TRAFFIC_MIX[i % TRAFFIC_MIX.length], pick(TRAFFIC_COLORS));
      mesh.visible = false;
      scene.add(mesh);
      this.cars.push({ mesh, len: mesh.userData.len, s: 0, lat: 0, y: 0, speed: 0, cruise: 0, lane: 0, targetLane: 0, flying: null, active: false });
    }
  }

  setWorld(route, signals) {
    this.route = route;
    this.signals = signals;
  }

  place(c, lane, s) {
    const [lo, hi] = CRUISE[this.route.cls[this.route.idx(s)]];
    Object.assign(c, { lane, targetLane: lane, s, lat: this.route.laneLat(lane, s), y: 0, flying: null, active: true });
    c.cruise = lo + Math.random() * (hi - lo);
    c.speed = c.cruise * 0.7;
    c.mesh.rotation.set(0, 0, 0);
    c.mesh.userData.bodyMat.color.setHex(pick(TRAFFIC_COLORS));
    c.mesh.visible = true;
  }

  deactivate(c) {
    c.active = false;
    c.flying = null;
    c.mesh.visible = false;
  }

  isClear(lane, s, self, player, range = 12) {
    const lat = this.route.laneLat(lane, s);
    if (Math.abs(player.x - lat) < 2.5 && Math.abs(player.s - s) < range) return false;
    return !this.cars.some((o) => o !== self && o.active && Math.abs(o.lat - lat) < 2.5 && Math.abs(o.s - s) < range);
  }

  tryPlace(c, player, sMin, sMax) {
    const r = this.route;
    for (let tries = 0; tries < 12; tries++) {
      const s = sMin + Math.random() * (sMax - sMin);
      if (s < 5 || s > r.length - 40) continue;
      if (Math.random() < SKIP[r.cls[r.idx(s)]]) continue;
      const lane = (Math.random() * r.lanes(s)) | 0;
      if (this.isClear(lane, s, c, player)) {
        this.place(c, lane, s);
        return true;
      }
    }
    this.deactivate(c);
    return false;
  }

  reset(player) {
    for (const c of this.cars) this.deactivate(c);
    for (const c of this.cars) this.tryPlace(c, player, player.s + 30, player.s + AHEAD_MAX);
  }

  // Sends a car tumbling through the air, away from the player.
  launch(c, player) {
    const side = Math.sign(c.lat - player.x) || (Math.random() < 0.5 ? -1 : 1);
    c.flying = {
      vlat: side * (4 + Math.random() * 6),
      vy: 10 + Math.random() * 6,
      vs: player.speed + 8 + Math.random() * 10,
      spin: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 10),
    };
  }

  updateFlying(c, dt, player) {
    const f = c.flying;
    f.vy -= GRAVITY * dt;
    c.lat += f.vlat * dt;
    c.y += f.vy * dt;
    c.s += f.vs * dt;
    c.mesh.rotation.x += f.spin.x * dt;
    c.mesh.rotation.y += f.spin.y * dt;
    c.mesh.rotation.z += f.spin.z * dt;
    this.route.toWorld(c.s, c.lat, c.y, c.mesh.position);
    if (c.y < 0 && f.vy < 0) {
      const p = c.mesh.position;
      this.effects.explode(p.x, p.y + 0.5, p.z, 16, 0.7);
      this.tryPlace(c, player, player.s + AHEAD_MIN, player.s + AHEAD_MAX);
    }
  }

  update(dt, t, player) {
    const r = this.route;
    for (const c of this.cars) {
      if (!c.active) {
        if (Math.random() < dt * 1.5) this.tryPlace(c, player, player.s + AHEAD_MIN, player.s + AHEAD_MAX);
        continue;
      }
      if (c.flying) {
        this.updateFlying(c, dt, player);
        continue;
      }

      // Slow "jam waves" roll along the road so traffic bunches up in places.
      const jam = 0.5 + 0.5 * Math.sin(c.s * 0.0035 + t * 0.1);
      let target = Math.min(c.cruise * (0.5 + 0.5 * jam), r.cornerAhead(c.s, 40).v);

      let gap = Infinity;
      let aheadSpeed = 0;
      const consider = (g, speed) => {
        if (g < gap) { gap = g; aheadSpeed = speed; }
      };
      for (const o of this.cars) {
        if (o === c || !o.active || o.flying || o.s <= c.s) continue;
        if (Math.abs(o.lat - c.lat) < 2.2) consider(o.s - c.s - (o.len + c.len) / 2, o.speed);
      }
      if (player.y < 1.5 && player.s > c.s && Math.abs(player.x - c.lat) < 2.2) {
        consider(player.s - c.s - (player.len + c.len) / 2, player.speed);
      }
      const sig = this.signals?.nextAhead(c.s, 90);
      if (sig && (sig.state === 'red' || (sig.state === 'yellow' && sig.stopS - c.s > 15))) {
        consider(sig.stopS - c.s - c.len / 2, 0);
      }

      if (gap < SAFE_GAP * 2) target = Math.min(target, aheadSpeed + (gap - SAFE_GAP) * 0.8);
      target = Math.max(0, target);
      const braking = c.speed > target + 0.3;
      c.speed = Math.max(0, c.speed + clamp(target - c.speed, -12 * dt, 4 * dt));
      c.mesh.userData.tailMat.emissiveIntensity = braking ? 3 : 0.6;

      // Merge when a lane ends, and sometimes change lanes when blocked.
      const lanes = r.lanes(c.s + 25);
      if (c.targetLane >= lanes) c.targetLane = lanes - 1;
      if (gap < 15 && c.lane === c.targetLane && Math.random() < dt * 0.3) {
        const next = c.lane + (Math.random() < 0.5 ? -1 : 1);
        if (next >= 0 && next < lanes && this.isClear(next, c.s - 2, c, player, 10)) c.targetLane = next;
      }
      const dx = r.laneLat(c.targetLane, c.s) - c.lat;
      const changing = c.lane !== c.targetLane;
      const rate = changing ? LANE_CHANGE_SPEED : 6;
      c.lat += clamp(dx, -rate * dt, rate * dt);
      if (changing && Math.abs(dx) < 0.05) c.lane = c.targetLane;

      const ds = c.speed * dt;
      c.s += ds;
      if (c.s < player.s - 40 || c.s > player.s + 900) {
        this.tryPlace(c, player, player.s + AHEAD_MIN, player.s + AHEAD_MAX);
        continue;
      }
      if (c.s > r.length - 25) {
        this.deactivate(c);
        continue;
      }
      r.toWorld(c.s, c.lat, 0, c.mesh.position);
      c.mesh.rotation.set(r.pitch(c.s), r.yaw(c.s) - (changing ? Math.sign(dx) * 0.08 : 0), 0);
      spinWheels(c.mesh, ds);
    }
  }
}
