import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Cartoon versions of real cars, built from real dimensions.
//
// Each body is lofted through cross-sections along the car's length:
//   u = metres towards the front (front bumper at +len/2), model faces -z.
//   side:  [u, bottom, top]  the lower body's underside and hood/belt/trunk line
//   plan:  [u, halfWidth]    the body seen from above
//   cabin: [u, roof, roofHalfWidth]  the glass house, from windshield base to rear glass base
// windows: the side glass outline (daylight opening), pillars and trim, which is what
//   makes a car recognisable side-on. Bands run from u0 (front) to u1 (back); k0/k1 are
//   the slopes of the front and rear edges (big = vertical).
// details() draws lights, grilles and badges as decals that wrap onto the body,
//   given as [x, y] outlines for the right-hand side (mirrored automatically).
// Stats are multipliers on the base car: top speed, acceleration, grip.

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ellipse = (cx, cy, rx, ry, n = 16) =>
  Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((i / n) * Math.PI * 2), cy + ry * Math.sin((i / n) * Math.PI * 2)]);
// Honda's "H", centred on (cx, cy).
const hondaH = (cx, cy, s = 1) => [[-5, -4], [-3, -4], [-3, -0.6], [3, -0.6], [3, -4], [5, -4], [5, 4], [3, 4], [3, 0.6], [-3, 0.6], [-3, 4], [-5, 4]]
  .map(([x, y]) => [cx + x * 0.011 * s, cy + y * 0.011 * s]);

