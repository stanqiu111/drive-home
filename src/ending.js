import * as THREE from 'three';

// The finish cutscene: the car parks on the curb, the driver jumps out, the
// destination's scene pops out of the ground and they dive straight into it:
// gaming on the couch at home, a giant burger at Odd Burger, noodles at Noodle
// Feast, a beach lounger at the lake, shopping bags in Windermere, a BBQ in Sherwood Park.
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
  // Whatever the theme hands them goes here (in the right hand).
  const hand = new THREE.Group();
  hand.position.set(-0.05, -0.68, -0.05);
  arms[1].add(hand);
  return { group, legs, arms, controller, hand };
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


const cyl = (rt, rb, h, material, x = 0, y = 0, z = 0, seg = 20) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  return m;
};

function couchSeat() {
  const g = new THREE.Group();
  const fabric = mat(0x8e3b46);
  g.add(
    box(2.4, 0.5, 1, fabric, 0, 0.25, 0),
    box(2.4, 0.8, 0.25, fabric, 0, 0.75, 0.45),
    box(0.25, 0.7, 1, fabric, -1.2, 0.45, 0),
    box(0.25, 0.7, 1, fabric, 1.2, 0.45, 0),
  );
  return g;
}

function benchSeat(color = 0x9a6a3c) {
  const g = new THREE.Group();
  const wood = mat(color);
  g.add(box(2.2, 0.12, 0.6, wood, 0, 0.46, 0));
  for (const x of [-0.9, 0.9]) g.add(box(0.12, 0.42, 0.5, mat(0x333333), x, 0.21, 0));
  return g;
}

function table(top = 0xb5835a) {
  const g = new THREE.Group();
  g.add(box(2.4, 0.1, 1.4, mat(top), 0, 1.0, 0));
  for (const x of [-1, 1]) for (const z of [-0.55, 0.55]) g.add(box(0.1, 1.0, 0.1, mat(0x333333), x, 0.5, z));
  return g;
}

function burger(scale = 1) {
  const g = new THREE.Group();
  const bun = mat(0xd9913c);
  g.add(
    cyl(0.5, 0.48, 0.16, bun, 0, 0.08, 0),
    cyl(0.52, 0.52, 0.12, mat(0x5a2e1a), 0, 0.22, 0),
    box(0.95, 0.04, 0.95, mat(0xffc42e), 0, 0.3, 0),
    cyl(0.56, 0.56, 0.05, mat(0x58b33b), 0, 0.35, 0),
  );
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), bun);
  top.scale.y = 0.7;
  top.position.y = 0.37;
  g.add(top);
  for (let k = 0; k < 9; k++) {
    const a = k * 2.4;
    const seed = box(0.06, 0.03, 0.03, mat(0xfff3d0), Math.cos(a) * 0.28 * ((k % 3) + 1) / 3, 0.66, Math.sin(a) * 0.28 * ((k % 3) + 1) / 3);
    g.add(seed);
  }
  g.scale.setScalar(scale);
  return g;
}

function noodleBowl(scale = 1) {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0xe8e2d4));
  bowl.material.side = THREE.DoubleSide;
  bowl.position.y = 0.55;
  g.add(bowl, cyl(0.52, 0.52, 0.04, mat(0xc4632a), 0, 0.5, 0));
  for (let k = 0; k < 14; k++) {
    const a = k * 2.2;
    const n = new THREE.Mesh(new THREE.TorusGeometry(0.12 + (k % 4) * 0.06, 0.018, 6, 16), mat(0xf3d36b));
    n.rotation.x = Math.PI / 2;
    n.position.set(Math.cos(a) * 0.12, 0.53, Math.sin(a) * 0.12);
    g.add(n);
  }
  g.add(box(0.2, 0.03, 0.2, mat(0xf2a7b9), 0.2, 0.54, 0.1), box(0.14, 0.03, 0.22, mat(0x3a7a3a), -0.18, 0.54, -0.1));
  for (const x of [-0.04, 0.04]) {
    const stick = box(0.025, 0.025, 1.0, mat(0x7a4b25), x, 0.75, 0.15);
    stick.rotation.x = -0.6;
    g.add(stick);
  }
  g.scale.setScalar(scale);
  return g;
}

