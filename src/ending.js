import * as THREE from 'three';

// The finish cutscene: the car parks on the curb, the driver jumps out, a couch
// and TV pop out of the ground and they start gaming immediately.
//
// Everything is laid out in a local frame at the end of the route:
// x = metres to the right of the road centre, -z = forward, y = up.

const DRIVE_TIME = 2.4;
const CARD_TIME = 4.8;
const START_Z = 34;
const PARK_Z = 4;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => {
  const k = clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
const elasticOut = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 2 ** (-10 * k) * Math.sin(((k * 10 - 0.75) * 2 * Math.PI) / 3) + 1);
const mat = (color, emissive = 0) => new THREE.MeshStandardMaterial({ color, emissive, roughness: 0.7 });

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function limb(w, h, d, material, x, y) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  pivot.add(box(w, h, d, material, 0, -h / 2, 0));
  return pivot;
}

// Blocky person. Faces -z.
function makePerson() {
  const group = new THREE.Group();
  const skin = mat(0xf1c27d);
  const shirt = mat(0x2f7de1);
  const pants = mat(0x2b2f45);
  const black = mat(0x111111);
  group.add(
    box(0.55, 0.7, 0.32, shirt, 0, 1.15, 0),
    box(0.38, 0.38, 0.38, skin, 0, 1.72, 0),
    box(0.42, 0.12, 0.42, mat(0x2a1a10), 0, 1.95, 0.02),
    box(0.06, 0.06, 0.02, black, -0.09, 1.76, -0.2),
    box(0.06, 0.06, 0.02, black, 0.09, 1.76, -0.2),
  );
  const legs = [-0.14, 0.14].map((x) => limb(0.2, 0.8, 0.24, pants, x, 0.8));
  const arms = [-0.36, 0.36].map((x) => limb(0.16, 0.65, 0.18, shirt, x, 1.45));
  group.add(...legs, ...arms);
  const controller = box(0.38, 0.08, 0.18, black, 0, 1.12, -0.56);
  group.add(controller);
  return { group, legs, arms, controller };
}

function makeBubble() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(3.4, 0.85, 1);
  sprite.renderOrder = 10;
  let current = '';
  sprite.userData.setText = (text) => {
    if (text === current) return;
    current = text;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = '#fff';
    g.beginPath();
    g.roundRect(8, 8, 496, 100, 40);
    g.fill();
    g.beginPath();
    g.moveTo(230, 104);
    g.lineTo(256, 126);
    g.lineTo(282, 104);
    g.fill();
    g.fillStyle = '#1a1020';
    g.font = 'bold 54px -apple-system, Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 60);
    tex.needsUpdate = true;
  };
  return sprite;
}