export const CAR_MODELS = {
  modelx: {
    brand: 'Tesla', name: 'Model X', color: 0xf2f2f0, desc: 'Falcon-wing family rocket. Heavy.', heavy: true,
    len: 5.04, width: 2.0, wheelR: 0.37, tireW: 0.255, axles: [1.48, -1.49], round: 0.24,
    section: { shoulder: 0.55, belt: 0.06, tuck: 0.085, crease: 2.0, crown: 0.035, gap: 0.055, rocker: false },
    side: [[2.52, 0.42, 0.66], [2.42, 0.3, 0.86], [2.15, 0.28, 0.98], [1.55, 0.28, 1.06], [0, 0.28, 1.1], [-1.6, 0.29, 1.12], [-2.2, 0.31, 1.08], [-2.45, 0.38, 0.98], [-2.52, 0.48, 0.86]],
    plan: [[2.52, 0.76], [2.3, 0.93], [1.8, 0.99], [-1.8, 1.0], [-2.3, 0.95], [-2.52, 0.82]],
    cabin: [[1.62, 1.07, 0.84], [0.9, 1.5, 0.76], [0.2, 1.68, 0.72], [-0.5, 1.69, 0.72], [-1.2, 1.6, 0.73], [-1.8, 1.44, 0.76], [-2.25, 1.24, 0.8], [-2.45, 1.1, 0.84]],
    // The panoramic windshield sweeps right up over the front seats; behind it the roof is the
    // painted skin of the falcon-wing doors. Chrome-trimmed side glass ends in a sharp point.
    windows: { belt: 0.05, top: 0.1, trim: true, bands: [{ u0: 1.42, u1: -1.98, k0: 0.7, k1: 0.5 }], pillars: [0.12, -1.22] },
    windshield: [1.58, -0.25], backlight: [-1.45, -2.36],
    rim: { n: 5, style: 'aero', color: 0x7a7f87 },
    doors: [1.45, 0.15, -1.15],
    stats: { top: 1.05, accel: 1.3, grip: 0.95 },
    details(c) {
      // Grille-less nose: swept headlights, a slim lower intake, the "T".
      c.front('lens', [[0.44, 0.79], [0.8, 0.84], [0.9, 0.79], [0.86, 0.73], [0.5, 0.74]]);
      c.front('head', [[0.48, 0.79], [0.82, 0.835], [0.85, 0.81], [0.5, 0.77]], 0.018);
      c.frontMid('grille', [[-0.58, 0.36], [0.58, 0.36], [0.64, 0.47], [-0.64, 0.47]]);
      c.front('dark', [[0.68, 0.38], [0.82, 0.4], [0.84, 0.56], [0.72, 0.52]]);
      c.frontMid('chrome', [[-0.06, 0.74], [0.06, 0.74], [0.06, 0.72], [0.012, 0.72], [0.012, 0.65], [-0.012, 0.65], [-0.012, 0.72], [-0.06, 0.72]], 0.016);
      // Rear: wide tail lights that wrap round the corners, black diffuser.
      c.rear('tail', [[0.36, 0.98], [0.86, 1.0], [0.93, 0.94], [0.88, 0.9], [0.38, 0.93]]);
      c.rear('tail', [[0.68, 0.52], [0.86, 0.53], [0.86, 0.56], [0.68, 0.55]]);
      c.rearMid('dark', [[-0.78, 0.36], [0.78, 0.36], [0.72, 0.5], [-0.72, 0.5]]);
      c.rearMid('chrome', rect(-0.16, 0.9, 0.16, 0.92), 0.016);
      c.plate(0.72);
      // Small lip spoiler at the top of the hatch.
      c.box('paint', 0, 1.13, 2.39, 1.25, 0.025, 0.1);
    },
  },
  crv: {
    brand: 'Honda', name: 'CR-V', color: 0x2e4a6b, desc: 'Comfy, sensible, secretly quick',
    len: 4.7, width: 1.86, wheelR: 0.37, tireW: 0.235, axles: [1.3, -1.4], round: 0.15, cladding: true, fin: -1.85,
    section: { shoulder: 0.6, belt: 0.05, tuck: 0.05, crease: 1.5, crown: 0.03, flare: 0.014, gap: 0.065 },
    side: [[2.35, 0.42, 0.8], [2.2, 0.32, 0.98], [1.8, 0.32, 1.06], [1.15, 0.32, 1.12], [0, 0.33, 1.13], [-1.4, 0.33, 1.18], [-2.15, 0.35, 1.2], [-2.3, 0.4, 1.15], [-2.35, 0.48, 1.04]],
    plan: [[2.35, 0.74], [2.2, 0.88], [1.8, 0.93], [-2.0, 0.93], [-2.3, 0.88], [-2.35, 0.8]],
    cabin: [[1.15, 1.14, 0.78], [0.5, 1.62, 0.74], [0.3, 1.68, 0.74], [-1.5, 1.68, 0.74], [-2.05, 1.63, 0.75], [-2.3, 1.2, 0.8]],
    // Black A/B/C pillars, the window line kicks up into a body-coloured D pillar.
    windows: { belt: 0.05, top: 0.08, bands: [{ u0: 1.0, u1: -2.06, k0: 0.78, k1: 1.7 }], pillars: [-0.4, -1.5], kick: [[-1.5, 0], [-2.06, 0.08]] },
    windshield: [1.1, 0.52], backlight: [-2.07, -2.27],
    rim: { n: 5, style: 'twin', color: 0x8d9299 },
    doors: [1.0, -0.4, -1.5], handles: [-0.26, -1.36],
    stats: { top: 0.92, accel: 0.95, grip: 1.0 },
    details(c) {
      // Tall, upright black grille, slim headlights across the top of it.
      c.frontMid('grille', [[-0.5, 0.62], [0.5, 0.62], [0.56, 0.68], [0.56, 0.92], [0.5, 0.97], [-0.5, 0.97], [-0.56, 0.92], [-0.56, 0.68]]);
      c.frontMid('chrome', hondaH(0, 0.86, 1.1), 0.022);
      c.front('lens', [[0.57, 0.86], [0.86, 0.9], [0.9, 0.85], [0.87, 0.8], [0.58, 0.78]]);
      c.front('head', [[0.58, 0.875], [0.86, 0.9], [0.87, 0.88], [0.59, 0.858]], 0.018);
      c.frontMid('grille', [[-0.56, 0.38], [0.56, 0.38], [0.6, 0.52], [-0.6, 0.52]]);
      c.frontMid('chrome', [[-0.38, 0.34], [0.38, 0.34], [0.42, 0.37], [-0.42, 0.37]], 0.016);
      c.front('dark', [[0.66, 0.42], [0.78, 0.44], [0.8, 0.62], [0.7, 0.6]]);
      // Tall tail lights up the tailgate edges, with a short arm into the tailgate.
      c.rear('tail', [[0.7, 0.92], [0.86, 0.94], [0.85, 1.16], [0.77, 1.42], [0.72, 1.42], [0.72, 1.16]]);
      c.rear('tail', [[0.46, 1.0], [0.72, 1.0], [0.72, 1.07], [0.46, 1.07]]);
      c.rearMid('dark', [[-0.82, 0.44], [0.82, 0.44], [0.84, 0.56], [-0.84, 0.56]]);
      c.rearMid('chrome', hondaH(0, 1.06), 0.016);
      c.plate(0.78);
      for (const s of [-1, 1]) c.box('dark', s * 0.64, 1.7, 0.75, 0.05, 0.05, 2.2);
      c.box('paint', 0, 1.64, 2.08, 1.3, 0.05, 0.2);
    },
  },
  accord: {
    brand: 'Honda', name: 'Accord', color: 0x8f1d21, desc: 'Smooth fastback, quietly quick',
    len: 4.97, width: 1.86, wheelR: 0.34, tireW: 0.235, axles: [1.45, -1.38], round: 0.25, fin: -1.05,
    section: { shoulder: 0.68, belt: 0.06, tuck: 0.075, crease: 1.25, crown: 0.03, gap: 0.045 },
    side: [[2.48, 0.32, 0.62], [2.3, 0.2, 0.78], [1.7, 0.2, 0.86], [1.0, 0.2, 0.9], [-0.5, 0.2, 0.93], [-1.8, 0.22, 0.98], [-2.35, 0.25, 0.98], [-2.48, 0.32, 0.86]],
    plan: [[2.48, 0.74], [2.3, 0.88], [1.8, 0.93], [-1.9, 0.93], [-2.35, 0.88], [-2.48, 0.8]],
    cabin: [[1.0, 0.91, 0.76], [0.25, 1.4, 0.68], [-0.6, 1.44, 0.68], [-1.35, 1.3, 0.7], [-2.05, 0.99, 0.82]],
    // Long six-window glass house with chrome trim, quarter glass in the fastback C pillar.
    windows: { belt: 0.04, top: 0.06, trim: true, bands: [{ u0: 0.86, u1: -1.8, k0: 0.62, k1: 0.5 }], pillars: [-0.32, -1.32] },
    windshield: [0.97, 0.28], backlight: [-1.3, -2.0],
    rim: { n: 10, style: 'multi', color: 0x45494f },
    doors: [0.86, -0.32, -1.38], handles: [-0.2, -1.26],
    stats: { top: 1.0, accel: 1.0, grip: 1.1 },
    details(c) {
      // Wide black grille, gloss-black bar joining slim swept headlights.
      c.frontMid('grille', [[-0.42, 0.36], [0.42, 0.36], [0.56, 0.5], [0.5, 0.64], [-0.5, 0.64], [-0.56, 0.5]]);
      c.frontMid('dark', [[-0.52, 0.655], [0.52, 0.655], [0.52, 0.69], [-0.52, 0.69]], 0.016);
      c.frontMid('chrome', hondaH(0, 0.56), 0.02);
      c.front('lens', [[0.5, 0.65], [0.84, 0.71], [0.9, 0.67], [0.86, 0.61], [0.54, 0.61]]);
      c.front('head', [[0.53, 0.643], [0.83, 0.697], [0.845, 0.686], [0.54, 0.632]], 0.018);
      c.front('dark', [[0.62, 0.28], [0.82, 0.3], [0.84, 0.46], [0.7, 0.44]]);
      // Slim tail lights joined by a thin red bar across the trunk lid.
      c.rear('tail', [[0.3, 0.885], [0.86, 0.9], [0.9, 0.84], [0.84, 0.82], [0.32, 0.845]]);
      c.rearMid('tail', rect(-0.31, 0.855, 0.31, 0.872));
      c.rearMid('dark', [[-0.72, 0.28], [0.72, 0.28], [0.68, 0.4], [-0.68, 0.4]]);
      c.rearMid('chrome', hondaH(0, 0.78), 0.016);
      c.plate(0.6);
      c.box('paint', 0, 0.99, 2.36, 1.1, 0.02, 0.06);
    },
  },
  is300: {
    brand: 'Lexus', name: 'IS 300', color: 0x3567b5, desc: 'Spindle grille, sharp handling',
    len: 4.71, width: 1.84, wheelR: 0.335, tireW: 0.235, axles: [1.42, -1.38], round: 0.2, fin: -1.0,
    section: { shoulder: 0.66, belt: 0.06, tuck: 0.08, crease: 1.2, crown: 0.03, flare: 0.012, gap: 0.045 },
    side: [[2.35, 0.25, 0.7], [2.2, 0.18, 0.8], [1.6, 0.18, 0.86], [0.95, 0.18, 0.9], [-0.6, 0.2, 0.95], [-1.75, 0.22, 1.0], [-2.22, 0.25, 1.02], [-2.35, 0.32, 0.88]],
    plan: [[2.35, 0.72], [2.15, 0.88], [1.6, 0.91], [-1.5, 0.94], [-2.2, 0.88], [-2.35, 0.78]],
    cabin: [[0.95, 0.91, 0.74], [0.2, 1.37, 0.66], [-0.75, 1.42, 0.66], [-1.35, 1.32, 0.68], [-1.8, 1.0, 0.8]],
    // Chrome-trimmed window line that kicks up and ends in a sharp point.
    windows: { belt: 0.04, top: 0.06, trim: true, bands: [{ u0: 0.8, u1: -1.56, k0: 0.6, k1: 0.75 }], pillars: [-0.36], kick: [[-0.9, 0], [-1.56, 0.07]] },
    windshield: [0.92, 0.22], backlight: [-1.3, -1.76],
    rim: { n: 5, style: 'split', color: 0xc4c8ce },
    doors: [0.8, -0.36, -1.32], handles: [-0.22, -1.2],
    stats: { top: 1.12, accel: 1.1, grip: 1.2 },
    details(c) {
      // The hourglass spindle grille in a chrome frame.
      const spindle = [[-0.36, 0.7], [0.36, 0.7], [0.26, 0.5], [0.56, 0.22], [-0.56, 0.22], [-0.26, 0.5]];
      c.frontMid('chrome', [[-0.39, 0.72], [0.39, 0.72], [0.29, 0.5], [0.6, 0.2], [-0.6, 0.2], [-0.29, 0.5]], 0.01);
      c.frontMid('grille', spindle, 0.016);
      c.frontMid('chrome', ellipse(0, 0.62, 0.075, 0.045), 0.022);
      c.front('lens', [[0.42, 0.7], [0.86, 0.76], [0.89, 0.7], [0.8, 0.65], [0.46, 0.655]]);
      c.front('head', [[0.48, 0.67], [0.8, 0.705], [0.82, 0.685], [0.5, 0.652]], 0.018);
      // L-shaped "arrowhead" running light under each headlight.
      c.front('head', [[0.64, 0.46], [0.69, 0.46], [0.75, 0.62], [0.7, 0.62]], 0.016);
      c.front('dark', [[0.62, 0.24], [0.8, 0.26], [0.83, 0.44], [0.7, 0.42]]);
      // Full-width L-shaped tail lights.
      c.rear('tail', [[0.25, 0.935], [0.83, 0.95], [0.86, 0.88], [0.74, 0.86], [0.72, 0.75], [0.66, 0.75], [0.66, 0.88], [0.27, 0.9]]);
      c.rearMid('tail', rect(-0.26, 0.913, 0.26, 0.928));
      c.rearMid('dark', [[-0.72, 0.3], [0.72, 0.3], [0.68, 0.42], [-0.68, 0.42]]);
      c.rearMid('chrome', ellipse(0, 0.8, 0.07, 0.04), 0.016);
      c.plate(0.62);
      for (const s of [-1, 1]) c.pipe(s * 0.5, 0.37, 'square');
      c.box('paint', 0, 1.025, 2.25, 1.1, 0.02, 0.08);
    },
  },
  legacy: {
    brand: 'Subaru', name: 'Legacy', color: 0x9aa0a6, desc: 'All-wheel drive, grips anything',
    len: 4.84, width: 1.84, wheelR: 0.335, tireW: 0.225, axles: [1.4, -1.35], round: 0.18, fin: -1.1,
    section: { shoulder: 0.64, belt: 0.05, tuck: 0.07, crease: 1.45, crown: 0.028, gap: 0.05 },
    side: [[2.42, 0.3, 0.68], [2.25, 0.2, 0.82], [1.7, 0.2, 0.9], [1.05, 0.2, 0.94], [-0.5, 0.21, 0.97], [-1.75, 0.22, 1.02], [-2.3, 0.25, 1.02], [-2.42, 0.33, 0.9]],
    plan: [[2.42, 0.74], [2.25, 0.87], [1.7, 0.92], [-1.8, 0.92], [-2.3, 0.88], [-2.42, 0.8]],
    cabin: [[1.05, 0.95, 0.74], [0.3, 1.46, 0.68], [-0.85, 1.5, 0.68], [-1.45, 1.38, 0.7], [-1.85, 1.03, 0.8]],
    // Upright, airy six-window glass house with chrome trim.
    windows: { belt: 0.04, top: 0.06, trim: true, bands: [{ u0: 0.9, u1: -1.64, k0: 0.64, k1: 0.75 }], pillars: [-0.3, -1.26] },
    windshield: [1.02, 0.32], backlight: [-1.4, -1.82],
    rim: { n: 5, style: 'twin', color: 0xb9bec5 },
    doors: [0.9, -0.3, -1.32], handles: [-0.17, -1.2],
    stats: { top: 0.98, accel: 1.0, grip: 1.25 },
    details(c) {
      // Hexagon grille with a chrome wing and the blue six-star oval.
      c.frontMid('grille', [[-0.4, 0.7], [0.4, 0.7], [0.5, 0.56], [0.4, 0.42], [-0.4, 0.42], [-0.5, 0.56]]);
      c.frontMid('chrome', rect(-0.62, 0.585, 0.62, 0.612), 0.018);
      c.frontMid('chrome', ellipse(0, 0.6, 0.095, 0.055), 0.021);
      c.frontMid('badge', ellipse(0, 0.6, 0.08, 0.042), 0.024);
      c.front('lens', [[0.5, 0.72], [0.86, 0.77], [0.9, 0.7], [0.62, 0.6], [0.52, 0.62]]);
      // Subaru's C-shaped LED running lights.
      c.front('head', [[0.6, 0.705], [0.86, 0.745], [0.87, 0.725], [0.62, 0.69]], 0.018);
      c.front('head', [[0.84, 0.66], [0.875, 0.67], [0.88, 0.74], [0.85, 0.74]], 0.018);
      c.front('head', [[0.64, 0.625], [0.85, 0.665], [0.85, 0.645], [0.65, 0.608]], 0.018);
      c.frontMid('grille', [[-0.5, 0.26], [0.5, 0.26], [0.55, 0.38], [-0.55, 0.38]]);
      c.front('dark', [[0.66, 0.3], [0.82, 0.32], [0.84, 0.44], [0.68, 0.42]]);
      // C-shaped tail lights joined by chrome.
      c.rear('tail', [[0.45, 1.0], [0.87, 1.0], [0.88, 0.84], [0.45, 0.85], [0.45, 0.885], [0.82, 0.88], [0.82, 0.96], [0.45, 0.965]]);
      c.rearMid('chrome', rect(-0.45, 0.915, 0.45, 0.935));
      c.rearMid('dark', [[-0.72, 0.3], [0.72, 0.3], [0.68, 0.42], [-0.68, 0.42]]);
      c.plate(0.66);
      for (const s of [-1, 1]) c.pipe(s * 0.52, 0.36);
    },
  },
  carnival: {
    brand: 'Kia', name: 'Carnival', color: 0xeeeeea, desc: '7 seats, sliding doors. Heavy.', heavy: true,
    len: 5.16, width: 2.0, wheelR: 0.37, tireW: 0.235, axles: [1.62, -1.47], round: 0.15, cladding: true, fin: -2.0,
    section: { shoulder: 0.6, belt: 0.045, tuck: 0.06, crease: 1.6, crown: 0.025, flare: 0.015, gap: 0.06 },
    side: [[2.58, 0.4, 0.84], [2.45, 0.3, 1.0], [2.1, 0.3, 1.08], [1.45, 0.3, 1.14], [0, 0.31, 1.15], [-1.8, 0.32, 1.18], [-2.45, 0.35, 1.18], [-2.55, 0.42, 1.1], [-2.58, 0.5, 1.0]],
    plan: [[2.58, 0.8], [2.4, 0.93], [2.0, 0.99], [-2.2, 0.99], [-2.5, 0.94], [-2.58, 0.86]],
    cabin: [[1.45, 1.15, 0.82], [0.75, 1.7, 0.78], [0.5, 1.76, 0.78], [-1.9, 1.76, 0.78], [-2.35, 1.72, 0.8], [-2.53, 1.22, 0.84]],
    // Long flat glass line in black, with the Carnival's big chrome blade on the D pillar.
    windows: {
      belt: 0.05, top: 0.08, trim: true, bands: [{ u0: 1.3, u1: -2.3, k0: 0.75, k1: 30 }], pillars: [0.0, -1.4],
      extra: [{ u0: -1.86, u1: -2.08, k0: 2.2, k1: 30, mat: 'chrome', off: 0.02 }],
    },
    windshield: [1.4, 0.78], backlight: [-2.36, -2.5],
    rim: { n: 10, style: 'multi', color: 0xc4c8ce },
    doors: [1.3, 0.0, -1.4], handles: [0.14, -0.12],
    stats: { top: 0.9, accel: 0.9, grip: 0.92 },
    details(c) {
      // Full-width "tiger face" grille running into the headlights.
      c.frontMid('grille', [[-0.66, 0.5], [0.66, 0.5], [0.74, 0.6], [0.74, 0.95], [0.66, 0.99], [-0.66, 0.99], [-0.74, 0.95], [-0.74, 0.6]]);
      c.frontMid('chrome', rect(-0.7, 0.975, 0.7, 0.99), 0.018);
      c.front('lens', [[0.66, 0.97], [0.9, 1.01], [0.94, 0.95], [0.74, 0.9]]);
      c.front('head', [[0.7, 0.975], [0.9, 1.0], [0.91, 0.98], [0.72, 0.955]], 0.018);
      // Stepped running lights down the corners.
      c.front('head', [[0.79, 0.6], [0.84, 0.6], [0.9, 0.9], [0.86, 0.91]], 0.016);
      c.frontMid('dark', [[-0.72, 0.34], [0.72, 0.34], [0.76, 0.47], [-0.76, 0.47]]);
      c.frontMid('chrome', rect(-0.45, 0.36, 0.45, 0.385), 0.016);
      // Thin full-width light bar plus corner lamps.
      c.rearMid('tail', rect(-0.8, 1.1, 0.8, 1.13));
      c.rear('tail', [[0.78, 0.92], [0.92, 0.94], [0.92, 1.16], [0.78, 1.14]]);
      c.rearMid('dark', [[-0.86, 0.44], [0.86, 0.44], [0.86, 0.56], [-0.86, 0.56]]);
      c.rearMid('chrome', rect(-0.12, 1.0, 0.12, 1.02), 0.016);
      c.plate(0.8);
      for (const s of [-1, 1]) c.box('dark', s * 0.66, 1.8, 0.85, 0.05, 0.06, 2.6);
    },
  },
  bike: {
    kind: 'bike', brand: 'Pedal power', name: 'Bicycle', color: 0x2fa36b, desc: 'Slow, but squeezes past anything',
    len: 1.8, width: 0.65, wheelR: 0.34, stats: { top: 0.62, accel: 0.8, grip: 1.35 },
  },
  ebike: {
    kind: 'bike', electric: true, brand: 'Cam’s', name: 'E-bike', color: 0xf2a33a, desc: 'Tuned motor: keeps up with the cars, still tiny',
    len: 1.85, width: 0.65, wheelR: 0.35, stats: { top: 1.0, accel: 1.2, grip: 1.3 },
  },
};