function bag(color) {
  const g = new THREE.Group();
  g.add(box(0.5, 0.6, 0.22, mat(color), 0, 0.3, 0));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 12, Math.PI), mat(0x222222));
  handle.position.y = 0.6;
  g.add(handle);
  return g;
}

// Each theme: a seat for the person, a prop in front of them, what they hold, and the final shout.
const THEMES = {
  game: {
    text: 'GAME TIME 🎮',
    build(e) {
      const tv = new THREE.Group();
      e.screenMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.6), e.screenMat);
      screen.position.set(0, 1.9, 0.08);
      tv.add(
        box(0.3, 1.0, 0.3, mat(0x222222), 0, 0.5, 0),
        box(3, 1.8, 0.15, mat(0x151515), 0, 1.9, 0),
        screen,
        box(0.6, 0.15, 0.4, mat(0x222222, 0x1e6bff), 0.9, 0.08, 0.4),
      );
      return { seat: couchSeat(), prop: tv, controller: true };
    },
    animate(e, t) {
      if (Math.floor(t * 8) !== e.flick) {
        e.flick = Math.floor(t * 8);
        e.screenMat.color.setHSL(Math.random(), 0.9, 0.55);
      }
      return 1.1 + Math.sin(t * 30) * 0.08;
    },
  },
  burger: {
    text: 'BURGER TIME 🍔',
    build() {
      const prop = table(0xd8402f);
      const big = burger(1.3);
      big.position.y = 1.05;
      prop.add(big);
      return { seat: benchSeat(0xd8402f), prop, hand: burger(0.32), propZ: -1.6 };
    },
    // Chomp: hand to mouth and back.
    animate(e, t) {
      return 1.4 + Math.max(0, Math.sin(t * 7)) * 1.2;
    },
  },
  noodle: {
    text: 'NOODLE TIME 🍜',
    build(e) {
      const prop = table(0x8a5a35);
      const bowl = noodleBowl(1.2);
      bowl.position.y = 1.05;
      prop.add(bowl);
      e.steam = [0, 1, 2].map((k) => {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
        puff.position.set((k - 1) * 0.25, 2.0, 0);
        prop.add(puff);
        return puff;
      });
      const sticks = new THREE.Group();
      for (const x of [-0.03, 0.03]) sticks.add(box(0.02, 0.02, 0.5, mat(0x7a4b25), x, 0, -0.2));
      return { seat: benchSeat(0x8a5a35), prop, hand: sticks, propZ: -1.6 };
    },
    // Slurp: quick little lifts.
    animate(e, t) {
      e.steam.forEach((p, k) => {
        const c = (t * 0.6 + k / 3) % 1;
        p.position.y = 1.9 + c * 1.4;
        p.material.opacity = 0.6 * (1 - c);
        p.scale.setScalar(0.6 + c);
      });
      return 1.5 + Math.abs(Math.sin(t * 9)) * 0.7;
    },
  },
  beach: {
    text: 'BEACH TIME 🏖️',
    build() {
      const seat = new THREE.Group();
      const towel = box(1.2, 0.04, 2.4, mat(0x2bb3c0), 0, 0.03, 0.3);
      const back = box(1.0, 0.08, 1.0, mat(0xffffff), 0, 0.7, 0.55);
      back.rotation.x = -0.9;
      seat.add(towel, box(1.0, 0.1, 1.2, mat(0xffffff), 0, 0.45, 0), back);
      for (const x of [-0.45, 0.45]) seat.add(box(0.06, 0.4, 0.06, mat(0xcccccc), x, 0.2, -0.4), box(0.06, 0.4, 0.06, mat(0xcccccc), x, 0.2, 0.4));
      const prop = new THREE.Group();
      prop.add(new THREE.Mesh(new THREE.CircleGeometry(4, 24).rotateX(-Math.PI / 2), mat(0xf0d9a0)));
      prop.children[0].position.y = 0.02;
      prop.add(cyl(0.04, 0.04, 2.6, mat(0xdddddd), 1.4, 1.3, 1.5));
      const shade = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.6, 12), mat(0xff5a5a));
      shade.position.set(1.4, 2.6, 1.5);
      prop.add(shade, cyl(0.3, 0.3, 0.3, mat(0xffd84d), -1.6, 0.15, 0.5));
      const drink = new THREE.Group();
      drink.add(cyl(0.07, 0.06, 0.22, mat(0xff8c3a), 0, 0, 0), cyl(0.008, 0.008, 0.25, mat(0xffffff), 0.03, 0.15, 0));
      return { seat, prop, hand: drink, propZ: 0 };
    },
    // Lounging: one sip now and then.
    animate(e, t) {
      return 0.6 + Math.max(0, Math.sin(t * 2)) * 1.6;
    },
  },
  shopping: {
    text: 'SHOPPING TIME 🛍️',
    build() {
      const prop = new THREE.Group();
      [0xe84a8a, 0x3ab4e8, 0xffc42e, 0x7ad35a, 0xa86ae8].forEach((c, k) => {
        const b = bag(c);
        b.position.set(-1.2 + k * 0.6, 0, (k % 2) * 0.3);
        b.rotation.y = (k - 2) * 0.3;
        prop.add(b);
      });
      const held = bag(0xff7a2a);
      held.scale.setScalar(0.7);
      held.position.y = -0.4;
      return { seat: benchSeat(0x5f7a8f), prop, hand: held, propZ: -1.4 };
    },
    // Showing off the new stuff.
    animate(e, t) {
      return 1.6 + Math.sin(t * 6) * 0.9;
    },
  },
  ski: {
    text: 'HILL TIME ⛷️',
    build(e) {
      // Snow Valley in autumn: a lift tower with chairs and a tubing lane marker.
      const prop = new THREE.Group();
      const steel = mat(0x9a9ea3);
      prop.add(cyl(0.25, 0.3, 9, steel, 0, 4.5, 0), box(3.2, 0.25, 0.25, steel, 0, 9, 0));
      for (const x of [-1.4, 1.4]) {
        const cable = cyl(0.03, 0.03, 14, mat(0x333333), x, 9.3, 0, 6);
        cable.rotation.x = Math.PI / 2;
        prop.add(cable);
      }
      const chairMat = mat(0xd9442b);
      for (let k = 0; k < 4; k++) {
        const z = -6 + k * 4;
        const x = k % 2 ? 1.4 : -1.4;
        const hang = box(0.06, 1.6, 0.06, steel, x, 8.5, z);
        const seat = box(1.4, 0.12, 0.5, chairMat, x, 7.6, z);
        const back = box(1.4, 0.6, 0.1, chairMat, x, 7.9, z + 0.25);
        prop.add(hang, seat, back);
      }
      prop.add(box(2.4, 1.0, 0.1, mat(0x1f5f3a), 2.6, 1.6, 1.2), cyl(0.05, 0.05, 1.1, steel, 2.6, 0.55, 1.2));
      e.chairs = prop;
      const sled = new THREE.Group();
      sled.add(new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.16, 8, 18).rotateX(Math.PI / 2), mat(0x2f7de1)));
      sled.position.y = -0.3;
      return { seat: benchSeat(0x4e3f35), prop, hand: sled, propZ: -2.2 };
    },
    // Showing off the tube, chairs swaying gently.
    animate(e, t) {
      e.chairs.children.forEach((c, i) => { if (i > 4) c.rotation.z = Math.sin(t * 1.5 + i) * 0.05; });
      return 1.2 + Math.sin(t * 3) * 0.6;
    },
  },
  bbq: {
    text: 'BBQ TIME 🌭',
    build(e) {
      const prop = new THREE.Group();
      prop.add(
        cyl(0.55, 0.45, 0.5, mat(0x222222), 0, 1.0, 0),
        box(1.0, 0.03, 1.0, mat(0x777777), 0, 1.26, 0),
        cyl(0.04, 0.04, 0.9, mat(0x333333), -0.3, 0.45, 0),
        cyl(0.04, 0.04, 0.9, mat(0x333333), 0.3, 0.45, 0),
      );
      for (let k = 0; k < 4; k++) {
        const dog = cyl(0.06, 0.06, 0.45, mat(0xb5452a), -0.3 + k * 0.2, 1.31, 0);
        dog.rotation.x = Math.PI / 2;
        prop.add(dog);
      }
      e.smoke = [0, 1].map((k) => {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.5 }));
        prop.add(puff);
        return puff;
      });
      const dog = new THREE.Group();
      const bun = cyl(0.08, 0.08, 0.36, mat(0xd9913c), 0, 0, 0);
      bun.rotation.x = Math.PI / 2;
      const sausage = cyl(0.05, 0.05, 0.42, mat(0xb5452a), 0, 0.05, 0);
      sausage.rotation.x = Math.PI / 2;
      dog.add(bun, sausage);
      return { seat: benchSeat(0x3d6b4a), prop, hand: dog, propZ: -1.5 };
    },
    animate(e, t) {
      e.smoke.forEach((p, k) => {
        const c = (t * 0.5 + k / 2) % 1;
        p.position.set(Math.sin(t + k) * 0.2, 1.4 + c * 1.8, 0);
        p.material.opacity = 0.5 * (1 - c);
        p.scale.setScalar(0.7 + c * 1.2);
      });
      return 1.4 + Math.max(0, Math.sin(t * 6)) * 1.1;
    },
  },
};