export class Ending {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);

    this.person = makePerson();
    this.root.add(this.person.group);

    this.couch = new THREE.Group();
    const fabric = mat(0x8e3b46);
    this.couch.add(
      box(2.4, 0.5, 1, fabric, 0, 0.25, 0),
      box(2.4, 0.8, 0.25, fabric, 0, 0.75, 0.45),
      box(0.25, 0.7, 1, fabric, -1.2, 0.45, 0),
      box(0.25, 0.7, 1, fabric, 1.2, 0.45, 0),
    );
    this.root.add(this.couch);

    this.tv = new THREE.Group();
    this.screenMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.6), this.screenMat);
    screen.position.set(0, 1.9, 0.08);
    this.tv.add(
      box(0.3, 1.0, 0.3, mat(0x222222), 0, 0.5, 0),
      box(3, 1.8, 0.15, mat(0x151515), 0, 1.9, 0),
      screen,
      box(0.6, 0.15, 0.4, mat(0x222222, 0x1e6bff), 0.9, 0.08, 0.4),
    );
    this.root.add(this.tv);

    this.bubble = makeBubble();
    this.root.add(this.bubble);
    this.tmp = new THREE.Vector3();
    this.reset();
  }

  // Lay out the scene at the end of a route.
  setRoute(route, heightAt, cheer) {
    this.route = route;
    this.heightAt = heightAt;
    this.cheer = cheer;
    const L = route.length;
    this.root.position.copy(route.toWorld(L, 0, 0));
    this.root.rotation.set(0, route.yaw(L), 0);
    this.root.updateMatrixWorld(true);
    const R = route.rightEdge(L);
    this.laneX = route.laneLat(0, L);
    this.parkX = R + 2.6;
    this.couchX = R + 8.5;
    this.couchZ = 0;
    this.tvZ = -4.5;
    this.couch.position.set(this.couchX, this.ground(this.couchX, this.couchZ) + 0.1, this.couchZ);
    this.tv.position.set(this.couchX, this.ground(this.couchX, this.tvZ) + 0.1, this.tvZ);
  }

  // Ground height in the local frame (falls back to road level).
  ground(x, z) {
    const w = this.root.localToWorld(this.tmp.set(x, 0, z));
    const g = this.heightAt(w.x, w.z);
    return g == null ? 0 : Math.max(0, g - this.root.position.y);
  }

  reset() {
    this.active = false;
    this.cardShown = false;
    this.t = 0;
    this.root.visible = false;
  }

  start() {
    this.reset();
    this.active = true;
    this.root.visible = true;
    this.carX = this.laneX;
    this.carZ = START_Z;
    this.carYaw = 0;
  }

  // Moves the player's car and the camera. Returns true once, when the result card should appear.
  update(dt, car, camera) {
    if (!this.active) return false;
    const t = (this.t += dt);
    const p = this.person;

    // 1. Car drives in and parks on the curb.
    const u = clamp(t / DRIVE_TIME, 0, 1);
    const nz = START_Z - (START_Z - PARK_Z) * (1 - (1 - u) ** 3);
    const nx = this.laneX + (this.parkX - this.laneX) * smooth(0.3, 0.9, u);
    if (u < 1) this.carYaw = Math.atan2(-(nx - this.carX), -(nz - this.carZ));
    else this.carYaw *= 1 - Math.min(1, dt * 6);
    const moved = Math.hypot(nx - this.carX, nz - this.carZ);
    this.carX = nx;
    this.carZ = nz;
    const carY = Math.max(0, this.ground(nx, nz));
    car.position.copy(this.root.localToWorld(this.tmp.set(nx, carY, nz)));
    car.rotation.set(0, this.root.rotation.y + this.carYaw, 0);
    this.speed = moved / Math.max(dt, 1e-3);

    // 2. Couch and TV pop out of the ground.
    const pop = Math.max(0.001, elasticOut(clamp((t - 2.6) / 0.6, 0, 1)));
    this.couch.scale.setScalar(pop);
    this.tv.scale.setScalar(pop);

    // 3. Driver jumps out, sprints round the back of the couch and dives over it.
    const startX = this.parkX + 1.4;
    const behindZ = this.couchZ + 1.2;
    const runYaw = Math.atan2(-(this.couchX - startX), -(behindZ - PARK_Z));
    const g = p.group;
    g.visible = t > DRIVE_TIME;
    this.bubble.visible = g.visible;
    let x;
    let z;
    let lift;
    if (t < 2.8) {
      const k = clamp((t - DRIVE_TIME) / 0.4, 0, 1);
      x = startX;
      z = PARK_Z;
      lift = Math.sin(k * Math.PI) * 0.9;
      g.rotation.y = runYaw;
      this.pose(0, -2.6, false);
      this.bubble.userData.setText(this.cheer);
    } else if (t < 3.8) {
      const k = (t - 2.8) / 1.0;
      x = startX + (this.couchX - startX) * k;
      z = PARK_Z + (behindZ - PARK_Z) * k;
      lift = Math.abs(Math.sin(t * 22)) * 0.12;
      g.rotation.y = runYaw;
      const swing = Math.sin(t * 22) * 0.9;
      this.pose(swing, -swing, false);
    } else if (t < 4.1) {
      const k = (t - 3.8) / 0.3;
      x = this.couchX;
      z = behindZ + (this.couchZ - behindZ) * k;
      lift = -0.3 + Math.sin(k * Math.PI) * 1.4;
      g.rotation.y = runYaw * (1 - k);
      this.pose((Math.PI / 2) * k, (-Math.PI / 2) * k, false);
    } else {
      x = this.couchX;
      z = this.couchZ;
      lift = -0.3 + Math.abs(Math.sin(t * 9)) * 0.06;
      g.rotation.y = 0;
      this.pose(Math.PI / 2, 1.1 + Math.sin(t * 30) * 0.08, true);
      this.bubble.userData.setText('GAME TIME 🎮');
    }
    const gy = this.ground(x, z) + 0.1;
    g.position.set(x, gy + lift, z);
    this.bubble.position.set(x, gy + lift + 2.7, z);

    if (t > 4.1) {
      if (Math.floor(t * 8) !== this.flick) {
        this.flick = Math.floor(t * 8);
        this.screenMat.color.setHSL(Math.random(), 0.9, 0.55);
      }
    } else {
      this.screenMat.color.set(0x111111);
    }

    camera.fov = 55;
    camera.updateProjectionMatrix();
    const camY = this.ground(this.parkX - 6, 13);
    camera.position.copy(this.root.localToWorld(this.tmp.set(this.parkX - 6, camY + 5.5, 13)));
    camera.lookAt(this.root.localToWorld(this.tmp.set(this.couchX - 1.5, gy + 1, -1)));

    if (!this.cardShown && t >= CARD_TIME) {
      this.cardShown = true;
      return true;
    }
    return false;
  }

  // legs: 0 = standing, PI/2 = sitting. Arms swing opposite to the left leg.
  pose(legAngle, armAngle, holding) {
    const p = this.person;
    const sitting = legAngle > 1.4;
    p.legs[0].rotation.x = legAngle;
    p.legs[1].rotation.x = sitting ? legAngle : -legAngle;
    p.arms[0].rotation.x = armAngle;
    p.arms[1].rotation.x = holding ? armAngle : -armAngle;
    p.controller.visible = holding;
  }
}