export const CAR_IDS = Object.keys(CAR_MODELS);
export const TRAFFIC_MIX = CAR_IDS.filter((id) => !CAR_MODELS[id].kind);
export const PAINTS = [0xf2f2f0, 0x1c1c1e, 0x9aa0a6, 0x5d636b, 0x8f1d21, 0xc8102e, 0x3567b5, 0x2e4a6b, 0x3d6b4a, 0xe0b23a];
export const TRAFFIC_COLORS = PAINTS;

// ---------- shared materials ----------
let envMap = null;
// A soft studio reflection for paint and glass, so curves read as curves.
export function initCarEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  for (const m of [glassMat, chromeMat, lensMat, badgeMat]) {
    m.envMap = envMap;
    m.needsUpdate = true;
  }
}

export const getCarEnvMap = () => envMap;
export const sharedCarMaterials = () => ({ tireMat, rimMat, darkMat, chromeMat, glassMat });

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Honeycomb mesh for grilles.
const grilleTex = canvasTex(64, 64, (g) => {
  g.fillStyle = '#0d0e10';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#3a3e45';
  g.lineWidth = 4;
  for (const [ox, oy] of [[0, 0], [32, 32], [64, 0], [0, 64], [64, 64]]) {
    g.beginPath();
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      g.lineTo(ox + Math.cos(a) * 17, oy + Math.sin(a) * 17);
    }
    g.stroke();
  }
});
grilleTex.wrapS = grilleTex.wrapT = THREE.RepeatWrapping;
grilleTex.repeat.set(14, 6);

// An Alberta-style plate (white, red characters, "Wild Rose Country").
const plateTex = canvasTex(256, 128, (g) => {
  g.fillStyle = '#f7f7f2';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#9b1c22';
  g.lineWidth = 6;
  g.strokeRect(4, 4, 248, 120);
  g.fillStyle = '#9b1c22';
  g.textAlign = 'center';
  g.font = 'italic bold 22px sans-serif';
  g.fillText('Alberta', 128, 30);
  g.font = 'bold 50px sans-serif';
  g.fillText('GO HOME', 128, 88, 228);
  g.font = '14px sans-serif';
  g.fillText('WILD ROSE COUNTRY', 128, 114);
});

const glassMat = new THREE.MeshStandardMaterial({ color: 0x0e1621, roughness: 0.05, metalness: 0.9, envMapIntensity: 0.9 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe6e9ee, roughness: 0.15, metalness: 1, envMapIntensity: 1 });
const lensMat = new THREE.MeshStandardMaterial({ color: 0x30353c, roughness: 0.1, metalness: 0.7, envMapIntensity: 1 });
const badgeMat = new THREE.MeshStandardMaterial({ color: 0x1f3f8f, roughness: 0.2, metalness: 0.5 });
const grilleMat = new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.5 });
const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.6 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.92 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0x9da3ab, metalness: 0.8, roughness: 0.3 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6d5, emissive: 0xfff2c0, emissiveIntensity: 1.6 });
const rimMats = new Map();
const rimMatFor = (color) => {
  if (!rimMats.has(color)) rimMats.set(color, new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.28, envMap, envMapIntensity: 1.1 }));
  return rimMats.get(color);
};

// A soft oval shadow (bikes and fun rides), stretched to width × length.
let softShadowTex = null;
export function softShadow(width, length, opacity = 0.6) {
  if (!softShadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.9)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    softShadowTex = new THREE.CanvasTexture(c);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: softShadowTex, transparent: true, opacity, depthWrite: false }),
  );
  mesh.position.y = 0.03;
  mesh.renderOrder = -1;
  return mesh;
}

// ---------- smooth interpolation through key points (Fritsch–Carlson, no overshoot) ----------
function monotone(keys) {
  const k = [...keys].sort((a, b) => a[0] - b[0]);
  const xs = k.map((p) => p[0]);
  const ys = k.map((p) => p[1]);
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// Rounded, tapered cross-section: top centre → right side → bottom centre → left side.
function ring(y0, y1, wb, wt, rb, rt) {
  const h = Math.max(0.01, y1 - y0);
  rb = Math.min(rb, wb, h / 2);
  rt = Math.min(rt, wt, h / 2);
  const A = 5;
  const right = [];
  for (let k = 0; k <= A; k++) {
    const a = Math.PI / 2 - (k / A) * (Math.PI / 2);
    right.push([wt - rt + rt * Math.cos(a), y1 - rt + rt * Math.sin(a)]);
  }
  for (let k = 0; k <= A; k++) {
    const a = -(k / A) * (Math.PI / 2);
    right.push([wb - rb + rb * Math.cos(a), y0 + rb + rb * Math.sin(a)]);
  }
  const pts = [[0, y1], ...right, [0, y0]];
  for (let k = right.length - 1; k >= 0; k--) pts.push([-right[k][0], right[k][1]]);
  return pts;
}

// Half-width of a ring() section at height y (-1 outside it).
function ringX(y, y0, y1, wb, wt, rb, rt) {
  const h = y1 - y0;
  if (h <= 0 || y < y0 || y > y1) return -1;
  rb = Math.min(rb, wb, h / 2);
  rt = Math.min(rt, wt, h / 2);
  if (y > y1 - rt) {
    const dy = y - (y1 - rt);
    return wt - rt + Math.sqrt(Math.max(0, rt * rt - dy * dy));
  }
  if (y < y0 + rb) {
    const dy = y0 + rb - y;
    return wb - rb + Math.sqrt(Math.max(0, rb * rb - dy * dy));
  }
  const t = (y - (y0 + rb)) / Math.max(1e-6, y1 - rt - (y0 + rb));
  return wb + (wt - wb) * t;
}

// Height of the top of a ring() section at sideways offset x.
function ringTop(x, y1, wt, rt) {
  const ax = Math.abs(x);
  if (ax <= wt - rt) return y1;
  const dx = Math.min(rt, ax - (wt - rt));
  return y1 - rt + Math.sqrt(Math.max(0, rt * rt - dx * dx));
}

// Join cross-sections (front to back) into a smooth closed mesh with flat end caps.
// A section may carry `shade`, one paint multiplier per point (stored as vertex colours).
function loft(sections) {
  const K = sections[0].pts.length;
  const pos = [];
  const col = [];
  const idx = [];
  for (const { u, pts, shade } of sections) {
    pts.forEach(([x, y], k) => {
      pos.push(x, y, -u);
      const c = shade ? shade[k] : 1;
      col.push(c, c, c);
    });
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < K; k++) {
      const a = i * K + k;
      const b = i * K + ((k + 1) % K);
      const c = (i + 1) * K + ((k + 1) % K);
      const d = (i + 1) * K + k;
      idx.push(a, c, b, a, d, c);
    }
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  side.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  side.setIndex(idx);
  side.computeVertexNormals();
  const nrm = side.getAttribute('normal');
  sections.forEach((sec, i) => {
    if (!(sec.edge > 0)) return;
    for (const [k, above] of [[sec.edge, sec.edge - 1], [K - sec.edge, K - sec.edge + 1]]) {
      nrm.setXYZ(i * K + k, nrm.getX(i * K + above), nrm.getY(i * K + above), nrm.getZ(i * K + above));
    }
  });

  // Caps get their own vertices so their shading stays flat.
  const capPos = [];
  const capCol = [];
  const capIdx = [];
  const cap = (sec, front) => {
    const base = capPos.length / 3;
    let cy = 0;
    for (const [, y] of sec.pts) cy += y;
    capPos.push(0, cy / K, -sec.u);
    capCol.push(1, 1, 1);
    sec.pts.forEach(([x, y], k) => {
      capPos.push(x, y, -sec.u);
      const c = sec.shade ? sec.shade[k] : 1;
      capCol.push(c, c, c);
    });
    for (let k = 0; k < K; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % K);
      if (front) capIdx.push(base, a, b); else capIdx.push(base, b, a);
    }
  };
  cap(sections[0], true);
  cap(sections[sections.length - 1], false);
  const caps = new THREE.BufferGeometry();
  caps.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
  caps.setAttribute('color', new THREE.Float32BufferAttribute(capCol, 3));
  caps.setIndex(capIdx);
  caps.computeVertexNormals();
  return [side, caps];
}

