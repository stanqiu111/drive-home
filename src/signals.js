import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANE_W } from './route.js';
import { STOP_BACK, stopLineExtent, lerpAt } from './lane-layout.js';

const CYCLE = 24;
const GREEN = 12;
const YELLOW = 3;
const CROSSWALK = [1.2, 4.2]; // zebra crossing, metres past the stop line

// Black signal backplate with a yellow reflective border (as used across Alberta).
let backplateTex = null;
function backplateTexture() {
  if (backplateTex) return backplateTex;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f2c230';
  g.fillRect(0, 0, 32, 64);
  g.fillStyle = '#141414';
  g.fillRect(3, 3, 26, 58);
  backplateTex = new THREE.CanvasTexture(c);
  backplateTex.colorSpace = THREE.SRGBColorSpace;
  return backplateTex;
}

const plain = (g) => {
  const p = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(name)) p.deleteAttribute(name);
  return p;
};

// Traffic lights at the real signalised intersections along the route.
export class Signals {
  constructor(scene, route, positions) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5f646b, roughness: 0.45, metalness: 0.6 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    const plateMat = new THREE.MeshStandardMaterial({ map: backplateTexture(), roughness: 0.6 });
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const lampGeo = new THREE.SphereGeometry(0.15, 12, 8);

    this.list = positions.map((s, i) => {
      // Lanes and edges at the stop line (lane-layout.js), not at the signal: the road can
      // change in between. One head per lane, up to 5.
      const stop = s - STOP_BACK;
      const [inner, outer] = stopLineExtent(route.laneData, stop);
      const lanes = Math.max(1, Math.min(5, Math.round((outer - inner) / LANE_W)));
      const right = lerpAt(route.laneData, route.laneData.right, s); // the pole stands at the signal
      const g = new THREE.Group();
      g.position.copy(route.toWorld(s, right + 1.3, 0));
      g.rotation.y = route.yaw(s);
      // Pole with a mast arm reaching over the lanes; one signal head per lane.
      const armLen = lanes * LANE_W + 1.6;
      const metal = [
        plain(new THREE.CylinderGeometry(0.13, 0.2, 7.4, 10).translate(0, 3.7, 0)),
        plain(new THREE.CylinderGeometry(0.3, 0.34, 0.45, 10).translate(0, 0.22, 0)),
        plain(new THREE.CylinderGeometry(0.06, 0.11, armLen, 8).rotateZ(Math.PI / 2).translate(-armLen / 2, 7.0, 0)),
        // Diagonal tie rod from the pole up to the arm.
        plain(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 5).rotateZ(Math.PI / 2 - 0.35).translate(-1.12, 7.35, 0)),
      ];
      const dark = [];
      const plates = [];
      const lampPos = [[], [], []];
      for (let k = 0; k < lanes; k++) {
        const x = -(1.3 + LANE_W * (k + 0.5));
        dark.push(plain(new THREE.BoxGeometry(0.42, 1.2, 0.3).translate(x, 6.25, 0)));
        dark.push(plain(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5).translate(x, 6.98, 0)));
        plates.push(plain(new THREE.PlaneGeometry(0.78, 1.55).translate(x, 6.25, -0.16)));
        for (let j = 0; j < 3; j++) {
          const y = 6.62 - j * 0.37;
          // Visor (a half tube) over each lamp, open at the bottom.
          const visor = new THREE.CylinderGeometry(0.19, 0.19, 0.24, 10, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(x, y, 0.27);
          dark.push(plain(visor));
          lampPos[j].push([x, y, 0.16]);
        }
      }
      const backplates = mergeGeometries(plates);
      g.add(new THREE.Mesh(mergeGeometries(metal), poleMat), new THREE.Mesh(mergeGeometries(dark), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, side: THREE.DoubleSide })));
      g.add(new THREE.Mesh(backplates, plateMat));
      // Lamps face oncoming drivers (+z, since the route runs towards -z locally).
      const lamps = [0xff2a2a, 0xffc02a, 0x2aff6a].map((color, j) => {
        const m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0.05 });
        const geo = mergeGeometries(lampPos[j].map(([x, y, z]) => plain(lampGeo.clone().translate(x, y, z))));
        g.add(new THREE.Mesh(geo, m));
        return m;
      });
      this.group.add(g);

      // Stop line and a zebra crossing just past it.
      const lineGeo = [];
      const quad = (sA, sB, latA, latB) => {
        const a = route.toWorld(sA, latA, 0.06);
        const b = route.toWorld(sA, latB, 0.06);
        const c = route.toWorld(sB, latB, 0.06);
        const d = route.toWorld(sB, latA, 0.06);
        const geo = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]);
        geo.computeVertexNormals();
        if (geo.getAttribute('normal').getY(0) < 0) geo.setFromPoints([a, c, b, a, d, c]).computeVertexNormals();
        lineGeo.push(geo);
      };
      quad(stop - 0.25, stop + 0.25, inner, outer);
      const f = route.frame(stop);
      for (let lat = f.left + 0.4; lat < f.right - 0.3; lat += 1.1) quad(stop + CROSSWALK[0], stop + CROSSWALK[1], lat, lat + 0.55);
      this.group.add(new THREE.Mesh(mergeGeometries(lineGeo.map(plain)), lineMat));

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
