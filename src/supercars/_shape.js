// Shared bits for the supercar modules (same body format as CAR_MODELS in ../cars.js, whose
// header explains it). `sportsBody()` is only a stand-in: a generic low sports-car body at a
// car's real size, used until the car is modelled from its maker's official photos.
export const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
export const ellipse = (cx, cy, rx, ry, n = 16) =>
  Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((i / n) * Math.PI * 2), cy + ry * Math.sin((i / n) * Math.PI * 2)]);

// len, width (body, no mirrors), height, wheelbase in metres; mid = engine behind the seats.
export function sportsBody({ len, width, height, wheelbase, wheelR = 0.35, tireW = 0.28, mid = true }) {
  const h = len / 2;
  const w = width / 2;
  const front = mid ? h - (len - wheelbase) * 0.48 : h - (len - wheelbase) * 0.42;
  const rear = front - wheelbase;
  const roofU = mid ? -0.35 : -0.15;
  const k = height / 1.16;
  return {
    len, width, wheelR, tireW, axles: [front, rear], round: 0.22, fin: rear + 0.2,
    section: { shoulder: 0.5, belt: 0.06, tuck: 0.09, crease: 1.4, crown: 0.025, flare: 0.03, gap: 0.04 },
    side: [[h, 0.17, 0.42 * k], [h - 0.12, 0.11, 0.55 * k], [h - 0.6, 0.1, 0.66 * k], [h - 1.3, 0.1, 0.74 * k], [roofU + 0.7, 0.1, 0.8 * k],
      [roofU - 0.3, 0.11, 0.86 * k], [rear - 0.2, 0.12, 0.9 * k], [-h + 0.15, 0.17, 0.88 * k], [-h, 0.27, 0.78 * k]],
    plan: [[h, w * 0.78], [h - 0.18, w * 0.92], [h - 0.7, w * 0.98], [rear + 0.6, w], [-h + 0.2, w * 0.95], [-h, w * 0.86]],
    cabin: [[roofU + 1.45, 0.76 * k, w * 0.8], [roofU + 0.7, (height - 0.03) * 0.985, w * 0.62], [roofU, height, w * 0.6],
      [roofU - 0.75, height - 0.1 * k, w * 0.63], [roofU - 1.4, 0.9 * k, w * 0.76]],
    windows: { belt: 0.04, top: 0.05, bands: [{ u0: roofU + 1.3, u1: roofU - 0.6, k0: 0.55, k1: 1.1 }] },
    windshield: [roofU + 1.4, roofU + 0.72], backlight: [roofU - 0.8, roofU - 1.35],
    doors: [roofU + 1.3, roofU - 0.55],
  };
}

// Simple lights and plate for a stand-in body.
export function standInDetails(c) {
  c.front('lens', [[0.5, 0.52], [0.88, 0.58], [0.9, 0.54], [0.55, 0.48]]);
  c.front('head', [[0.55, 0.53], [0.86, 0.575], [0.87, 0.56], [0.57, 0.515]], 0.016);
  c.frontMid('grille', [[-0.7, 0.2], [0.7, 0.2], [0.75, 0.32], [-0.75, 0.32]]);
  c.rear('tail', [[0.35, 0.8], [0.88, 0.82], [0.9, 0.77], [0.38, 0.76]]);
  c.rearMid('dark', [[-0.8, 0.26], [0.8, 0.26], [0.75, 0.38], [-0.75, 0.38]]);
  c.plate(0.5);
}
