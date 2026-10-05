import * as THREE from 'three';

const POOL = 240;
const GRAVITY = 20;

// Explosion debris and shockwave rings, drawn from fixed pools.
export class Effects {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    const mats = [0xffe08a, 0xff9a2a, 0xff4a1f, 0x3a3a3a].map((color) => new THREE.MeshBasicMaterial({ color }));
    this.fireMats = mats;
    this.smokeMat = new THREE.MeshBasicMaterial({ color: 0xbfbfbf, transparent: true, opacity: 0.6 });
    this.parts = [];
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Mesh(geo, mats[i % mats.length]);
      mesh.visible = false;
      scene.add(mesh);
      this.parts.push({ mesh, vel: new THREE.Vector3(), life: 0, max: 1 });
    }
    this.next = 0;

    this.flash = new THREE.PointLight(0xff8a3a, 0, 60, 1.5);
    scene.add(this.flash);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.25, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ring.visible = false;
    this.ringLife = 0;
    scene.add(this.ring);
  }

  explode(x, y, z, count = 24, power = 1) {
    for (let i = 0; i < count; i++) {
      const p = this.parts[this.next];
      this.next = (this.next + 1) % POOL;
      p.mesh.material = this.fireMats[i % this.fireMats.length];
      p.mesh.position.set(x + (Math.random() - 0.5) * 2, y, z + (Math.random() - 0.5) * 3);
      p.vel.set((Math.random() - 0.5) * 16 * power, (4 + Math.random() * 10) * power, (Math.random() - 0.5) * 16 * power);
      p.life = p.max = 0.7 + Math.random() * 0.6;
      p.mesh.visible = true;
    }
    this.flash.position.set(x, y + 2, z);
    this.flash.intensity = 80 * power;
  }

  // Tyre smoke while drifting.
  puff(x, y, z) {
    const p = this.parts[this.next];
    this.next = (this.next + 1) % POOL;
    p.mesh.material = this.smokeMat;
    p.mesh.position.set(x, y, z);
    p.vel.set((Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2);
    p.life = p.max = 0.6;
    p.mesh.visible = true;
  }

  // A ring that flies forward along dir (a unit vector).
  shockwave(pos, dir) {
    this.ring.position.copy(pos);
    this.ringDir = dir.clone();
    this.ring.lookAt(pos.clone().add(dir));
    this.ringLife = 0.7;
    this.ring.visible = true;
  }

  update(dt) {
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.mesh.material !== this.smokeMat) p.vel.y -= GRAVITY * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 8;
      p.mesh.rotation.y += dt * 6;
      p.mesh.scale.setScalar(Math.max(0.01, (p.life / p.max) * 1.6));
      if (p.life <= 0) p.mesh.visible = false;
    }
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 200);

    if (this.ringLife > 0) {
      this.ringLife -= dt;
      const k = 1 - this.ringLife / 0.7;
      this.ring.position.addScaledVector(this.ringDir, dt * 120);
      this.ring.scale.setScalar(2 + k * 14);
      this.ring.material.opacity = 1 - k;
      if (this.ringLife <= 0) this.ring.visible = false;
    }
  }
}
