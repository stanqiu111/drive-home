import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANE_W } from './route.js';
import { stopLineExtent, lerpAt } from './lane-layout.js';

const CYCLE = 24;
const GREEN = 12;
const YELLOW = 3;
const CROSSWALK = [1.2, 4.2]; // zebra crossing, metres past the stop line
const CHUNK = 1000; // m of route per merged mesh, so far-away signals are culled
const LAMP_COLORS = [0xff2a2a, 0xffc02a, 0x2aff6a]; // red, yellow, green
const LAMP_ON = 3;
const LAMP_OFF = 0.05;

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
  if (!p.attributes.uv) p.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
  return p;
};

// Traffic lights at the real signalised intersections along the route. All signals in a
// stretch of road share one mesh per material; the lamps of every signal are one mesh whose
// glow comes from a small texture (one texel per lamp), so changing lights costs no extra
// draw calls. Build it, then add `group` to the scene (or the world).
export class Signals {
  constructor(route, positions) {
    this.group = new THREE.Group();
    this.group.name = 'signals';
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5f646b, roughness: 0.45, metalness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, side: THREE.DoubleSide });
    const plateMat = new THREE.MeshStandardMaterial({ map: backplateTexture(), roughness: 0.6 });
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    // Lamp glow per signal (x) and lamp (y: red, yellow, green), in linear light.
    const n = Math.max(1, positions.length);
    this.glow = new Float32Array(n * 3 * 4);
    this.stateTex = new THREE.DataTexture(this.glow, n, 3, THREE.RGBAFormat, THREE.FloatType);
    this.stateTex.minFilter = this.stateTex.magFilter = THREE.NearestFilter;
    this.stateTex.colorSpace = THREE.NoColorSpace;
    this.lampLinear = LAMP_COLORS.map((c) => new THREE.Color(c));
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: LAMP_ON, emissiveMap: this.stateTex });
    // Shapes repeated on every signal head, prepared once and copied.
    const base = {
      lamp: plain(new THREE.SphereGeometry(0.15, 12, 8)),
      visor: plain(new THREE.CylinderGeometry(0.19, 0.19, 0.24, 10, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2)),
      head: plain(new THREE.BoxGeometry(0.42, 1.2, 0.3)),
      hanger: plain(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5)),
      plate: plain(new THREE.PlaneGeometry(0.78, 1.55)),
    };

    const chunks = new Map(); // stretch -> { metal, dark, plates, lamps, lines }
    const chunkOf = (s) => {
      const k = Math.floor(s / CHUNK);
      if (!chunks.has(k)) chunks.set(k, { metal: [], dark: [], plates: [], lamps: [], lines: [] });
      return chunks.get(k);
    };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const yAxis = new THREE.Vector3(0, 1, 0);

    this.list = positions.map(({ s, stop }, i) => {
      const parts = chunkOf(s);
      // Lanes and edges at the stop line (lane-layout.js), not at the signal: the road can
      // change in between. One head per lane, up to 5. `stop` comes from the real junction.
      const [inner, outer] = stopLineExtent(route.laneData, stop);
      const lanes = Math.max(1, Math.min(5, Math.round((outer - inner) / LANE_W)));
      const right = lerpAt(route.laneData, route.laneData.right, s); // the pole stands at the signal
      // Pole with a mast arm reaching over the lanes; one signal head per lane. Built in the
      // signal's own frame, then placed at the road edge, turned to face oncoming drivers.
      q.setFromAxisAngle(yAxis, route.yaw(s));
      m.compose(route.toWorld(s, right + 1.3, 0), q, one);
      const put = (list, g) => list.push(plain(g).applyMatrix4(m));
      const armLen = lanes * LANE_W + 1.6;
      put(parts.metal, new THREE.CylinderGeometry(0.13, 0.2, 7.4, 10).translate(0, 3.7, 0));
      put(parts.metal, new THREE.CylinderGeometry(0.3, 0.34, 0.45, 10).translate(0, 0.22, 0));
      put(parts.metal, new THREE.CylinderGeometry(0.06, 0.11, armLen, 8).rotateZ(Math.PI / 2).translate(-armLen / 2, 7.0, 0));
      // Diagonal tie rod from the pole up to the arm.
      put(parts.metal, new THREE.CylinderGeometry(0.025, 0.025, 2.4, 5).rotateZ(Math.PI / 2 - 0.35).translate(-1.12, 7.35, 0));
      for (let k = 0; k < lanes; k++) {
        const x = -(1.3 + LANE_W * (k + 0.5));
        parts.dark.push(base.head.clone().translate(x, 6.25, 0).applyMatrix4(m));
        parts.dark.push(base.hanger.clone().translate(x, 6.98, 0).applyMatrix4(m));
        parts.plates.push(base.plate.clone().translate(x, 6.25, -0.16).applyMatrix4(m));
        for (let j = 0; j < 3; j++) {
          const y = 6.62 - j * 0.37;
          // Visor (a half tube) over each lamp, open at the bottom.
          parts.dark.push(base.visor.clone().translate(x, y, 0.27).applyMatrix4(m));
          // Lamps face oncoming drivers (+z, since the route runs towards -z locally). Their uv
          // points at this lamp's texel in the glow texture.
          const lamp = base.lamp.clone().translate(x, y, 0.16);
          const uv = lamp.attributes.uv;
          for (let v = 0; v < uv.count; v++) uv.setXY(v, (i + 0.5) / n, (j + 0.5) / 3);
          parts.lamps.push(lamp.applyMatrix4(m));
        }
      }

      // Stop line and a zebra crossing just past it.
      const quad = (sA, sB, latA, latB) => {
        const a = route.toWorld(sA, latA, 0.06);
        const b = route.toWorld(sA, latB, 0.06);
        const c = route.toWorld(sB, latB, 0.06);
        const d = route.toWorld(sB, latA, 0.06);
        const geo = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]);
        geo.computeVertexNormals();
        if (geo.getAttribute('normal').getY(0) < 0) geo.setFromPoints([a, c, b, a, d, c]).computeVertexNormals();
        parts.lines.push(plain(geo));
      };
      quad(stop - 0.25, stop + 0.25, inner, outer);
      const f = route.frame(stop);
      for (let lat = f.left + 0.4; lat < f.right - 0.3; lat += 1.1) quad(stop + CROSSWALK[0], stop + CROSSWALK[1], lat, lat + 0.55);

      return { s, stopS: stop, offset: (i * 7.3) % CYCLE, state: '' };
    });

    for (const parts of chunks.values()) {
      for (const [list, mat] of [[parts.metal, poleMat], [parts.dark, darkMat], [parts.plates, plateMat], [parts.lamps, lampMat], [parts.lines, lineMat]]) {
        if (list.length) this.group.add(new THREE.Mesh(mergeGeometries(list), mat));
      }
    }
    this.update(0);
  }

  update(t) {
    let changed = false;
    this.list.forEach((sig, i) => {
      const p = (t + sig.offset) % CYCLE;
      const state = p < GREEN ? 'green' : p < GREEN + YELLOW ? 'yellow' : 'red';
      if (state === sig.state) return;
      sig.state = state;
      changed = true;
      const on = state === 'red' ? 0 : state === 'yellow' ? 1 : 2;
      for (let j = 0; j < 3; j++) {
        const c = this.lampLinear[j];
        const k = j === on ? 1 : LAMP_OFF / LAMP_ON;
        const o = (j * this.stateTex.image.width + i) * 4;
        this.glow[o] = c.r * k;
        this.glow[o + 1] = c.g * k;
        this.glow[o + 2] = c.b * k;
        this.glow[o + 3] = 1;
      }
    });
    if (changed) this.stateTex.needsUpdate = true;
  }

  // The first signal whose stop line is ahead of s, within range.
  nextAhead(s, range) {
    for (const sig of this.list) {
      if (sig.stopS < s - 0.5) continue;
      return sig.stopS - s < range ? sig : null;
    }
    return null;
  }
}
