import * as THREE from 'three';

// Floating items placed in random lanes ahead of the player, in route space.
// They are recycled once passed or collected.
export class Collectibles {
  constructor(scene, makeMesh, { count, y, firstGap, spacing, respawnMin, respawnRange, radius = 1.7 }) {
    Object.assign(this, { y, firstGap, spacing, respawnMin, respawnRange, radius });
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mesh = makeMesh();
      mesh.visible = false;
      scene.add(mesh);
      this.items.push(mesh);
    }
  }

  setRoute(route) {
    this.route = route;
  }

  place(item, s) {
    const r = this.route;
    if (s > r.length - 60) {
      item.visible = false;
      item.userData.s = Infinity;
      return;
    }
    const lane = (Math.random() * r.lanes(s)) | 0;
    item.userData.s = s;
    item.userData.lat = r.laneLat(lane, s);
    item.visible = true;
  }

  respawn(item, ps) {
    this.place(item, ps + this.respawnMin + Math.random() * this.respawnRange);
  }

  reset(ps) {
    this.items.forEach((it, i) => this.place(it, ps + this.firstGap + i * this.spacing));
  }

  // Returns how many items the player collected this frame.
  update(dt, t, player) {
    let got = 0;
    for (const it of this.items) {
      const { s, lat } = it.userData;
      if (!it.visible) continue;
      if (s < player.s - 20) {
        this.respawn(it, player.s);
        continue;
      }
      if (Math.abs(lat - player.x) < this.radius && Math.abs(s - player.s) < this.radius + 1.1) {
        got++;
        this.respawn(it, player.s);
        continue;
      }
      this.route.toWorld(s, lat, this.y + Math.sin(t * 3 + s) * 0.2, it.position);
      it.rotation.y += dt * 2;
    }
    return got;
  }
}

const canGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.1, 14);
const canMat = new THREE.MeshStandardMaterial({ color: 0x29b6ff, emissive: 0x29b6ff, emissiveIntensity: 1.2 });
const ringGeo = new THREE.TorusGeometry(0.8, 0.06, 8, 32);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x9be7ff });

export function makeNitroCan() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  g.add(new THREE.Mesh(canGeo, canMat), ring);
  return g;
}
