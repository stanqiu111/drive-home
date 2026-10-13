// Porsche 911 Turbo S coupe (992.2, model year 2026-27: T-Hybrid flat six, all-wheel drive), as on
// porsche.com in Oct 2026. Official sizes (Porsche Newsroom technical data, MY T 10/2025): 4,551 long,
// 1,900 wide without mirrors (2,033 with), 1,305 tall, wheelbase 2,450, track 1,583 front / 1,588 rear;
// 9.5J x 20 wheels with 255/35 ZR 20 tyres in front, 12.0J x 21 with 325/30 ZR 21 at the back.
// The shape was measured off the official renders from Porsche's configurator
// (configurator.porsche.com): the side view for the profile and the wheel positions, the front, rear
// and three-quarter views for the widths, lights and intakes.
import { rect, ellipse } from './_shape.js';

// A rounded rectangle centred on (cx, cy).
const rrect = (cx, cy, w, h, r, n = 4) => {
  const pts = [];
  for (const [qx, qy, a0] of [[1, 1, 0], [-1, 1, 0.5], [-1, -1, 1], [1, -1, 1.5]]) {
    for (let k = 0; k <= n; k++) {
      const a = (a0 + k / (2 * n)) * Math.PI;
      pts.push([cx + qx * (w / 2 - r) + r * Math.cos(a), cy + qy * (h / 2 - r) + r * Math.sin(a)]);
    }
  }
  return pts;
};
// A thin bar from (x0, y0) to (x1, y1), t metres thick.
const bar = (x0, y0, x1, y1, t) => {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = (-dy / l) * (t / 2), ny = (dx / l) * (t / 2);
  return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
};