// Triangles from a flat list of [x, y, z] corners, facing towards `facing`.
function triMesh(tris, facing, uvs) {
  const pos = [];
  const uv = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < tris.length; i += 3) {
    a.fromArray(tris[i]);
    b.fromArray(tris[i + 1]);
    c.fromArray(tris[i + 2]);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const order = n.dot(facing) >= 0 ? [0, 1, 2] : [0, 2, 1];
    for (const o of order) {
      pos.push(...tris[i + o]);
      uv.push(...(uvs ? uvs[i + o] : [0, 0]));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Merge-friendly copy: non-indexed with position, normal, uv and colour only.
function plain(g) {
  const p = g.index ? g.toNonIndexed() : g;
  const n = p.getAttribute('position').count;
  if (!p.getAttribute('normal')) p.computeVertexNormals();
  if (!p.getAttribute('uv')) p.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!p.getAttribute('color')) p.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  for (const name of Object.keys(p.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) p.deleteAttribute(name);
  return p;
}

// ---------- per-model geometry (cached) ----------
const geoCache = new Map();

// Body cross-section shape. Per model in `section`:
//   shoulder: height (0..1 of the body side) where the body is widest
//   belt / tuck: how far the top edge and the rocker sit inside that widest line (m)
//   crease: sharpness of the shoulder line (2 = soft and round, ~1.2 = a crisp character line)
//   crown: how much the hood and trunk lid bulge up in the middle (m)
//   flare: extra width bulging around the wheel arches (m)
//   gap: space between the tyre and the top of its wheel arch (m)
//   rocker: black trim along the bottom of the doors
const SECTION = { shoulder: 0.6, belt: 0.05, tuck: 0.07, crease: 1.6, crown: 0.03, flare: 0, gap: 0.05, rocker: true };
const SIDE_SAMPLES = 10;
// Bumpers: the last `nose` / `tail` metres of the body round off like a pillow
// (a superellipse, so the face stays fairly flat with soft edges).
const BUMPER_P = 2.6;
const BUMPER_C = [0.97, 0.9, 0.8, 0.66, 0.5, 0.32, 0.14, 0];
const bumperScale = (t) => (1 - clamp01(t) ** BUMPER_P) ** (1 / BUMPER_P);
const bumperT = (c) => (1 - c ** BUMPER_P) ** (1 / BUMPER_P);
const GRID = 0.01; // spacing of the precomputed sections used for surface lookups

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, v) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};

