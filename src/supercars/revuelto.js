// Lamborghini Revuelto (V12 plug-in hybrid flagship, 2024-2027 model years).
// lamborghini.com technical data: 4947 long, 2038 wide (2266 with mirrors), 1161 tall, 2779 wheelbase,
// 1720 / 1701 front / rear track, 265/35 ZRF20 front and 345/30 ZRF21 rear tyres.
// Shape measured from Lamborghini's own configurator renders (side, top, front, rear and 3/4 views,
// cameras fitted from the wheel hubs) and the lamborghini.com side cut-out: axles 1.321 m ahead of
// and 1.458 m behind the middle of the car.
import { rect } from './_shape.js';

// Elongated hexagon centred on (cx, cy), half-width w, half-height h.
const hex = (cx, cy, w, h) => [[cx + w, cy], [cx + w * 0.6, cy + h], [cx - w * 0.6, cy + h], [cx - w, cy], [cx - w * 0.6, cy - h], [cx + w * 0.6, cy - h]];

// Front and rear outlines are given for the car's right side (x > 0) and mirrored automatically.
export default {
  brand: 'Lamborghini', name: 'Revuelto', color: 0x8ccf2a, super: true,
  desc: 'V12 hybrid, scissor doors, 1001 hp. Wild.',
  len: 4.947, width: 2.038, wheelR: 0.347, tireW: 0.265, rearWheel: { r: 0.369, w: 0.345 },
  axles: [1.321, -1.458], round: 0.12, nose: 0.05, tail: 0.05, wrap: 0.62, sag: 0.008,
  mirror: { u: 0.75, y: 0.13, out: 0.32, mat: 'dark' },
  section: {
    shoulder: 0.55, belt: 0.09, tuck: 0.08, crease: 1.3, crown: -0.1, flare: 0.02, gap: 0.03, rocker: false,
    // Black carbon splitter, sills and the tall diffuser.
    sill: [[2.4735, 0.15], [2.33, 0.2], [2.2, 0.21], [2.0, 0.2], [1.8, 0.15], [1.6, 0.1], [0.9, 0.13], [-0.9, 0.14], [-1.0, 0.14], [-1.9, 0.33], [-2.2, 0.4], [-2.4735, 0.18]],
  },
  // Very low nose, straight hood up to the windshield; the belt rises behind the doors into the
  // rear haunches; blunt tail with the diffuser sticking out low down. `top` is the middle of the
  // car: the negative crown raises the fenders and haunches about 0.1 m above it.
  side: [
    [2.4735, 0.2, 0.4], [2.43, 0.17, 0.41], [2.4, 0.155, 0.415], [2.33, 0.135, 0.425], [2.24, 0.125, 0.445],
    [2.1, 0.123, 0.5], [1.95, 0.123, 0.56], [1.8, 0.123, 0.61], [1.65, 0.13, 0.655], [1.5, 0.13, 0.685],
    [1.4, 0.13, 0.7], [1.3, 0.13, 0.71], [1.1, 0.13, 0.69], [0.85, 0.128, 0.68], [0.4, 0.125, 0.69], [0.0, 0.125, 0.71],
    [-0.34, 0.12, 0.75], [-0.6, 0.115, 0.8], [-0.9, 0.114, 0.8], [-1.2, 0.12, 0.78], [-1.5, 0.13, 0.77],
    [-1.8, 0.135, 0.76], [-2.0, 0.16, 0.755], [-2.2, 0.2, 0.75], [-2.36, 0.26, 0.73], [-2.43, 0.4, 0.69],
    [-2.4735, 0.45, 0.63],
  ],
  // Plan from the configurator's top view: 2.0 m over the front arches, slimmer at the doors,
  // widest over the rear wheels, blunt tail.
  plan: [
    [2.4735, 0.24], [2.45, 0.27], [2.4, 0.33], [2.35, 0.4], [2.3, 0.472], [2.25, 0.547], [2.2, 0.616], [2.15, 0.689],
    [2.1, 0.77], [2.05, 0.823], [2.0, 0.86], [1.9, 0.9], [1.8, 0.933], [1.7, 0.964], [1.6, 0.99], [1.45, 1.0],
    [1.3, 0.999], [1.15, 0.99], [1.0, 0.974], [0.5, 0.965], [0.0, 0.966], [-0.2, 0.955], [-0.4, 0.973],
    [-0.6, 0.99], [-1.0, 0.992], [-1.25, 1.003], [-1.35, 1.018], [-1.75, 1.018], [-1.85, 0.986], [-2.0, 0.933],
    [-2.15, 0.879], [-2.2, 0.832], [-2.25, 0.74], [-2.3, 0.678], [-2.35, 0.562], [-2.4, 0.464], [-2.4735, 0.3],
  ],
  // One long canopy: the raked windshield, a short wide roof, then the engine cover sloping to the tail.
  cabin: [
    [1.3, 0.76, 0.8], [1.2, 0.85, 0.77], [1.0, 0.942, 0.7], [0.8, 1.012, 0.65], [0.6, 1.074, 0.61],
    [0.4, 1.127, 0.63], [0.2, 1.152, 0.64], [0.0, 1.161, 0.64], [-0.2, 1.157, 0.64], [-0.4, 1.142, 0.64],
    [-0.6, 1.121, 0.63], [-0.8, 1.098, 0.62], [-1.0, 1.077, 0.58], [-1.2, 1.053, 0.55], [-1.4, 1.029, 0.5],
    [-1.6, 1.006, 0.46], [-1.8, 0.972, 0.42], [-2.0, 0.948, 0.4], [-2.2, 0.914, 0.38], [-2.32, 0.892, 0.36], [-2.42, 0.84, 0.32],
  ],
  // Side glass with a raked rear edge, in a thick black frame; black A pillars.
  windows: { belt: 0.075, top: 0.12, bands: [{ u0: 0.85, u1: -0.34, k0: 0.82, k1: 2.0 }], kick: [[0.85, 0], [0.0, 0.02], [-0.34, 0.017]] },
  windshield: [1.22, 0.36], backlight: [-0.78, -2.12], glassFrame: true,
  rim: { n: 5, style: 'split', split: 0.17, spoke: 0.036, color: 0x1e2024, size: 0.73 },
  doors: [0.91, -0.19],
  stats: { top: 1.4, accel: 1.55, grip: 1.15 },
  details(c) {
    // Everything under the hood's big V is black: headlight lenses, intakes and the splitter.
    c.frontMid('dark', [[-0.86, 0.135], [0.86, 0.135], [0.86, 0.31], [-0.86, 0.31]], 0.01);
    c.front('dark', [[0.42, 0.3], [0.84, 0.3], [0.84, 0.63], [0.79, 0.63], [0.62, 0.53], [0.43, 0.44]], 0.01);
    c.frontMid('dark', [[-0.44, 0.3], [0.44, 0.3], [0.44, 0.44], [0.0, 0.345], [-0.44, 0.44]], 0.01);
    c.front('grille', [[0.51, 0.215], [0.78, 0.215], [0.79, 0.4], [0.51, 0.39]], 0.013);
    // Orange blades under the intakes, pointing in towards the middle.
    c.front('paint', [[0.375, 0.205], [0.82, 0.205], [0.835, 0.32], [0.86, 0.32], [0.86, 0.13], [0.48, 0.133]], 0.016);
    // Y headlights: dark lens under the hood corner with two hexagon lamps, the LED Y.
    c.front('lens', [[0.81, 0.615], [0.45, 0.43], [0.47, 0.45], [0.8, 0.455]], 0.013);
    c.front('head', hex(0.735, 0.555, 0.032, 0.022), 0.017);
    c.front('head', hex(0.66, 0.535, 0.03, 0.021), 0.017);
    c.front('head', [[0.794, 0.615], [0.808, 0.615], [0.82, 0.31], [0.806, 0.31]], 0.019);
    c.front('head', [[0.8, 0.452], [0.46, 0.437], [0.46, 0.425], [0.8, 0.438]], 0.019);
    // Rear: Y tail lights, twin hexagon exhausts high in the middle, the tall black diffuser.
    c.rear('dark', [[0.36, 0.84], [0.7, 0.84], [0.82, 0.885], [0.845, 0.86], [0.845, 0.76], [0.82, 0.74], [0.7, 0.785], [0.36, 0.785]], 0.01);
    c.rear('tail', [[0.36, 0.816], [0.7, 0.816], [0.7, 0.806], [0.36, 0.806]], 0.014);
    c.rear('tail', [[0.69, 0.816], [0.82, 0.872], [0.826, 0.864], [0.7, 0.808]], 0.014);
    c.rear('tail', [[0.69, 0.806], [0.82, 0.75], [0.826, 0.758], [0.7, 0.814]], 0.014);
    c.rearMid('dark', [[-0.27, 0.76], [0.27, 0.76], [0.3, 0.825], [0.27, 0.885], [-0.27, 0.885], [-0.3, 0.825]], 0.01);
    for (const s of [-1, 1]) {
      c.rearMid('chrome', hex(s * 0.135, 0.825, 0.105, 0.048), 0.014);
      c.rearMid('dark', hex(s * 0.135, 0.825, 0.09, 0.038), 0.017);
    }
    c.rearMid('dark', [[-0.95, 0.15], [0.95, 0.15], [0.95, 0.62], [0.4, 0.645], [-0.4, 0.645], [-0.95, 0.62]], 0.01);
    c.rear('tail', rect(0.55, 0.47, 0.85, 0.49), 0.014);
    c.plate(0.47);
    // Black carbon sills between the wheels.
    c.side('dark', [[0.93, 0.135], [0.93, 0.255], [0.2, 0.25], [-0.5, 0.26], [-1.04, 0.275], [-1.04, 0.13]], 0.006);
    // The big intake right behind the door, and the slot rising back above it.
    c.side('dark', [[-0.18, 0.68], [-0.42, 0.71], [-0.71, 0.41], [-0.53, 0.34], [-0.39, 0.37], [-0.31, 0.47]], 0.008);
    c.side('dark', [[-0.98, 0.87], [-0.93, 0.893], [-0.45, 0.758], [-0.42, 0.73], [-0.47, 0.73]], 0.008);
  },
};