export class Ending {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);

    this.person = makePerson();
    this.root.add(this.person.group);

    this.couch = new THREE.Group(); // the seat
    this.tv = new THREE.Group(); // the prop in front of it
    this.root.add(this.couch, this.tv);

    this.bubble = makeBubble();
    this.root.add(this.bubble);
    this.tmp = new THREE.Vector3();
    this.reset();
  }

  // Lay out the scene at the end of a route.
  setRoute(route, heightAt, cheer, theme = 'game') {
    this.route = route;
    this.heightAt = heightAt;
    this.cheer = cheer;
    this.setTheme(theme);
    const L = route.length;
    this.root.position.copy(route.toWorld(L, 0, 0));
    this.root.rotation.set(0, route.yaw(L), 0);
    this.root.updateMatrixWorld(true);
    const R = route.rightEdge(L);
    this.laneX = route.laneLat(0, L);
    this.parkX = R + 2.6;
    this.couchX = R + 8.5;
    this.couchZ = 0;
    this.tvZ = this.parts.propZ ?? -4.5;
    this.couch.position.set(this.couchX, this.ground(this.couchX, this.couchZ) + 0.1, this.couchZ);
    this.tv.position.set(this.couchX, this.ground(this.couchX, this.tvZ) + 0.1, this.tvZ);
  }

  setTheme(name) {
    this.theme = THEMES[name] ?? THEMES.game;
    // Free the previous theme's meshes (each theme builds its own).
    for (const g of [this.couch, this.tv, this.person.hand]) {
      g.traverse((o) => {
        if (o === g) return;
        o.geometry?.dispose();
        o.material?.dispose();
      });
      g.clear();
    }
    this.parts = this.theme.build(this);
    this.couch.add(this.parts.seat);
    this.tv.add(this.parts.prop);
    if (this.parts.hand) this.person.hand.add(this.parts.hand);
    this.person.controller.visible = false;
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
      this.pose(Math.PI / 2, this.theme.animate(this, t), true);
      this.bubble.userData.setText(this.theme.text);
    }
    const gy = this.ground(x, z) + 0.1;
    g.position.set(x, gy + lift, z);
    this.bubble.position.set(x, gy + lift + 2.7, z);

    if (this.screenMat && t <= 4.1) this.screenMat.color.set(0x111111);

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
    p.controller.visible = holding && Boolean(this.parts.controller);
    p.hand.visible = holding || !this.parts.controller;
  }
}