function buildShape(id) {
  if (geoCache.has(id)) return geoCache.get(id);
  const d = CAR_MODELS[id];
  const S = { ...SECTION, ...d.section };
  const bottom = monotone(d.side.map(([u, b]) => [u, b]));
  const top = monotone(d.side.map(([u, , t]) => [u, t]));
  const half = monotone(d.plan);
  const roofY = monotone(d.cabin.map(([u, r]) => [u, r]));
  const roofW = monotone(d.cabin.map(([u, , w]) => [u, w]));
  const uFront = Math.max(...d.side.map((k) => k[0]));
  const uBack = Math.min(...d.side.map((k) => k[0]));
  const cFront = Math.max(...d.cabin.map((k) => k[0]));
  const cBack = Math.min(...d.cabin.map((k) => k[0]));
  const rTop = Math.min(0.1, d.round * 0.5);
  const rtG = Math.min(0.22, d.round * 0.7);
  const tireW = d.tireW ?? 0.235;
  const nose = d.nose ?? 0.13;
  const tail = d.tail ?? 0.11;
  // How much the section is shrunk towards its centre at u (1 = not at all).
  const bumper = (u) => {
    if (u > uFront - nose) return bumperScale((u - (uFront - nose)) / nose);
    if (u < uBack + tail) return bumperScale((uBack + tail - u) / tail);
    return 1;
  };

  // Wheels sit just inside the widest line of the body; their wells are cut out of it.
  const wheelX = (axle) => half(axle) - 0.015 - tireW / 2;
  const arches = d.axles.map((a) => ({ u: a, R: d.wheelR + S.gap, xIn: half(a) - tireW - 0.05 }));
  const archAt = (u) => arches.find((A) => Math.abs(u - A.u) < A.R);
  // Top of the wheel opening at u (-Infinity away from the wheels).
  const archTop = (u) => {
    const A = archAt(u);
    return A ? d.wheelR + Math.sqrt(A.R * A.R - (u - A.u) ** 2) : -Infinity;
  };
  // Distance outside the nearest wheel opening's edge (negative inside it).
  const archDist = (u, y) => {
    let best = Infinity;
    for (const A of arches) best = Math.min(best, Math.hypot(u - A.u, y - d.wheelR) - A.R);
    return best;
  };

  // Right half of the body section at u, top centre → bottom centre, with a paint shade
  // per point: a little darker low down, black inside the wheel wells and on trim.
  function section(u) {
    const y0 = bottom(u);
    const y1 = top(u);
    const w = half(u);
    const h = y1 - y0;
    const rt = Math.min(rTop, h * 0.4);
    const rb = Math.min(0.08, h * 0.3);
    const wt = w - S.belt;
    const wb = w - S.tuck;
    const crownY = (x) => y1 - S.crown * (x / wt) ** 2;
    const edgeY = crownY(wt - rt);
    const sideTop = edgeY - rt;
    const sideBot = y0 + rb;
    const span = Math.max(1e-4, sideTop - sideBot);
    const shoulderY = Math.min(sideTop - span * 0.05, Math.max(sideBot + span * 0.05, y0 + h * S.shoulder));
    const sideX = (y) => (y >= shoulderY
      ? w - S.belt * ((y - shoulderY) / Math.max(1e-4, sideTop - shoulderY)) ** S.crease
      : w - S.tuck * ((shoulderY - y) / Math.max(1e-4, shoulderY - sideBot)) ** 1.8);

    const arch = archAt(u);
    const cutY = arch ? Math.min(sideTop - 0.004, Math.max(sideBot + 0.004, archTop(u))) : null;
    // SUVs: black plastic below this line (the sill, rising into a band around each arch).
    const MOLD = 0.075;
    let moldY = -Infinity;
    if (d.cladding) {
      moldY = y0 + 0.17;
      for (const A of arches) {
        const du = u - A.u;
        const R = A.R + MOLD;
        if (Math.abs(du) < R) moldY = Math.max(moldY, d.wheelR + Math.sqrt(R * R - du * du));
      }
      moldY = Math.min(sideTop - 0.002, Math.max(sideBot + 0.002, moldY));
    }
    const pts = [];
    const shade = [];
    const paintAt = (y) => {
      if (d.cladding && y < moldY) return 0.13;
      return 0.8 + 0.2 * smoothstep(y0, y0 + 0.45, y);
    };
    const push = (x, y, c, inner = false) => {
      if (inner) {
        pts.push([Math.min(x, arch.xIn), y]);
        shade.push(0.05);
        return;
      }
      const ad = archDist(u, y);
      const xx = S.flare && ad >= 0 && ad < 0.22 ? x + S.flare * (1 - ad / 0.22) ** 2 : x;
      pts.push([xx, y]);
      shade.push(c);
    };
    for (const f of [0, 0.4, 0.75]) {
      const x = (wt - rt) * f;
      push(x, crownY(x), 1);
    }
    for (let k = 0; k <= 4; k++) {
      const a = (Math.PI / 2) * (1 - k / 4);
      const y = sideTop + rt * Math.sin(a);
      push(wt - rt + rt * Math.cos(a), y, paintAt(y));
    }
    // Down the side, in fixed segments so every section has the same points in the same
    // order (keeps the surface from twisting between sections). Pairs of points at the
    // same spot make crisp edges: on SUVs where the black cladding starts, and where the
    // wheel opening starts (pinned to the bottom of the side away from the wheels).
    const breakY = cutY ?? sideBot + 0.004;
    const upperEnd = d.cladding ? moldY : breakY;
    let edge = -1;
    const UPPER = 6;
    for (let k = 1; k <= UPPER; k++) {
      const y = sideTop - ((sideTop - upperEnd) * k) / (UPPER + 1);
      push(sideX(y), y, paintAt(y));
    }
    if (d.cladding) {
      push(sideX(moldY), moldY, 0.8 + 0.2 * smoothstep(y0, y0 + 0.45, moldY));
      push(sideX(moldY), moldY, 0.13);
      for (let k = 1; k <= 3; k++) {
        const y = moldY - ((moldY - breakY) * k) / 4;
        push(sideX(y), y, 0.13);
      }
    }
    if (cutY != null) edge = pts.length;
    push(sideX(breakY), breakY, paintAt(breakY + 0.001));
    push(sideX(breakY), breakY, paintAt(breakY + 0.001), cutY != null);
    for (let k = 1; k <= 2; k++) {
      const y = breakY - ((breakY - sideBot) * k) / 2;
      push(sideX(y), y, paintAt(y), cutY != null);
    }
    // Rocker panel: dark trim below the side (a repeated point keeps the edge crisp).
    const low = S.rocker ? 0.3 : null;
    const last = pts[pts.length - 1];
    if (cutY != null) push(last[0], last[1], 0.05, true);
    else {
      pts.push([last[0], last[1]]);
      shade.push(d.cladding ? 0.13 : low ?? shade[shade.length - 1]);
    }
    for (let k = 1; k <= 3; k++) {
      const a = -(Math.PI / 2) * (k / 3);
      const y = sideBot + rb * Math.sin(a);
      push(wb - rb + rb * Math.cos(a), y, d.cladding ? 0.13 : low ?? paintAt(y), cutY != null);
    }
    push((wb - rb) * 0.5, y0, 0.2, cutY != null);
    push(0, y0, 0.2);
    // Underbody.
    shade[shade.length - 1] = 0.2;
    shade[shade.length - 2] = Math.min(shade[shade.length - 2], 0.2);
    const c = bumper(u);
    if (c < 1) {
      const cy = (y0 + y1) / 2;
      for (const p of pts) {
        p[0] *= c;
        p[1] = cy + (p[1] - cy) * c;
      }
    }
    return { pts, shade, edge: cutY != null ? edge : -1 };
  }
  const mirrored = ({ pts, shade, edge }, u) => {
    const P = [...pts];
    const C = [...shade];
    for (let k = pts.length - 2; k >= 1; k--) {
      P.push([-pts[k][0], pts[k][1]]);
      C.push(shade[k]);
    }
    return { u, pts: P, shade: C, edge };
  };

  // Surface lookup tables, so placing lights, door lines and mirrors stays fast:
  // xTab[i][j] = half-width of the body at station i (every GRID m from the front), height j·DY.
  const gridN = Math.ceil((uFront - uBack) / GRID) + 1;
  const gridU = (i) => Math.max(uBack, uFront - i * GRID);
  const DY = 0.005;
  const NY = Math.ceil(2.2 / DY) + 1;
  const xTab = new Float32Array(gridN * NY).fill(-1);
  for (let i = 0; i < gridN; i++) {
    const pts = section(gridU(i)).pts;
    for (let k = 0; k < pts.length - 1; k++) {
      const [xa, ya] = pts[k];
      const [xb, yb] = pts[k + 1];
      const lo = Math.ceil(Math.min(ya, yb) / DY);
      const hi = Math.floor(Math.max(ya, yb) / DY);
      for (let j = Math.max(0, lo); j <= Math.min(NY - 1, hi); j++) {
        const y = j * DY;
        const x = ya === yb ? Math.max(xa, xb) : xa + ((xb - xa) * (y - ya)) / (yb - ya);
        if (x > xTab[i * NY + j]) xTab[i * NY + j] = x;
      }
    }
  }
  const bodyX = (u, y) => {
    if (u > uFront || u < uBack || y < 0) return -1;
    const fi = Math.min(gridN - 1.001, (uFront - u) / GRID);
    const fj = Math.min(NY - 1.001, y / DY);
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const a = xTab[i * NY + j];
    const b = xTab[(i + 1) * NY + j];
    const c = xTab[i * NY + j + 1];
    const e = xTab[(i + 1) * NY + j + 1];
    if (a < 0 || b < 0 || c < 0 || e < 0) return xTab[Math.round(fi) * NY + Math.round(fj)];
    const ti = fi - i;
    const tj = fj - j;
    return (a + (b - a) * ti) * (1 - tj) + (c + (e - c) * ti) * tj;
  };

  // Glass-house section at u. It starts inside the body so the joint never shows.
  const gh = (u) => {
    const y0 = top(u) - 0.1;
    return { y0, y1: Math.max(y0 + 0.02, roofY(u)), wb: half(u) - rTop * 0.7, wt: roofW(u) };
  };
  const ghX = (u, y) => {
    if (u > cFront || u < cBack) return -1;
    const g = gh(u);
    return ringX(y, g.y0, g.y1, g.wb, g.wt, 0.02, rtG);
  };

  // Glass-house section at every grid station (null outside the cabin).
  const ghTab = Array.from({ length: gridN }, (_, i) => {
    const u = gridU(i);
    return u > cFront || u < cBack ? null : gh(u);
  });
  const ghXAt = (i, y) => {
    const g = ghTab[i];
    return g ? ringX(y, g.y0, g.y1, g.wb, g.wt, 0.02, rtG) : -1;
  };
  // Depth maps: where a ray along the car's length first meets the body at (|x|, y),
  // looking from the front or from the back (NaN where it misses).
  const DX = 0.01;
  const NX = Math.ceil(1.2 / DX) + 1;
  const NYD = Math.ceil(2.2 / DX) + 1;
  const depthMap = (front) => {
    const map = new Float32Array(NX * NYD).fill(NaN);
    for (let j = 0; j < NYD; j++) {
      const y = j * DX;
      let reach = -1;
      let prevU = null;
      let prevX = -1;
      for (let i = 0; i < gridN; i++) {
        const idx = front ? i : gridN - 1 - i;
        const u = gridU(idx);
        const X = Math.max(j < NY ? xTab[idx * NY + Math.min(NY - 1, Math.round(y / DY))] : -1, ghXAt(idx, y));
        if (X > reach) {
          for (let k = Math.max(0, Math.floor(reach / DX) + 1); k < NX && k * DX <= X; k++) {
            const x = k * DX;
            // Interpolate between this station and the previous one for a smooth surface.
            const t = prevU == null || X - prevX < 1e-6 ? 1 : Math.max(0, Math.min(1, (x - prevX) / (X - prevX)));
            map[j * NX + k] = prevU == null ? u : prevU + (u - prevU) * t;
          }
          reach = X;
        }
        prevU = u;
        prevX = Math.max(prevX, X);
      }
    }
    return map;
  };
  const maps = { true: depthMap(true), false: depthMap(false) };
  const surfaceU = (x, y, front) => {
    const map = maps[front];
    const fx = Math.abs(x) / DX;
    const fy = y / DX;
    if (fx < 0 || fy < 0 || fx >= NX - 1 || fy >= NYD - 1) return null;
    const k = Math.floor(fx);
    const j = Math.floor(fy);
    const a = map[j * NX + k];
    const b = map[j * NX + k + 1];
    const c = map[(j + 1) * NX + k];
    const e = map[(j + 1) * NX + k + 1];
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(e)) return null;
    const tx = fx - k;
    const ty = fy - j;
    return (a + (b - a) * tx) * (1 - ty) + (c + (e - c) * tx) * ty;
  };
  // Outward surface normal there, from the depth map's slope.
  const surfaceNormal = (x, y, front, out = new THREE.Vector3()) => {
    const h = 0.012;
    const u0 = surfaceU(x, y, front);
    const ux = (surfaceU(x + h, y, front) ?? u0) - (surfaceU(x - h, y, front) ?? u0);
    const uy = (surfaceU(x, y + h, front) ?? u0) - (surfaceU(x, y - h, front) ?? u0);
    const sx = ux / (2 * h);
    const sy = uy / (2 * h);
    return front ? out.set(-sx, -sy, -1).normalize() : out.set(sx, sy, 1).normalize();
  };

  // Stations along the body: bunched at the ends for round noses and tails, and dense
  // around the wheels so the arch openings come out as clean curves.
  const stations = [];
  const N = 36;
  for (let i = 0; i < N; i++) stations.push((uFront + uBack) / 2 + ((uFront - uBack) / 2) * Math.cos((Math.PI * i) / (N - 1)));
  for (const A of arches) {
    for (let u = A.u - A.R - 0.06; u <= A.u + A.R + 0.06; u += 0.035) stations.push(u);
    stations.push(A.u - A.R - 0.003, A.u - A.R + 0.003, A.u + A.R - 0.003, A.u + A.R + 0.003);
  }
  for (const c of BUMPER_C) stations.push(uFront - nose + nose * bumperT(c), uBack + tail - tail * bumperT(c));
  stations.sort((a, b) => b - a);
  const body = [];
  for (const u of stations) {
    if (u > uFront || u < uBack) continue;
    if (body.length && body[body.length - 1].u - u < 0.002) continue;
    body.push(mirrored(section(u), u));
  }
  // Glass house sits on the belt line, narrower at the roof (tumblehome).
  const glassHouse = (m) => {
    const out = [];
    for (let i = 0; i < m; i++) {
      const u = cFront + ((cBack - cFront) * i) / (m - 1);
      const g = gh(u);
      out.push({ u, pts: ring(g.y0, g.y1, g.wb, g.wt, 0.02, rtG) });
    }
    return out;
  };
  const glass = glassHouse(30);

  // A coarser body for traffic far away (see makeTrafficCar): half the stations along the
  // body and over the wheel openings; the opening edges and the rounded bumper ends keep
  // all of theirs, so the outline and the lights stay where they were.
  const farStations = [];
  for (let i = 0; i < N / 2; i++) farStations.push((uFront + uBack) / 2 + ((uFront - uBack) / 2) * Math.cos((Math.PI * i) / (N / 2 - 1)));
  for (const A of arches) {
    for (let u = A.u - A.R - 0.06; u <= A.u + A.R + 0.06; u += 0.07) farStations.push(u);
    farStations.push(A.u - A.R - 0.003, A.u - A.R + 0.003, A.u + A.R - 0.003, A.u + A.R + 0.003);
  }
  for (const c of BUMPER_C) farStations.push(uFront - nose + nose * bumperT(c), uBack + tail - tail * bumperT(c));
  farStations.sort((a, b) => b - a);
  const farBody = [];
  for (const u of farStations) {
    if (u > uFront || u < uBack) continue;
    if (farBody.length && farBody[farBody.length - 1].u - u < 0.002) continue;
    farBody.push(mirrored(section(u), u));
  }

  const fn = {
    bottom, top, half, uFront, uBack, cFront, cBack, roofY, roofW, gh, bodyX, ghX, surfaceU, surfaceNormal, rtG,
    tireW, wheelX, archTop,
  };
  const geos = {
    body: loft(body),
    glass: loft(glass),
    farBody: loft(farBody),
    farGlass: loft(glassHouse(15)),
    shadow: shadowFor(d, fn),
    fn,
  };
  geos.parts = buildParts(d, fn);
  geos.wheel = buildWheel(d, fn);
  geoCache.set(id, geos);
  return geos;
}

