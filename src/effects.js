import * as THREE from 'three';

const POOL = 240;
const GRAVITY = 20;
const FIRE = [0xffe08a, 0xff9a2a, 0xff4a1f, 0x3a3a3a];

// Explosion debris and tyre smoke from a fixed pool of particles, drawn as two instanced
// meshes (one draw call each, however many are flying), plus shockwave rings and a flash of
// light. The flash light stays in the scene at zero brightness when idle: adding or removing
// a light would make every material's shader recompile.
export class Effects {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(0.45, 0.45, 0.45);
    this.fire = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), POOL);
    this.smoke = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xbfbfbf, transparent: true, opacity: 0.6 }), POOL);
    this.fire.setColorAt(0, new THREE.Color()); // per-particle colour
    this.fireColors = FIRE.map((c) => new THREE.Color(c));
    for (const m of [this.fire, this.smoke]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; // the particles move; they are always near the player anyway
      m.count = 0;
      m.visible = false;
      scene.add(m);
    }
    this.fire.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.parts = [];
    for (let i = 0; i < POOL; i++) {
      this.parts.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), life: 0, max: 1, smoke: false, color: 0, d: 0 });
    }
    this.next = 0;
    this.live = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.sc = new THREE.Vector3();

    this.flash = new THREE.PointLight(0xff8a3a, 0, 60, 1.5);
    scene.add(this.flash);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.25, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ring.visible = false;
    this.ringLife = 0;
    this.ringDir = new THREE.Vector3();
    scene.add(this.ring);
  }

  explode(x, y, z, count = 24, power = 1) {
    for (let i = 0; i < count; i++) {
      const p = this.parts[this.next];
      this.next = (this.next + 1) % POOL;
      p.smoke = false;
      p.color = i % FIRE.length;
      p.pos.set(x + (Math.random() - 0.5) * 2, y, z + (Math.random() - 0.5) * 3);
      p.vel.set((Math.random() - 0.5) * 16 * power, (4 + Math.random() * 10) * power, (Math.random() - 0.5) * 16 * power);
      p.life = p.max = 0.7 + Math.random() * 0.6;
    }
    this.flash.position.set(x, y + 2, z);
    this.flash.intensity = 80 * power;
  }

  // Tyre smoke while drifting.
  puff(x, y, z) {
    const p = this.parts[this.next];
    this.next = (this.next + 1) % POOL;
    p.smoke = true;
    p.pos.set(x, y, z);
    p.vel.set((Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2);
    p.life = p.max = 0.6;
  }

  // A ring that flies forward along dir (a unit vector).
  shockwave(pos, dir) {
    this.ring.position.copy(pos);
    this.ringDir.copy(dir);
    this.ring.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
    this.ringLife = 0.7;
    this.ring.visible = true;
  }

  // `eye` (the camera position) orders the smoke back to front, so it blends as before.
  update(dt, eye = null) {
    const fire = this.live;
    const smoke = this.liveSmoke ?? (this.liveSmoke = []);
    fire.length = 0;
    smoke.length = 0;
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (!p.smoke) p.vel.y -= GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.rot.x += dt * 8;
      p.rot.y += dt * 6;
      if (p.life > 0) (p.smoke ? smoke : fire).push(p);
    }
    if (eye && smoke.length > 1) {
      for (const p of smoke) p.d = p.pos.distanceToSquared(eye);
      smoke.sort((a, b) => b.d - a.d);
    }
    const place = (p) => {
      this.q.setFromEuler(p.rot);
      return this.m.compose(p.pos, this.q, this.sc.setScalar(Math.max(0.01, (p.life / p.max) * 1.6)));
    };
    const nf = fire.length;
    const ns = smoke.length;
    fire.forEach((p, i) => {
      this.fire.setMatrixAt(i, place(p));
      this.fire.setColorAt(i, this.fireColors[p.color]);
    });
    smoke.forEach((p, i) => this.smoke.setMatrixAt(i, place(p)));
    this.fire.count = nf;
    this.smoke.count = ns;
    this.fire.visible = nf > 0;
    this.smoke.visible = ns > 0;
    if (nf) {
      this.fire.instanceMatrix.needsUpdate = true;
      this.fire.instanceColor.needsUpdate = true;
    }
    if (ns) this.smoke.instanceMatrix.needsUpdate = true;
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
