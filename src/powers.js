import * as THREE from 'three';

export const POWERS = {
  shield: { label: 'SHIELD', icon: '🛡️', duration: 7 },
  turbo: { label: 'TURBO', icon: '🚀', duration: 5 },
  fly: { label: 'FLY', icon: '✈️', duration: 6 },
  blast: { label: 'BLAST', icon: '💥', duration: 1 },
};
// Turbo is listed twice so it comes out of boxes more often than the others.
const KINDS = ['shield', 'turbo', 'turbo', 'fly', 'blast'];

export const randomPower = () => KINDS[(Math.random() * KINDS.length) | 0];

function mysteryTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, '#ff4fd8');
  grad.addColorStop(0.5, '#ffd84d');
  grad.addColorStop(1, '#4fd1ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 120, 120);
  g.fillStyle = '#fff';
  g.font = 'bold 96px -apple-system, Helvetica, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const boxGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
let boxMat;

export function makeMysteryBox() {
  if (!boxMat) {
    const map = mysteryTexture();
    boxMat = new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.6 });
  }
  const mesh = new THREE.Mesh(boxGeo, boxMat);
  mesh.rotation.x = Math.PI / 4;
  return mesh;
}

// Shield bubble and wings attached to the player's car.
export class PowerVisuals {
  constructor(car) {
    const { width, len } = car.userData;
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd84d, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.shield.scale.set(width * 0.95, 1.4, len * 0.65);
    this.shield.position.y = 0.9;
    car.add(this.shield);

    const wingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    this.wings = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * (width / 2), 1, 0.2);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 1.3), wingMat);
      wing.position.x = side * 1.2;
      pivot.add(wing);
      pivot.userData.side = side;
      car.add(pivot);
      return pivot;
    });
    this.update(0, null);
  }

  update(t, power) {
    this.shield.visible = power === 'shield';
    if (this.shield.visible) {
      this.shield.material.color.setHSL((t * 0.5) % 1, 1, 0.6);
      this.shield.scale.y = 1.3 + Math.sin(t * 8) * 0.05;
    }
    for (const w of this.wings) {
      w.visible = power === 'fly';
      w.rotation.z = w.userData.side * Math.sin(t * 14) * 0.35;
    }
  }
}