// A soft contact shadow under the car, darker under each tyre.
function shadowFor(d, fn) {
  const W = d.width * 1.32;
  const L = d.len * 1.12;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  const sx = c.width / W;
  const sz = c.height / L;
  // Stacked, shrinking rounded rectangles fake a blur.
  for (let i = 0; i < 14; i++) {
    const inset = 4 + i * 2.4;
    g.fillStyle = 'rgba(0,0,0,0.06)';
    g.beginPath();
    g.roundRect(inset, inset * (sz / sx) * 0.6, c.width - inset * 2, c.height - inset * 2 * (sz / sx) * 0.6, 40 - i * 2);
    g.fill();
  }
  for (const axle of d.axles) {
    for (const s of [-1, 1]) {
      const x = c.width / 2 + s * fn.wheelX(axle) * sx;
      const y = (L / 2 - axle) * sz;
      const grad = g.createRadialGradient(x, y, 0, x, y, fn.tireW * sx * 1.4);
      grad.addColorStop(0, 'rgba(0,0,0,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - 40, y - 40, 80, 80);
    }
  }
  const map = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(W, L).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = -1;
  return mesh;
}

// Side glass, trim and pillars as thin skins on the glass house.
function windowGeos(d, fn, add) {
  const W = d.windows;
  if (!W) return;
  const kick = W.kick ? monotone(W.kick) : () => 0;
  const topOff = Math.max(W.top, fn.rtG * 0.9);
  const outline = (band, grow) => {
    const yb = (u) => fn.top(u) + W.belt + kick(u) - grow;
    const yb0 = yb(band.u0);
    const yb1 = yb(band.u1);
    return (u) => {
      const lo = yb(u);
      const hi = Math.min(
        fn.roofY(u) - topOff + grow,
        yb0 + (band.u0 + grow - u) * band.k0,
        yb1 + (u - band.u1 + grow) * band.k1,
      );
      return [lo, Math.max(lo, hi)];
    };
  };
  const skin = (mat, band, grow, off) => {
    const range = outline(band, grow);
    const u0 = band.u0 + grow;
    const u1 = band.u1 - grow;
    const cols = Math.max(2, Math.ceil((u0 - u1) / 0.04));
    const R = 3;
    for (const s of [-1, 1]) {
      const tris = [];
      const P = (u, y) => {
        const g = fn.gh(u);
        const yy = Math.min(Math.max(y, g.y0 + 0.001), g.y1 - 0.001);
        return [s * (fn.ghX(u, yy) + off), yy, -u];
      };
      for (let i = 0; i < cols; i++) {
        const ua = u0 - ((u0 - u1) * i) / cols;
        const ub = u0 - ((u0 - u1) * (i + 1)) / cols;
        const [la, ha] = range(ua);
        const [lb, hb] = range(ub);
        if (ha - la < 0.005 && hb - lb < 0.005) continue;
        for (let j = 0; j < R; j++) {
          const p00 = P(ua, la + ((ha - la) * j) / R);
          const p01 = P(ua, la + ((ha - la) * (j + 1)) / R);
          const p10 = P(ub, lb + ((hb - lb) * j) / R);
          const p11 = P(ub, lb + ((hb - lb) * (j + 1)) / R);
          tris.push(p00, p10, p11, p00, p11, p01);
        }
      }
      if (tris.length) add(mat, triMesh(tris, new THREE.Vector3(s, 0, 0)));
    }
  };
  for (const band of W.bands) {
    if (W.trim) skin('chrome', band, 0.028, 0.006);
    skin('glass', band, 0, 0.012);
    for (const p of W.pillars || []) skin('dark', { ...band, u0: p + 0.05, u1: p - 0.05, k0: 40, k1: 40 }, 0, 0.016);
  }
  for (const e of W.extra || []) skin(e.mat, { ...e }, 0, e.off ?? 0.016);
}

// Windshield / rear window as skins over the top of the glass house.
function topPane(fn, ua, ub, inset, add, mat = 'glass', lift = 0.012) {
  const tris = [];
  const cols = 10;
  const rows = Math.max(2, Math.ceil(Math.abs(ua - ub) / 0.03));
  const P = (u, t) => {
    const g = fn.gh(u);
    const rt = Math.min(fn.rtG, g.wt, (g.y1 - g.y0) / 2);
    const x = t * Math.max(0.01, g.wt - inset);
    return [x, ringTop(x, g.y1, g.wt, rt) + lift, -u];
  };
  for (let i = 0; i < rows; i++) {
    const u0 = ua + ((ub - ua) * i) / rows;
    const u1 = ua + ((ub - ua) * (i + 1)) / rows;
    for (let j = 0; j < cols; j++) {
      const t0 = -1 + (2 * j) / cols;
      const t1 = -1 + (2 * (j + 1)) / cols;
      tris.push(P(u0, t0), P(u1, t0), P(u1, t1), P(u0, t0), P(u1, t1), P(u0, t1));
    }
  }
  add(mat, triMesh(tris, new THREE.Vector3(0, 1, 0)));
}

// Everything that's baked into the body: decals, glass, mirrors, door lines, small details.
function buildParts(d, fn) {
  const byMat = new Map();
  const add = (mat, g) => {
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(plain(g));
  };

  const nrm = new THREE.Vector3();
  const WRAP_DEPTH = 0.32;
  const decal = (mat, pts, front, off, mirror) => {
    const cache = new Map();
    const map = (x, y) => {
      const key = `${x.toFixed(5)},${y.toFixed(5)}`;
      if (!cache.has(key)) {
        const u = fn.surfaceU(x, y, front);
        if (u == null || (front ? fn.uFront - u : u - fn.uBack) > WRAP_DEPTH) cache.set(key, null);
        else {
          fn.surfaceNormal(x, y, front, nrm);
          cache.set(key, [x + nrm.x * off, y + nrm.y * off, -u + nrm.z * off]);
        }
      }
      return cache.get(key);
    };
    const SAG = 0.004; // metres a decal edge may stray from the body before it's split
    for (const s of mirror ? [1, -1] : [1]) {
      const contour = pts.map(([x, y]) => new THREE.Vector2(x * s, y));
      const faces = THREE.ShapeUtils.triangulateShape(contour, []);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of contour) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const tris = [];
      const uvs = [];
      // Split a triangle while its edges cut through or float off the curved body.
      const bulge = (pa, pb, a2, b2) => {
        const m = map((a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2);
        if (!m) return Infinity;
        return Math.hypot(m[0] - (pa[0] + pb[0]) / 2, m[1] - (pa[1] + pb[1]) / 2, m[2] - (pa[2] + pb[2]) / 2);
      };
      const emit = (cell, depth) => {
        const v = cell.map(([x, y]) => map(x, y));
        if (v.some((p) => !p)) {
          if (depth >= 4) return;
        } else if (depth >= 4 || (bulge(v[0], v[1], cell[0], cell[1]) < SAG
          && bulge(v[1], v[2], cell[1], cell[2]) < SAG && bulge(v[2], v[0], cell[2], cell[0]) < SAG)) {
          tris.push(...v);
          for (const [x, y] of cell) uvs.push([(x - minX) / (maxX - minX || 1), (y - minY) / (maxY - minY || 1)]);
          return;
        }
        const [a, b, c] = cell;
        const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const ab = mid(a, b);
        const bc = mid(b, c);
        const ca = mid(c, a);
        emit([a, ab, ca], depth + 1);
        emit([ab, b, bc], depth + 1);
        emit([ca, bc, c], depth + 1);
        emit([ab, bc, ca], depth + 1);
      };
      const S = 4;
      for (const [ia, ib, ic] of faces) {
        const A = contour[ia];
        const B = contour[ib];
        const C = contour[ic];
        const at = (i, j) => [A.x + ((B.x - A.x) * i + (C.x - A.x) * j) / S, A.y + ((B.y - A.y) * i + (C.y - A.y) * j) / S];
        for (let i = 0; i < S; i++) {
          for (let j = 0; j < S - i; j++) {
            emit([at(i, j), at(i + 1, j), at(i, j + 1)], 0);
            if (j < S - i - 1) emit([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], 0);
          }
        }
      }
      if (tris.length) add(mat, triMesh(tris, new THREE.Vector3(0, 0, front ? -1 : 1), uvs));
    }
  };

  const ctx = {
    front: (mat, pts, off = 0.012) => decal(mat, pts, true, off, true),
    frontMid: (mat, pts, off = 0.012) => decal(mat, pts, true, off, false),
    rear: (mat, pts, off = 0.012) => decal(mat, pts, false, off, true),
    rearMid: (mat, pts, off = 0.012) => decal(mat, pts, false, off, false),
    plate(y) {
      decal('dark', rect(-0.18, y - 0.095, 0.18, y + 0.095), false, 0.012, false);
      decal('plate', rect(-0.16, y - 0.08, 0.16, y + 0.08), false, 0.018, false);
    },
    box(mat, x, y, z, w, h, dpt, tilt = 0) {
      const g = new THREE.BoxGeometry(w, h, dpt);
      if (tilt) g.rotateZ(tilt);
      add(mat, g.translate(x, y, z));
    },
    pipe(x, y, kind) {
      const z = -fn.surfaceU(x, y + 0.08, false) + 0.04;
      const g = kind === 'square' ? new THREE.BoxGeometry(0.13, 0.05, 0.1) : new THREE.CylinderGeometry(0.045, 0.045, 0.12, 12).rotateX(Math.PI / 2);
      add('chrome', g.translate(x, y, z));
      const inner = kind === 'square' ? new THREE.BoxGeometry(0.1, 0.03, 0.02) : new THREE.CircleGeometry(0.032, 12);
      add('dark', inner.translate(x, y, z + 0.061));
    },
  };
  d.details(ctx);

  // Glass.
  windowGeos(d, fn, add);
  if (d.windshield) topPane(fn, d.windshield[0], d.windshield[1], 0.07, add);
  if (d.backlight) topPane(fn, d.backlight[0], d.backlight[1], 0.08, add);

  // Wipers resting at the bottom of the windshield.
  if (d.windshield) {
    const u = d.windshield[0] - 0.07;
    const g = fn.gh(u);
    for (const s of [-1, 1]) {
      const arm = new THREE.BoxGeometry(0.62, 0.014, 0.03).rotateZ(s * 0.06);
      add('dark', arm.translate(s * 0.32 - 0.04, g.y1 + 0.03, -u));
    }
  }
  // Third brake light at the top of the rear window.
  if (d.backlight) {
    const u = d.backlight[0] + 0.02;
    add('tail', new THREE.BoxGeometry(0.34, 0.02, 0.05).translate(0, fn.roofY(u) + 0.02, -u));
  }
  // Shark-fin antenna.
  if (d.fin != null) {
    const fin = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.03, 0.065, 0.13);
    add('paint', fin.translate(0, fn.roofY(d.fin) + 0.005, -d.fin));
  }

  // Door shut lines (stopping at the wheel arches) and handles.
  for (const u of d.doors || []) {
    for (const s of [-1, 1]) {
      const tris = [];
      const y0 = Math.max(fn.bottom(u) + 0.1, fn.archTop(u) + 0.03);
      const y1 = fn.top(u) - 0.03;
      const R = 8;
      const P = (uu, y) => [s * (fn.bodyX(uu, y) + 0.004), y, -uu];
      for (let j = 0; j < R; j++) {
        const ya = y0 + ((y1 - y0) * j) / R;
        const yb = y0 + ((y1 - y0) * (j + 1)) / R;
        tris.push(P(u + 0.007, ya), P(u - 0.007, ya), P(u - 0.007, yb), P(u + 0.007, ya), P(u - 0.007, yb), P(u + 0.007, yb));
      }
      add('dark', triMesh(tris, new THREE.Vector3(s, 0, 0)));
    }
  }
  for (const u of d.handles || []) {
    for (const s of [-1, 1]) {
      const y = fn.top(u) - 0.11;
      const handle = new THREE.CapsuleGeometry(0.016, 0.13, 4, 8).rotateX(Math.PI / 2);
      add('chrome', handle.translate(s * (fn.bodyX(u, y) + 0.008), y, -u));
    }
  }

  // Mirrors: a rounded shell on a short arm at the bottom corner of the side glass.
  for (const s of [-1, 1]) {
    const u = fn.cFront - 0.3;
    const yBase = fn.top(u) + 0.02;
    const x = fn.ghX(u, yBase + 0.05);
    const y = yBase + 0.1;
    const shell = new THREE.SphereGeometry(0.1, 14, 10).scale(1.05, 0.62, 0.55);
    add('paint', shell.translate(s * (x + 0.17), y, -u));
    add('dark', new THREE.CircleGeometry(0.088, 14).scale(1.05, 0.58, 1).translate(s * (x + 0.17), y, -u + 0.052));
    const arm = new THREE.BoxGeometry(0.16, 0.05, 0.09);
    add('paint', arm.translate(s * (x + 0.07), y - 0.04, -u));
  }

  // Brake discs and calipers behind the spokes (they don't turn with the wheel).
  const rimR = d.wheelR * 0.7;
  for (const axle of d.axles) {
    for (const s of [-1, 1]) {
      const cx = s * (fn.wheelX(axle) + fn.tireW / 2 - 0.085);
      add('disc', new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.02, 28).rotateZ(Math.PI / 2).translate(cx, d.wheelR, -axle));
      const caliper = new THREE.BoxGeometry(0.05, 0.15, 0.09).translate(0, rimR * 0.68, 0).rotateX(axle > 0 ? -0.5 : 0.5);
      add('caliper', caliper.translate(cx + s * 0.02, d.wheelR, -axle));
    }
  }

  const out = {};
  for (const [mat, list] of byMat) out[mat] = mergeGeometries(list);
  return out;
}

