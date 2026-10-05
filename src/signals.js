import * as THREE from 'three';
import { LANE_W } from './route.js';

const CYCLE = 24;
const GREEN = 12;
const YELLOW = 3;
const STOP_BACK = 7; // stop line distance before the signal

// Traffic lights at the real signalised intersections along the route.
export class Signals {
  constructor(scene, route, positions) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.6 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const lampGeo = new THREE.SphereGeometry(0.17, 12, 8);

    this.list = positions.map((s, i) => {
      const lanes = route.lanes(s);
      const right = route.rightEdge(s);
      const g = new THREE.Group();
      g.position.copy(route.toWorld(s, right + 1.3, 0));
      g.rotation.y = route.yaw(s);
      const armLen = lanes * LANE_W * 0.5 + 1.3;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 7, 8), poleMat);
      pole.position.y = 3.5;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.14, 0.14), poleMat);
      arm.position.set(-armLen / 2, 6.8, 0);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.4), headMat);
      head.position.set(-armLen, 6.1, 0);
      g.add(pole, arm, head);
      // Lamps face oncoming drivers (+z, since the route runs towards -z locally).
      const lamps = [0xff2a2a, 0xffc02a, 0x2aff6a].map((color, k) => {
        const m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0.05 });
        const lamp = new THREE.Mesh(lampGeo, m);
        lamp.position.set(-armLen, 6.55 - k * 0.45, 0.2);
        g.add(lamp);
        return m;
      });
      this.group.add(g);

      const line = new THREE.Mesh(new THREE.BoxGeometry(lanes * LANE_W, 0.02, 0.5), lineMat);
      line.position.copy(route.toWorld(s - STOP_BACK, right - (lanes * LANE_W) / 2, 0.06));
      line.rotation.y = route.yaw(s - STOP_BACK);
      this.group.add(line);

      return { s, stopS: s - STOP_BACK, offset: (i * 7.3) % CYCLE, lamps, state: 'green' };
    });
  }

  update(t) {
    for (const sig of this.list) {
      const p = (t + sig.offset) % CYCLE;
      sig.state = p < GREEN ? 'green' : p < GREEN + YELLOW ? 'yellow' : 'red';
      const on = sig.state === 'red' ? 0 : sig.state === 'yellow' ? 1 : 2;
      sig.lamps.forEach((m, k) => { m.emissiveIntensity = k === on ? 3 : 0.05; });
    }
  }

  // The first signal whose stop line is ahead of s, within range.
  nextAhead(s, range) {
    for (const sig of this.list) {
      if (sig.stopS < s - 0.5) continue;
      return sig.stopS - s < range ? sig : null;
    }
    return null;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
  }
}