export default {
  brand: 'Porsche', name: '911 Turbo S', color: 0xc0c3c7, super: true,
  desc: 'All-wheel-drive launch rocket. Nothing leaves the lights faster.',
  len: 4.551, width: 1.9, wheelR: 0.335, tireW: 0.255, rearWheel: { r: 0.355, w: 0.325 },
  axles: [1.258, -1.192], round: 0.15, nose: 0.12, tail: 0.08, wrap: 0.5, sag: 0.006, brakeLight: false,
  // Round shoulders, hood and engine lid lower than the fenders and hips (negative crown).
  section: { shoulder: 0.5, belt: 0.045, tuck: 0.08, crease: 2.0, crown: -0.1, flare: 0.02, gap: 0.025, rocker: false, faceFade: true },
  // The famous profile: low nose rising to the round fenders, the windshield and one long arc of
  // roof running down to the engine lid, the wing standing over the tail.
  side: [
    [2.2755, 0.22, 0.335], [2.25, 0.2, 0.375], [2.2, 0.19, 0.415], [2.15, 0.185, 0.445], [2.1, 0.18, 0.47], [2.0, 0.155, 0.515],
    [1.9, 0.14, 0.56], [1.8, 0.125, 0.635], [1.7, 0.11, 0.69], [1.6, 0.11, 0.73], [1.45, 0.11, 0.762], [1.3, 0.11, 0.782],
    [1.15, 0.115, 0.805], [1.0, 0.12, 0.83], [0.9, 0.125, 0.85], [0.55, 0.125, 0.877], [-0.1, 0.125, 0.897], [-0.6, 0.125, 0.905],
    [-0.93, 0.13, 0.91], [-1.2, 0.14, 0.915], [-1.5, 0.15, 0.92], [-1.75, 0.17, 0.915], [-1.9, 0.19, 0.9], [-2.0, 0.21, 0.875],
    [-2.1, 0.235, 0.825], [-2.15, 0.26, 0.785], [-2.2, 0.28, 0.73], [-2.25, 0.3, 0.68], [-2.2765, 0.33, 0.64],
  ],
  // Narrow at the doors, wide over the rear wheels.
  plan: [
    [2.2755, 0.5], [2.25, 0.64], [2.2, 0.74], [2.12, 0.81], [2.0, 0.865], [1.85, 0.9], [1.6, 0.925], [1.258, 0.935], [1.0, 0.925],
    [0.7, 0.905], [0.3, 0.9], [-0.2, 0.91], [-0.6, 0.935], [-0.9, 0.955], [-1.192, 0.96], [-1.5, 0.955], [-1.8, 0.935],
    [-2.0, 0.925], [-2.12, 0.9], [-2.22, 0.84], [-2.2765, 0.76],
  ],
  // Glass house: windshield from the hood to the roof, the roof's long arc to the engine lid
  // ([u, roof, roof half-width, base half-width]).
  cabin: [
    [0.95, 0.85, 0.64, 0.71], [0.85, 0.91, 0.64, 0.75], [0.7, 0.995, 0.64, 0.78], [0.5, 1.095, 0.64, 0.8], [0.3, 1.187, 0.64, 0.8],
    [0.1, 1.268, 0.64, 0.8], [-0.1, 1.291, 0.63, 0.8], [-0.3, 1.294, 0.62, 0.79], [-0.5, 1.279, 0.6, 0.77], [-0.7, 1.243, 0.57, 0.73],
    [-0.9, 1.199, 0.53, 0.68], [-1.1, 1.151, 0.5, 0.62], [-1.3, 1.096, 0.47, 0.56], [-1.5, 1.033, 0.46, 0.52], [-1.65, 0.984, 0.45, 0.5],
    [-1.75, 0.949, 0.44, 0.48],
  ],
  windows: { belt: 0.0, top: 0.075, trim: true, bands: [{ u0: 0.53, u1: -1.18, k0: 0.6, k1: 0.6 }], pillars: [-0.5], kick: [[-0.6, 0], [-0.9, 0.02], [-1.18, 0.08]] },
  windshield: [0.93, 0.08], backlight: [-0.62, -1.47],
  // 911 Turbo wheels: ten slim twin spokes round a centre lock, dark titanium.
  rim: { n: 10, style: 'split', split: 0.06, spoke: 0.012, color: 0x34373b, size: 0.76 },
  mirror: { u: 0.42, y: 0.03, out: 0.13, dy: -0.065 },
  doors: [0.52, -0.515],
  stats: { top: 1.34, accel: 1.6, grip: 1.25 },
  details(c) {
    // Round headlights on the fenders, each with the four-point running light: four LED bars
    // round a cross, two lamp modules below them.
    const L = (x, y) => [0.687 + x, 0.685 + y];
    c.front('dark', ellipse(0.687, 0.685, 0.12, 0.11, 18), 0.012, 0.8);
    c.front('lens', ellipse(0.687, 0.685, 0.108, 0.098, 18), 0.015, 0.8);
    for (const [x0, y0, x1, y1] of [[0.066, 0.063, 0.014, 0.055], [-0.017, 0.055, -0.072, 0.065], [0.077, 0.009, 0.014, 0.006], [-0.017, 0.006, -0.08, 0.009]]) {
      c.front('head', bar(...L(x0, y0), ...L(x1, y1), 0.011), 0.019, 0.8);
    }
    c.front('head', bar(...L(0, 0.085), ...L(0, 0.06), 0.006), 0.019, 0.8);
    c.front('head', bar(...L(0, -0.05), ...L(0, -0.075), 0.006), 0.019, 0.8);
    for (const x of [0.046, -0.052]) c.front('chrome', rrect(...L(x, -0.012), 0.046, 0.024, 0.006), 0.018, 0.8);
    // Bumper: big corner intakes with vertical flaps, the centre intake, black lip.
    const corner = [[0.731, 0.465], [0.775, 0.428], [0.784, 0.319], [0.782, 0.255], [0.657, 0.246], [0.59, 0.243], [0.531, 0.246], [0.482, 0.265], [0.455, 0.283], [0.446, 0.356], [0.458, 0.419], [0.5, 0.437], [0.594, 0.446], [0.685, 0.456]];
    c.front('dark', corner, 0.012);
    for (const x of [0.5, 0.565, 0.63, 0.695]) c.front('lens', rect(x, 0.27, x + 0.03, 0.43), 0.016);
    c.frontMid('dark', [[0.333, 0.363], [0.344, 0.291], [0.374, 0.255], [-0.374, 0.255], [-0.344, 0.291], [-0.333, 0.363]], 0.012);
    c.frontMid('grille', [[0.31, 0.35], [0.32, 0.29], [0.34, 0.268], [-0.34, 0.268], [-0.32, 0.29], [-0.31, 0.35]], 0.015);
    c.frontMid('dark', [[-0.84, 0.15], [0.84, 0.15], [0.84, 0.2], [-0.84, 0.2]], 0.012);
    c.frontMid('chrome', ellipse(0, 0.6, 0.022, 0.027, 12), 0.014);
    // Sides: the indicator slit above the front wheel, the Turbo's intake ahead of the rear wheel,
    // the flush door handle.
    c.side('dark', [[1.63, 0.545], [1.4, 0.585], [1.27, 0.615], [1.27, 0.6], [1.4, 0.57], [1.63, 0.53]]);
    c.side('dark', [[-0.854, 0.817], [-0.901, 0.817], [-0.914, 0.789], [-0.898, 0.762], [-0.868, 0.72], [-0.84, 0.693], [-0.815, 0.665], [-0.793, 0.638], [-0.774, 0.629], [-0.749, 0.638], [-0.757, 0.652], [-0.735, 0.707], [-0.749, 0.734], [-0.766, 0.762], [-0.788, 0.789], [-0.807, 0.803]]);
    c.side('dark', rect(-0.465, 0.678, -0.245, 0.694), 0.004);
    // Rear: the full-width light bar with PORSCHE lettering below it, the plate, reflectors, black
    // lower bumper with the Turbo's twin double-oval tailpipes.
    c.rearMid('dark', [[-0.75, 0.794], [0.75, 0.794], [0.75, 0.72], [0.7, 0.709], [-0.7, 0.709], [-0.75, 0.72]], 0.012);
    c.rearMid('tail', rect(-0.684, 0.772, 0.684, 0.787), 0.016);
    c.rear('lens', rect(0.31, 0.724, 0.74, 0.742), 0.015);
    for (let k = 0; k < 7; k++) {
      const x = -0.26 + k * 0.0867;
      c.rearMid('chrome', rect(x - 0.022, 0.726, x + 0.022, 0.743), 0.016);
    }
    c.plate(0.51);
    c.rear('tail', [[0.556, 0.497], [0.8, 0.497], [0.8, 0.465], [0.565, 0.465]], 0.014);
    c.rearMid('dark', [[-0.83, 0.43], [0.83, 0.43], [0.83, 0.22], [-0.83, 0.22]], 0.012);
    c.rear('chrome', rrect(0.57, 0.354, 0.215, 0.11, 0.045, 5), 0.016);
    for (const dx of [-0.048, 0.048]) c.rear('dark', ellipse(0.57 + dx, 0.354, 0.042, 0.038, 14), 0.02);
    // The wing, up as on Porsche's pictures: a body-coloured blade on a raised deck, the third brake
    // light in its leading edge.
    c.box('paint', 0, 0.915, 1.96, 1.0, 0.11, 0.3);
    c.box('paint', 0, 0.965, 1.97, 1.33, 0.03, 0.34);
    c.box('tail', 0, 0.972, 1.805, 0.3, 0.012, 0.02);
    // Louvred grille on the engine lid behind the rear window.
    c.rearMid('grille', rect(-0.4, 0.99, 0.4, 1.045), 0.012, 0.8);
  },
};