// One wheel per side (rim face outwards), merged per material: a round-shouldered
// tyre, a dished rim with spokes, hub and wheel nuts, and a dark backing behind them.
function buildWheel(d, fn) {
  const r = d.wheelR;
  const tw = fn.tireW;
  const rimR = r * 0.7;
  const rim = d.rim || { n: 5, style: 'twin', color: 0x9da3ab };
  const groove = (y) => [[r, y - 0.009], [r - 0.012, y - 0.006], [r - 0.012, y + 0.006], [r, y + 0.009]];
  const profile = [
    [rimR - 0.005, -tw / 2 + 0.02], [rimR + 0.015, -tw / 2], [r - 0.05, -tw / 2 - 0.008], [r - 0.014, -tw / 2 + 0.01],
    [r, -tw / 2 + 0.04], ...groove(-tw / 6), ...groove(tw / 6), [r, tw / 2 - 0.04],
    [r - 0.014, tw / 2 - 0.01], [r - 0.05, tw / 2 + 0.008], [rimR + 0.015, tw / 2], [rimR - 0.005, tw / 2 - 0.02],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const tire = new THREE.LatheGeometry(profile, 26).rotateZ(-Math.PI / 2);
  const farTire = new THREE.LatheGeometry(profile, 12).rotateZ(-Math.PI / 2);

  const make = (s) => {
    const face = [];
    const dark = [];
    const outer = s * (tw / 2 - 0.012); // rim lip plane
    const hubX = s * (tw / 2 - 0.055); // hub is set back: the rim is dished
    dark.push(new THREE.CylinderGeometry(rimR, rimR, 0.01, 28).rotateZ(Math.PI / 2).translate(s * (tw / 2 - 0.13), 0, 0));
    face.push(new THREE.TorusGeometry(rimR - 0.008, 0.014, 4, 26).rotateY(Math.PI / 2).translate(outer, 0, 0));
    face.push(new THREE.CylinderGeometry(0.068, 0.072, 0.03, 18).rotateZ(Math.PI / 2).translate(hubX, 0, 0));
    dark.push(new THREE.CylinderGeometry(0.034, 0.034, 0.032, 14).rotateZ(Math.PI / 2).translate(hubX + s * 0.004, 0, 0));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const nut = new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6).rotateZ(Math.PI / 2);
      face.push(nut.translate(hubX + s * 0.018, Math.cos(a) * 0.048, Math.sin(a) * 0.048));
    }
    const yAxis = new THREE.Vector3(0, 1, 0);
    const spoke = (angle, width, thick = 0.022) => {
      const from = new THREE.Vector3(hubX, Math.cos(angle) * 0.06, Math.sin(angle) * 0.06);
      const to = new THREE.Vector3(outer - s * 0.004, Math.cos(angle) * (rimR - 0.018), Math.sin(angle) * (rimR - 0.018));
      const dir = new THREE.Vector3().subVectors(to, from);
      const g = new THREE.BoxGeometry(thick, dir.length(), width);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(yAxis, dir.clone().normalize()));
      face.push(g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2));
    };
    for (let k = 0; k < rim.n; k++) {
      const a = (k / rim.n) * Math.PI * 2;
      if (rim.style === 'split') { spoke(a - 0.075, 0.032); spoke(a + 0.075, 0.032); }
      else if (rim.style === 'twin') { spoke(a - 0.13, 0.042); spoke(a + 0.13, 0.042); }
      else if (rim.style === 'aero') spoke(a, r * 0.36, 0.02);
      else spoke(a, 0.034);
    }
    if (rim.style === 'aero') {
      // Turbine-style cover between the spokes.
      face.push(new THREE.CylinderGeometry(rimR - 0.02, rimR - 0.02, 0.008, 30).rotateZ(Math.PI / 2).translate(s * (tw / 2 - 0.035), 0, 0));
    }
    return { face: mergeGeometries(face.map(plain)), dark: mergeGeometries(dark.map(plain)) };
  };
  return { tire, farTire, [-1]: make(-1), 1: make(1), color: rim.color };
}

// ---------- assembly ----------
const discMat = new THREE.MeshStandardMaterial({ color: 0x8a8d92, metalness: 0.8, roughness: 0.45 });
const caliperMat = new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: 0.5, metalness: 0.3 });

export function makeCar(id, color) {
  const d = CAR_MODELS[id];
  if (d.kind === 'bike') return makeBike(id, color);
  const geos = buildShape(id);
  const car = new THREE.Group();
  // Vertex colours on the body darken the paint low down, in the wheel wells and on trim.
  const paint = new THREE.MeshPhysicalMaterial({
    color: color ?? d.color, roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, envMap, envMapIntensity: 0.7,
    vertexColors: true,
  });
  const tail = new THREE.MeshStandardMaterial({ color: 0x6a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0.6, roughness: 0.2 });
  const mats = {
    paint, tail, head: headMat, dark: darkMat, chrome: chromeMat, glass: glassMat, lens: lensMat,
    grille: grilleMat, plate: plateMat, badge: badgeMat, disc: discMat, caliper: caliperMat,
  };

  for (const g of geos.body) car.add(new THREE.Mesh(g, paint));
  for (const g of geos.glass) car.add(new THREE.Mesh(g, d.greenhouse === 'glass' ? glassMat : paint));
  for (const [key, g] of Object.entries(geos.parts)) car.add(new THREE.Mesh(g, mats[key]));

  const wheels = [];
  const rimMaterial = rimMatFor(geos.wheel.color);
  for (const axle of d.axles) {
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      const parts = geos.wheel[s];
      w.add(new THREE.Mesh(geos.wheel.tire, tireMat), new THREE.Mesh(parts.face, rimMaterial), new THREE.Mesh(parts.dark, darkMat));
      w.position.set(s * geos.fn.wheelX(axle), d.wheelR, -axle);
      car.add(w);
      wheels.push(w);
    }
  }

  const shadow = geos.shadow.clone();
  shadow.position.y = 0.03;
  car.add(shadow);

  car.rotation.order = 'YXZ';
  car.userData = { id, bodyMat: paint, tailMat: tail, wheels, len: d.len, width: d.width, wheelR: d.wheelR };
  return car;
}

// ---------- traffic ----------
// Traffic uses the same models drawn with far fewer meshes (each mesh is a draw call):
//  - one mesh per material; parts whose materials differ only in colour, roughness and
//    metalness share one, with those values in vertex colours and a tiny float texture
//    (so they come out exactly the same);
//  - tyres, brake discs and the wheels' dark backing look the same however far they have
//    turned, so they are static; only the rims (spokes, nuts) spin, both wheels of an axle
//    as one mesh;
//  - beyond LOD_FAR metres a simpler version takes over: a body with half the stations,
//    coarser tyres, grille and plate in their average colour, rims that don't spin.
// The player's car keeps full detail (makeCar).
export const LOD_FAR = 60; // m: switch to the far version beyond this...
export const LOD_NEAR = 50; // ...and back to full detail within this (no flicker in between)

const PALETTE = ['dark', 'disc', 'caliper', 'tire', 'head', 'grille', 'plate', 'chrome', 'lens', 'badge'];
const paletteSource = () => ({
  dark: darkMat, disc: discMat, caliper: caliperMat, tire: tireMat, head: headMat, grille: grilleMat, plate: plateMat,
  chrome: chromeMat, lens: lensMat, badge: badgeMat,
});
let palette = null;
function paletteMaterials() {
  if (palette) return palette;
  const n = PALETTE.length;
  const mr = new Float32Array(n * 4);
  const em = new Float32Array(n * 4);
  const src = paletteSource();
  PALETTE.forEach((k, i) => {
    const m = src[k];
    mr.set([0, m.roughness, m.metalness, 1], i * 4);
    em.set([m.emissive.r * m.emissiveIntensity, m.emissive.g * m.emissiveIntensity, m.emissive.b * m.emissiveIntensity, 1], i * 4);
  });
  const tex = (data) => {
    const t = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.FloatType);
    t.channel = 1;
    t.needsUpdate = true;
    return t;
  };
  const mrTex = tex(mr);
  palette = {
    // Dark trim, tyres, brake discs and calipers, head lights (far away: grille and plate too).
    plain: new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 1, roughnessMap: mrTex, metalnessMap: mrTex, emissive: 0xffffff, emissiveMap: tex(em),
    }),
    // Chrome, light lenses and badges, which reflect the same studio environment.
    shiny: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, roughnessMap: mrTex, metalnessMap: mrTex, envMap, envMapIntensity: 1 }),
  };
  return palette;
}

// Average colour of a canvas texture, in linear light (what it looks like from far away).
const averages = new Map();
function averageColor(tex) {
  if (averages.has(tex)) return averages.get(tex);
  averages.set(tex, averageOf(tex));
  return averages.get(tex);
}
function averageOf(tex) {
  const { width, height } = tex.image;
  const px = tex.image.getContext('2d').getImageData(0, 0, width, height).data;
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const sum = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += lin(px[i + k] / 255);
  const n = px.length / 4;
  return new THREE.Color(sum[0] / n, sum[1] / n, sum[2] / n);
}

// Only the listed attributes, not indexed (so geometries of any origin merge).
function only(g, names) {
  const p = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(p.attributes)) if (!names.includes(name)) p.deleteAttribute(name);
  if (!p.attributes.normal) p.computeVertexNormals();
  return p;
}
// A part for a palette material: its colour per vertex and its palette slot in uv1.
function paletteGeo(g, key, color) {
  const p = only(g, ['position', 'normal']);
  const n = p.attributes.position.count;
  const col = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const u = (PALETTE.indexOf(key) + 0.5) / PALETTE.length;
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
    uv[i * 2] = u;
    uv[i * 2 + 1] = 0.5;
  }
  p.setAttribute('color', new THREE.BufferAttribute(col, 3));
  p.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  return p;
}

const trafficCache = new Map();
function trafficGeos(id) {
  if (trafficCache.has(id)) return trafficCache.get(id);
  const d = CAR_MODELS[id];
  const geos = buildShape(id);
  const { parts, wheel: W, fn } = geos;
  const src = paletteSource();
  const wheels = d.axles.flatMap((axle) => [-1, 1].map((s) => ({ axle, s, x: s * fn.wheelX(axle) })));
  const at = (g, w) => g.clone().translate(w.x, d.wheelR, -w.axle);
  const glassLoft = d.greenhouse === 'glass';
  const paintOf = (body, glass) => mergeGeometries([...body, ...(glassLoft ? [] : glass), ...(parts.paint ? [parts.paint] : [])]
    .map((g) => only(g, ['position', 'normal', 'color'])));
  const merge = (list) => mergeGeometries(list.filter(Boolean));
  const pal = (key, g, color = src[key].color) => (g ? paletteGeo(g, key, color) : null);
  const wheelDark = wheels.map((w) => pal('dark', at(W[w.s].dark, w)));
  const out = {
    rimColor: W.color,
    paint: paintOf(geos.body, geos.glass),
    farPaint: paintOf(geos.farBody, geos.farGlass),
    tail: parts.tail,
    grille: parts.grille,
    plate: parts.plate,
    glass: merge([parts.glass, ...(glassLoft ? geos.glass : [])].map((g) => g && only(g, ['position', 'normal']))),
    shiny: merge(['chrome', 'lens', 'badge'].map((k) => pal(k, parts[k]))),
    plain: merge([
      pal('dark', parts.dark), ...wheelDark, pal('disc', parts.disc), pal('caliper', parts.caliper), pal('head', parts.head),
      ...wheels.map((w) => pal('tire', at(W.tire, w))),
    ]),
    farPlain: merge([
      pal('dark', parts.dark), ...wheelDark, pal('head', parts.head),
      pal('grille', parts.grille, averageColor(grilleTex)), pal('plate', parts.plate, averageColor(plateTex)),
      ...wheels.map((w) => pal('tire', at(W.farTire, w))),
    ]),
    // Both rims of an axle, around the axle's centre (they spin together).
    axles: d.axles.map((axle) => ({
      axle,
      geo: mergeGeometries([-1, 1].map((s) => W[s].face.clone().translate(s * fn.wheelX(axle), 0, 0))),
    })),
    farRims: mergeGeometries(wheels.map((w) => at(W[w.s].face, w))),
  };
  trafficCache.set(id, out);
  return out;
}

export function makeTrafficCar(id, color) {
  const d = CAR_MODELS[id];
  const t = trafficGeos(id);
  const pal = paletteMaterials();
  const paint = new THREE.MeshPhysicalMaterial({
    color: color ?? d.color, roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, envMap, envMapIntensity: 0.7,
    vertexColors: true,
  });
  const tail = new THREE.MeshStandardMaterial({ color: 0x6a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0.6, roughness: 0.2 });
  const rimMaterial = rimMatFor(t.rimColor);
  const mesh = (g, m) => new THREE.Mesh(g, m);
  const near = new THREE.Group();
  near.add(mesh(t.paint, paint), mesh(t.tail, tail), mesh(t.plain, pal.plain), mesh(t.shiny, pal.shiny), mesh(t.glass, glassMat));
  if (t.grille) near.add(mesh(t.grille, grilleMat));
  if (t.plate) near.add(mesh(t.plate, plateMat));
  const wheels = t.axles.map(({ axle, geo }) => {
    const g = new THREE.Group();
    g.position.set(0, d.wheelR, -axle);
    g.add(mesh(geo, rimMaterial));
    near.add(g);
    return g;
  });
  const far = new THREE.Group();
  far.add(mesh(t.farPaint, paint), mesh(t.tail, tail), mesh(t.farPlain, pal.plain), mesh(t.shiny, pal.shiny), mesh(t.glass, glassMat), mesh(t.farRims, rimMaterial));
  far.visible = false;
  const car = new THREE.Group();
  car.add(near, far);
  const shadow = buildShape(id).shadow.clone();
  shadow.position.y = 0.03;
  car.add(shadow);
  car.rotation.order = 'YXZ';
  car.userData = { id, bodyMat: paint, tailMat: tail, wheels, len: d.len, width: d.width, wheelR: d.wheelR, near, far };
  return car;
}

// Shows the full or the simpler version of a traffic car for its distance from the camera.
export function setTrafficDetail(car, distance) {
  const { near, far } = car.userData;
  const isFar = far.visible ? distance > LOD_NEAR : distance > LOD_FAR;
  far.visible = isFar;
  near.visible = !isFar;
}

// ---------- bikes ----------
// A cylinder between two points.
function tube(a, b, r, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 8), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

function bikeWheel(r, fat) {
  const w = new THREE.Group();
  w.add(new THREE.Mesh(new THREE.TorusGeometry(r - 0.03, fat ? 0.05 : 0.032, 8, 28).rotateY(Math.PI / 2), tireMat));
  w.add(new THREE.Mesh(new THREE.TorusGeometry(r - 0.07, 0.012, 6, 28).rotateY(Math.PI / 2), rimMat));
  for (let k = 0; k < 6; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.008, (r - 0.07) * 2, 0.008), rimMat);
    spoke.rotation.x = (k * Math.PI) / 6;
    w.add(spoke);
  }
  w.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 10).rotateZ(Math.PI / 2), darkMat));
  return w;
}

// A blocky rider in a helmet. Legs pump with the pedals.
export function makeRider(seat, bars) {
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b98a, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x3b6fd1, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2b2f45, roughness: 0.8 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0xff5a36, roughness: 0.4 });
  const rider = new THREE.Group();
  rider.position.copy(seat);
  const torso = new THREE.Group();
  torso.rotation.x = -0.55; // lean forward over the bars
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.24), shirt);
  body.position.y = 0.33;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), skin);
  head.position.y = 0.78;
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmet);
  lid.position.y = 0.86;
  torso.add(body, head, lid);
  // Arms reach from the shoulders to the handlebars.
  const shoulderY = 0.58;
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Vector3(s * 0.22, shoulderY, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.55);
    const hand = new THREE.Vector3(s * 0.24, bars.y - seat.y, bars.z - seat.z);
    rider.add(tube(shoulder, hand, 0.05, shirt));
  }
  rider.add(torso);
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.12, 0.02, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.62, 0.14), pants);
    leg.position.y = -0.3;
    hip.add(leg);
    rider.add(hip);
    return hip;
  });
  return { rider, legs };
}

function makeBike(id, color) {
  const d = CAR_MODELS[id];
  const bike = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: color ?? d.color, roughness: 0.3, metalness: 0.4, clearcoat: 1, envMap, envMapIntensity: 0.7 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.6 });
  const r = d.wheelR;
  const v = (y, z) => new THREE.Vector3(0, y, z);
  const rearHub = v(r, 0.56);
  const frontHub = v(r, -0.56);
  const crank = v(0.3, 0.06);
  const seat = v(0.92, 0.22);
  const headTop = v(0.95, -0.4);
  const headBottom = v(0.72, -0.45);
  const fat = d.electric;
  const R = fat ? 0.03 : 0.022;

  const wheels = [bikeWheel(r, fat), bikeWheel(r, fat)];
  wheels[0].position.copy(frontHub);
  wheels[1].position.copy(rearHub);
  bike.add(...wheels);
  bike.add(
    tube(crank, seat, R, paint), tube(crank, headBottom, fat ? 0.045 : R, paint), tube(seat, headTop, R, paint),
    tube(headTop, headBottom, R * 1.3, paint),
  );
  for (const s of [-1, 1]) {
    const off = new THREE.Vector3(s * 0.06, 0, 0);
    bike.add(
      tube(crank.clone().add(off), rearHub.clone().add(off), R * 0.8, paint),
      tube(seat.clone().add(off), rearHub.clone().add(off), R * 0.8, paint),
      tube(headBottom.clone().add(off), frontHub.clone().add(off), R * 0.9, paint),
    );
  }
  const bars = headTop.clone().add(v(0.1, 0.05));
  bike.add(tube(headTop, bars, R, darkMat));
  const handlebar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.035, 0.035), darkMat);
  handlebar.position.copy(bars);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.26), darkMat);
  saddle.position.copy(seat).add(v(0.03, 0));
  const rearLight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.03), tail);
  rearLight.position.copy(seat).add(v(-0.1, 0.06));
  bike.add(handlebar, saddle, rearLight);

  // Chainring with pedals that turn as you ride.
  const cranks = new THREE.Group();
  cranks.position.copy(crank);
  cranks.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 16).rotateZ(Math.PI / 2), rimMat));
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.17, 0.03), darkMat);
    arm.position.set(s * 0.09, s * 0.085, 0);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.06), darkMat);
    pedal.position.set(s * 0.13, s * 0.17, 0);
    cranks.add(arm, pedal);
  }
  bike.add(cranks);

  if (d.electric) {
    // Battery on the down tube, hub motor, headlight and a little display.
    const battery = tube(crank.clone().lerp(headBottom, 0.2), crank.clone().lerp(headBottom, 0.8), 0.06, darkMat);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 16).rotateZ(Math.PI / 2), darkMat);
    motor.position.copy(rearHub);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.05), headMat);
    lamp.position.copy(headTop).add(v(-0.02, -0.06));
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: 0x5fd4ff }));
    screen.position.copy(bars).add(v(0.04, 0.04));
    bike.add(battery, motor, lamp, screen);
  }

  const { rider, legs } = makeRider(seat.clone().add(v(0.06, 0)), bars);
  bike.add(rider);

  bike.add(softShadow(0.9, 2.2));

  let crankAngle = 0;
  bike.rotation.order = 'YXZ';
  bike.userData = {
    id, bodyMat: paint, tailMat: tail, wheels, len: d.len, width: d.width, wheelR: r, rider, lean: true,
    onSpin(distance) {
      crankAngle -= distance / (r * 2.2);
      cranks.rotation.x = crankAngle;
      legs[0].rotation.x = 0.3 + Math.sin(crankAngle) * 0.45;
      legs[1].rotation.x = 0.3 - Math.sin(crankAngle) * 0.45;
    },
  };
  bike.userData.onSpin(0);
  return bike;
}

// Roll the wheels for a given distance travelled.
export function spinWheels(car, distance) {
  const a = distance / car.userData.wheelR;
  for (const w of car.userData.wheels) w.rotation.x -= a;
  car.userData.onSpin?.(distance);
}
