import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SUPERCARS } from './supercars.js';

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
// The Honda emblem w metres wide at height y: a chrome H on black inside a chrome frame that is
// wider at the top. `put` is a centred decal function (c.frontMid or c.rearMid).
const hondaBadge = (put, y, w, off = 0.016) => {
  const h = w * 0.78;
  const frame = (i) => [[-w / 2 + i, y + h / 2 - i], [w / 2 - i, y + h / 2 - i], [w * 0.42 - i, y - h / 2 + i], [-w * 0.42 + i, y - h / 2 + i]];
  put('chrome', frame(0), off);
  put('dark', frame(w * 0.07), off + 0.003);
  put('chrome', hondaH(0, y, (w * 0.56) / 0.11), off + 0.006);
};

export const CAR_MODELS = {
  modelx: {
    // The Model X as on tesla.com/en_ca in Oct 2026 (now out of production, ending with a Signature
    // Edition; the 2021 refresh body with the latest bumper). Official sizes (Model X owner's manual): 5,057 long, 1,999 wide
    // (2,271 with mirrors), 1,680 tall, wheelbase 2,965, overhangs 988 / 1,104, track 1,705 / 1,710,
    // ground clearance 166; standard 20" wheels, 265/45R20 front and 275/45R20 rear. The side, roof and
    // window lines below were measured off Tesla's own configurator renders.
    brand: 'Tesla', name: 'Model X', color: 0xf2f2f0, desc: 'Falcon-wing family rocket. Heavy.', heavy: true,
    len: 5.057, width: 2.0, wheelR: 0.375, tireW: 0.27, axles: [1.5405, -1.4245], round: 0.16, nose: 0.24, tail: 0.15,
    // Black sill between the wheels and black lower rear bumper; a thin black lip at the front.
    section: {
      shoulder: 0.55, belt: 0.06, tuck: 0.085, crease: 2.0, crown: 0.07, gap: 0.065, rocker: false, faceFade: true,
      sill: [[2.5285, 0], [2.3, 0], [2.15, 0.035], [1.95, 0.15], [-1.9, 0.15], [-2.1, 0.17], [-2.32, 0.15], [-2.5285, 0]],
    },
    // Long, domed hood that meets the windshield just behind the front wheel; tall, flat tail.
    side: [[2.5285, 0.27, 0.76], [2.45, 0.2, 0.8], [2.37, 0.18, 0.85], [2.26, 0.17, 0.89], [2.15, 0.165, 0.935], [2.03, 0.163, 0.98], [1.87, 0.162, 1.02], [1.66, 0.162, 1.048], [1.46, 0.162, 1.06], [1.3, 0.162, 1.06],
      [1.16, 0.162, 1.06], [0.84, 0.162, 1.077], [0.44, 0.162, 1.093], [0.03, 0.162, 1.117], [-0.37, 0.162, 1.133], [-0.78, 0.162, 1.15], [-1.18, 0.162, 1.182], [-1.59, 0.164, 1.226],
      [-1.9, 0.17, 1.26], [-2.1, 0.2, 1.272], [-2.28, 0.23, 1.278], [-2.42, 0.26, 1.24], [-2.5285, 0.31, 1.19]],
    plan: [[2.5285, 0.74], [2.4, 0.88], [2.15, 0.96], [1.8, 0.995], [1.54, 1.0], [-1.42, 1.0], [-1.9, 0.99], [-2.2, 0.95], [-2.4, 0.88], [-2.5285, 0.76]],
    // One long arc from the windshield base to the hatch, peaking over the second row.
    cabin: [[1.3, 1.11, 0.86], [1.0, 1.285, 0.8], [0.6, 1.478, 0.74], [0.2, 1.61, 0.71], [-0.5, 1.678, 0.69], [-1.0, 1.657, 0.69], [-1.5, 1.574, 0.7], [-1.9, 1.46, 0.72], [-2.15, 1.36, 0.74], [-2.28, 1.31, 0.75]],
    // The panoramic windshield sweeps right up over the front seats; behind it the roof is the
    // painted skin of the falcon-wing doors. One long run of side glass (gloss-black B pillar) that
    // rises to a sharp point under the hatch; black frit round the windshield (black A pillars).
    windows: { belt: -0.05, top: 0.1, bands: [{ u0: 1.16, u1: -1.88, k0: 0.59, k1: 0.31 }], pillars: [-0.255], kick: [[-1.62, 0], [-1.88, 0.085]] },
    windshield: [1.28, -0.28], backlight: [-1.55, -2.22], glassFrame: true,
    mirror: { u: 0.73, y: -0.03, out: 0.13 },
    rim: { n: 5, style: 'split', color: 0x34373b },
    doors: [1.0, -0.2, -1.42],
    stats: { top: 1.05, accel: 1.3, grip: 0.95 },
    details(c) {
      // Grille-less nose (traced from Tesla's renders): slim headlights that sweep back along the
      // fenders, joined by a black brow bar that carries the "T" and dips to a point under it.
      c.front('lens', [[0.637, 0.764], [0.745, 0.806], [0.841, 0.835], [0.886, 0.855], [0.936, 0.863], [0.946, 0.825], [0.952, 0.78], [0.946, 0.738], [0.912, 0.728], [0.837, 0.729], [0.748, 0.74]], 0.012, 0.7);
      // LED running light along the lower edge, curling up at the outer end.
      c.front('head', [[0.64, 0.765], [0.75, 0.744], [0.84, 0.733], [0.91, 0.732], [0.944, 0.742], [0.951, 0.785], [0.948, 0.8], [0.938, 0.79], [0.932, 0.752], [0.905, 0.745], [0.84, 0.746], [0.75, 0.757], [0.66, 0.772]], 0.018, 0.7);
      c.frontMid('dark', [[-0.56, 0.69], [-0.5, 0.715], [-0.3, 0.742], [0, 0.748], [0.3, 0.742], [0.5, 0.715], [0.56, 0.69], [0.45, 0.694], [0.2, 0.7], [0.055, 0.7], [0, 0.645], [-0.055, 0.7], [-0.2, 0.7], [-0.45, 0.694]], 0.014);
      c.front('dark', [[0.55, 0.69], [0.64, 0.758], [0.633, 0.766], [0.54, 0.697]], 0.014, 0.4);
      c.frontMid('chrome', [[-0.055, 0.742], [0.055, 0.742], [0.055, 0.727], [0.011, 0.727], [0.011, 0.672], [-0.011, 0.672], [-0.011, 0.727], [-0.055, 0.727]], 0.018);
      // Air-curtain slot at each corner with its curved outer edge, and the wide black lower intake.
      c.front('dark', [[0.667, 0.512], [0.804, 0.538], [0.912, 0.554], [0.945, 0.558], [0.943, 0.533], [0.912, 0.529], [0.804, 0.515]], 0.012, 0.45);
      // (The current bumper's hook at the slot's outer end is short: it stops halfway down.)
      c.front('dark', [[0.93, 0.535], [0.92, 0.47], [0.9, 0.41], [0.895, 0.412], [0.915, 0.47], [0.926, 0.535]], 0.012, 0.45);
      c.frontMid('grille', [[-0.61, 0.425], [0.61, 0.425], [0.7, 0.33], [0.66, 0.305], [-0.66, 0.305], [-0.7, 0.33]]);
      // Rear: smoked lamps that run from the rear fenders onto the hatch, with the red C-shaped
      // light guide, joined by a black bar carrying the TESLA letters.
      c.rear('lens', [[0.967, 0.93], [0.942, 0.997], [0.91, 1.047], [0.872, 1.06], [0.684, 1.057], [0.633, 1.022], [0.609, 0.948], [0.839, 0.899], [0.933, 0.9], [0.96, 0.914]], 0.012, 0.55);
      c.rear('tail', [[0.93, 1.005], [0.905, 1.042], [0.87, 1.053], [0.69, 1.05], [0.642, 1.02], [0.62, 0.955], [0.8, 0.912], [0.8, 0.935], [0.66, 0.965], [0.672, 1.012], [0.7, 1.03], [0.865, 1.032], [0.9, 1.022], [0.925, 0.99]], 0.016, 0.55);
      c.rear('tail', [[0.962, 0.952], [0.93, 0.957], [0.934, 0.93], [0.964, 0.928]], 0.016, 0.55);
      c.rearMid('dark', [[-0.63, 1.012], [-0.44, 1.018], [0, 1.027], [0.44, 1.018], [0.63, 1.012], [0.607, 0.966], [0.46, 0.979], [0, 0.987], [-0.46, 0.979], [-0.607, 0.966]]);
      for (let k = -2; k <= 2; k++) c.rearMid('chrome', rect(k * 0.11 - 0.024, 0.997, k * 0.11 + 0.024, 1.015), 0.016);
      // Hatch shut line round the plate recess, black diffuser with red reflectors.
      const thin = (pts, w = 0.007) => [...pts.map(([x, y]) => [x + w, y + w]), ...[...pts].reverse().map(([x, y]) => [x - w, y - w])];
      c.rear('dark', thin([[0.7, 0.9], [0.705, 0.765], [0.68, 0.722], [0.6, 0.714], [0.002, 0.711]], 0.004), 0.013);
      c.plate(0.885);
      c.rearMid('dark', [[-0.92, 0.53], [-0.7, 0.54], [0, 0.535], [0.7, 0.54], [0.92, 0.53], [0.9, 0.37], [0.69, 0.36], [0, 0.35], [-0.69, 0.36], [-0.9, 0.37]], 0.012, 0.5);
      c.rear('tail', [[0.508, 0.491], [0.782, 0.507], [0.777, 0.467], [0.506, 0.45]], 0.016);
      // Small lip spoiler at the top of the hatch.
      c.box('paint', 0, 1.315, 2.33, 1.2, 0.025, 0.12);
    },
  },
  crv: {
    // 2026 CR-V (6th generation, same body since 2023), Touring Hybrid / Sport Touring look.
    // Honda Canada spec sheet: 4695 long, 1867 wide (73.5 in, mirrors excluded), 1690 tall,
    // 2700 wheelbase, 235/55 R19. Shape measured from honda.ca's 360-degree photos.
    brand: 'Honda', name: 'CR-V', color: 0x2e4a6b, desc: 'Comfy, sensible, secretly quick',
    len: 4.695, width: 1.867, wheelR: 0.365, tireW: 0.235, axles: [1.35, -1.35], round: 0.15, cladding: true, fin: -1.6,
    nose: 0.07, tail: 0.06, wrap: 0.55, sag: 0.008, mirror: { mat: 'dark', dx: 0.05, dy: -0.045 },
    section: { shoulder: 0.45, belt: 0.04, tuck: 0.03, crease: 1.5, crown: 0.025, flare: 0.012, gap: 0.085 },
    side: [
      [2.3475, 0.36, 0.6], [2.32, 0.33, 0.9], [2.25, 0.29, 0.955], [2.15, 0.28, 1.012], [2.0, 0.277, 1.055], [1.8, 0.27, 1.086],
      [1.5, 0.26, 1.127], [1.2, 0.25, 1.15], [1.05, 0.25, 1.15], [0.84, 0.248, 1.12], [0.4, 0.246, 1.145], [-0.66, 0.246, 1.19],
      [-1.3, 0.26, 1.23], [-1.67, 0.29, 1.265], [-2.0, 0.316, 1.2], [-2.2, 0.36, 1.15], [-2.3, 0.4, 1.13], [-2.3475, 0.5, 1.0],
    ],
    // Plan from a visual hull of the 36 photos: the nose and tail round off strongly.
    plan: [
      [2.3475, 0.34], [2.3, 0.47], [2.25, 0.59], [2.2, 0.66], [2.15, 0.715], [2.1, 0.77], [2.05, 0.82], [2.0, 0.855], [1.9, 0.89],
      [1.8, 0.915], [1.65, 0.93], [1.5, 0.9335], [-1.5, 0.9335], [-1.65, 0.925], [-1.8, 0.905], [-1.9, 0.88], [-2.0, 0.855],
      [-2.1, 0.82], [-2.2, 0.775], [-2.25, 0.725], [-2.3, 0.62], [-2.3475, 0.4],
    ],
    cabin: [
      [1.07, 1.16, 0.72], [0.9, 1.27, 0.7], [0.7, 1.39, 0.67], [0.5, 1.5, 0.635], [0.4, 1.545, 0.62], [0.3, 1.58, 0.605], [0.2, 1.61, 0.595],
      [0.0, 1.645, 0.585], [-0.4, 1.66, 0.585], [-0.9, 1.66, 0.585], [-1.3, 1.65, 0.585], [-1.6, 1.64, 0.59], [-1.95, 1.62, 0.6],
      [-1.98, 1.575, 0.605], [-2.03, 1.485, 0.62], [-2.13, 1.375, 0.65], [-2.23, 1.27, 0.69], [-2.29, 1.19, 0.72],
    ],
    // Chrome-trimmed glass, black B and C pillars; the window line rises gently to a point at the body-coloured D pillar.
    windows: { belt: 0.025, top: 0.1, trim: true, bands: [{ u0: 0.84, u1: -1.67, k0: 0.72, k1: 1.3 }], pillars: [-0.29, -1.15] },
    windshield: [1.04, 0.22], backlight: [-2.03, -2.26],
    rim: { n: 5, style: 'twin', color: 0x141517, size: 0.68 },
    doors: [0.88, -0.24, -1.31], handles: [-0.07, -1.09],
    stats: { top: 0.92, accel: 0.95, grip: 1.0 },
    details(c) {
      // Big hexagonal grille under the straight hood edge, the Honda emblem high up in it.
      c.frontMid('dark', [[-0.47, 0.905], [0.47, 0.905], [0.555, 0.765], [0.45, 0.575], [-0.45, 0.575], [-0.555, 0.765]], 0.01);
      c.frontMid('grille', [[-0.45, 0.89], [0.45, 0.89], [0.53, 0.765], [0.43, 0.592], [-0.43, 0.592], [-0.53, 0.765]], 0.014);
      hondaBadge(c.frontMid, 0.79, 0.16, 0.018);
      // Slim headlights along the hood edge, from the grille corners round onto the fenders; LED strip on top.
      c.front('lens', [[0.46, 0.905], [0.78, 0.98], [0.865, 0.975], [0.87, 0.93], [0.82, 0.905], [0.53, 0.8], [0.47, 0.875]]);
      c.front('chrome', [[0.5, 0.882], [0.78, 0.953], [0.855, 0.95], [0.85, 0.928], [0.78, 0.93], [0.52, 0.857]], 0.015);
      c.front('head', [[0.47, 0.906], [0.78, 0.984], [0.865, 0.979], [0.865, 0.966], [0.78, 0.97], [0.48, 0.892]], 0.018);
      // Black lower bumper: honeycomb intake between silver corner frames, vents at the corners, silver skid strip.
      c.front('dark', [[0, 0.505], [0.42, 0.505], [0.7, 0.525], [0.73, 0.585], [0.79, 0.575], [0.82, 0.45], [0.83, 0.31], [0, 0.31]], 0.01);
      c.frontMid('grille', [[-0.42, 0.5], [0.42, 0.5], [0.44, 0.34], [-0.44, 0.34]], 0.014);
      c.front('chrome', [[0.415, 0.49], [0.575, 0.49], [0.625, 0.42], [0.59, 0.325], [0.45, 0.325], [0.405, 0.42]], 0.016);
      c.front('dark', [[0.44, 0.47], [0.56, 0.47], [0.6, 0.42], [0.57, 0.345], [0.465, 0.345], [0.43, 0.42]], 0.019);
      c.frontMid('chrome', rect(-0.6, 0.315, 0.6, 0.33), 0.016);
      // Tall thin tail lights up the D pillars, turning in along the tailgate below the glass.
      c.rear('tail', [[0.575, 1.47], [0.61, 1.47], [0.81, 1.13], [0.75, 1.12]]);
      c.rear('tail', [[0.37, 1.055], [0.82, 1.03], [0.872, 1.04], [0.872, 1.1], [0.81, 1.13], [0.66, 1.11], [0.37, 1.1]]);
      hondaBadge(c.rearMid, 1.15, 0.1);
      c.plate(0.975);
      // Black lower bumper with red reflectors and twin silver exhaust finishers.
      c.rear('dark', [[0, 0.66], [0.7, 0.66], [0.79, 0.6], [0.83, 0.5], [0.835, 0.47], [0, 0.47]], 0.01);
      c.rear('tail', rect(0.46, 0.57, 0.66, 0.59), 0.014);
      c.rear('chrome', [[0.47, 0.45], [0.7, 0.45], [0.685, 0.385], [0.485, 0.385]], 0.014);
      c.rear('dark', [[0.49, 0.44], [0.68, 0.44], [0.668, 0.395], [0.502, 0.395]], 0.017);
      // Low black roof rails and the roof spoiler over the tailgate glass.
      for (const s of [-1, 1]) {
        for (const [u0, u1, y] of [[0.15, -0.4, 1.655], [-0.4, -1.2, 1.668], [-1.2, -1.78, 1.655]]) c.box('dark', s * 0.5, y, -(u0 + u1) / 2, 0.04, 0.026, u0 - u1);
      }
      c.box('paint', 0, 1.58, 1.98, 1.12, 0.04, 0.16);
    },
  },
  accord: {
    // 2026 Accord (11th generation, same body since 2023), Touring Hybrid look.
    // Honda Canada spec sheet: 4971 long, 1862 wide, 1449 tall, 2830 wheelbase, 235/40 R19.
    // Shape measured from honda.ca's 360-degree photos.
    brand: 'Honda', name: 'Accord', color: 0x8f1d21, desc: 'Smooth fastback, quietly quick',
    len: 4.971, width: 1.862, wheelR: 0.335, tireW: 0.235, axles: [1.47, -1.36], round: 0.16, fin: -1.1,
    nose: 0.09, tail: 0.09, wrap: 0.62, sag: 0.008, mirror: { dx: 0.08, dy: -0.05 },
    section: { shoulder: 0.62, belt: 0.06, tuck: 0.07, crease: 1.25, crown: 0.03, gap: 0.055 },
    side: [
      [2.4855, 0.3, 0.62], [2.44, 0.275, 0.72], [2.4, 0.268, 0.768], [2.3, 0.25, 0.814], [2.2, 0.235, 0.851], [2.0, 0.215, 0.899],
      [1.8, 0.2, 0.931], [1.5, 0.19, 0.966], [1.2, 0.19, 0.989], [1.07, 0.19, 0.993], [0.83, 0.19, 0.968], [0.0, 0.19, 1.01],
      [-0.8, 0.19, 1.025], [-1.3, 0.2, 1.028], [-1.55, 0.21, 1.075], [-1.8, 0.23, 1.085], [-1.98, 0.25, 1.085],
      [-2.1, 0.27, 1.067], [-2.2, 0.28, 1.048], [-2.3, 0.3, 1.03], [-2.4, 0.33, 1.021], [-2.4855, 0.38, 0.8],
    ],
    // Plan from a visual hull of the 36 photos.
    plan: [
      [2.4855, 0.36], [2.45, 0.4], [2.4, 0.52], [2.35, 0.6], [2.3, 0.665], [2.2, 0.77], [2.1, 0.83], [2.0, 0.865], [1.9, 0.895],
      [1.8, 0.92], [1.6, 0.931], [-1.6, 0.931], [-1.8, 0.905], [-2.0, 0.875], [-2.1, 0.84], [-2.2, 0.81], [-2.3, 0.77], [-2.35, 0.72],
      [-2.4, 0.66], [-2.4855, 0.5],
    ],
    cabin: [
      [1.07, 1.0, 0.74], [0.9, 1.06, 0.72], [0.7, 1.18, 0.68], [0.5, 1.31, 0.645], [0.3, 1.384, 0.615], [0.1, 1.425, 0.595],
      [-0.3, 1.449, 0.585], [-0.7, 1.433, 0.59], [-1.0, 1.398, 0.6], [-1.2, 1.361, 0.615], [-1.4, 1.301, 0.64], [-1.6, 1.232, 0.67],
      [-1.8, 1.159, 0.72], [-1.98, 1.09, 0.78],
    ],
    // Long glass house with chrome trim; small quarter glass ending in a point in the fastback C pillar.
    windows: { belt: 0.0, top: 0.11, trim: true, bands: [{ u0: 0.83, u1: -1.54, k0: 0.8, k1: 0.33 }], pillars: [-0.18, -0.28, -1.1], kick: [[-1.3, 0], [-1.54, 0.03]] },
    windshield: [1.04, 0.28], backlight: [-0.95, -1.95],
    rim: { n: 10, style: 'split', split: 0.1, spoke: 0.02, color: 0xc2c6cc, size: 0.745, lip: 'dark' },
    doors: [0.98, -0.19, -1.25], handles: [-0.01, -1.0],
    stats: { top: 1.0, accel: 1.0, grip: 1.1 },
    details(c) {
      // Wide hexagonal grille with chrome-edged points at the sides, big Honda emblem.
      c.frontMid('grille', [[-0.375, 0.765], [0.375, 0.765], [0.5, 0.637], [0.406, 0.544], [-0.406, 0.544], [-0.5, 0.637]], 0.014);
      c.front('chrome', [[0.375, 0.774], [0.395, 0.774], [0.52, 0.637], [0.418, 0.536], [0.398, 0.536], [0.5, 0.637]], 0.016);
      hondaBadge(c.frontMid, 0.672, 0.14, 0.018);
      // Slim headlights from the grille corners round onto the fenders, LED strip along the top.
      c.front('lens', [[0.44, 0.768], [0.86, 0.81], [0.875, 0.8], [0.878, 0.76], [0.865, 0.722], [0.51, 0.683], [0.47, 0.72]]);
      c.front('chrome', [[0.49, 0.75], [0.85, 0.789], [0.864, 0.772], [0.85, 0.757], [0.5, 0.724]], 0.015);
      c.front('head', [[0.45, 0.772], [0.86, 0.813], [0.874, 0.805], [0.874, 0.792], [0.86, 0.799], [0.455, 0.757]], 0.018);
      // Black lower grille across the bumper, chrome C-shaped trims round the corner vents.
      c.frontMid('dark', [[-0.7, 0.435], [0.7, 0.435], [0.73, 0.295], [-0.73, 0.295]], 0.01);
      c.frontMid('grille', [[-0.6, 0.415], [0.6, 0.415], [0.62, 0.31], [-0.62, 0.31]], 0.014);
      c.front('chrome', [[0.635, 0.448], [0.77, 0.448], [0.782, 0.432], [0.74, 0.3], [0.655, 0.3], [0.655, 0.318], [0.72, 0.318], [0.755, 0.432], [0.635, 0.432]], 0.016);
      // Smoked band across the trunk lid joining the slim tail lights, a thin red light line inside it.
      c.rearMid('dark', rect(-0.64, 0.871, 0.64, 0.954), 0.01);
      c.rearMid('tail', rect(-0.62, 0.928, 0.62, 0.94), 0.013);
      c.rear('tail', [[0.6, 0.955], [0.8, 0.955], [0.85, 0.93], [0.85, 0.82], [0.7, 0.807], [0.635, 0.807], [0.44, 0.895], [0.6, 0.9]], 0.016);
      c.rear('lens', [[0.64, 0.905], [0.835, 0.905], [0.835, 0.827], [0.7, 0.817], [0.645, 0.817], [0.5, 0.89]], 0.019);
      c.rear('tail', rect(0.66, 0.856, 0.83, 0.865), 0.022);
      hondaBadge(c.rearMid, 0.914, 0.075, 0.019);
      c.plate(0.76);
      // Black diffuser with a chrome strip, red reflectors low on the bumper.
      c.rearMid('dark', [[-0.82, 0.41], [0.82, 0.41], [0.8, 0.35], [-0.8, 0.35]], 0.01);
      c.rearMid('chrome', rect(-0.43, 0.375, 0.43, 0.39), 0.014);
      c.rear('tail', rect(0.66, 0.55, 0.78, 0.565), 0.014);
    },
  },
  is300: {
    brand: 'Lexus', name: 'IS 300', color: 0x3567b5, desc: 'Spindle grille, sharp handling',
    // 2027 Lexus IS as shown on lexus.ca (Oct 2026). Canada now sells it only as the IS 350 AWD, on
    // the IS 300's body: 4720 long, 1839 wide, 1440 tall, wheelbase 2800, track 1580/1605, 235/40R19.
    // Shaped on Lexus Canada's studio photos of the 2026+ facelift.
    len: 4.72, width: 1.84, wheelR: 0.335, tireW: 0.235, axles: [1.48, -1.32], round: 0.13, fin: -1.09, nose: 0.1, tail: 0.1,
    section: { shoulder: 0.62, belt: 0.075, tuck: 0.08, crease: 1.2, crown: 0.03, flare: 0.012, gap: 0.035, rocker: false },
    side: [
      [2.36, 0.2, 0.42], [2.33, 0.195, 0.55], [2.29, 0.19, 0.645], [2.19, 0.19, 0.725], [2.05, 0.19, 0.805], [1.82, 0.19, 0.89], [1.64, 0.19, 0.932],
      [1.37, 0.19, 0.975], [1.0, 0.19, 1.008], [0.8, 0.19, 0.955], [0.4, 0.19, 0.968], [-0.3, 0.19, 0.992], [-1.0, 0.19, 1.006],
      [-1.3, 0.195, 1.02], [-1.6, 0.2, 1.04], [-1.9, 0.21, 1.06], [-2.1, 0.22, 1.04], [-2.25, 0.24, 1.02], [-2.28, 0.25, 0.95], [-2.31, 0.26, 0.78], [-2.36, 0.3, 0.62],
    ],
    plan: [[2.36, 0.4], [2.3, 0.6], [2.2, 0.74], [2.05, 0.84], [1.9, 0.89], [1.6, 0.915], [1.2, 0.912], [0.5, 0.895], [-0.4, 0.895], [-1.0, 0.91], [-1.4, 0.92], [-1.85, 0.905], [-2.05, 0.87], [-2.15, 0.83], [-2.25, 0.74], [-2.32, 0.56], [-2.36, 0.42]],
    cabin: [
      [0.95, 1.0, 0.69], [0.77, 1.1, 0.655], [0.57, 1.205, 0.63], [0.37, 1.303, 0.61], [0.17, 1.371, 0.595], [-0.13, 1.415, 0.585], [-0.5, 1.425, 0.58],
      [-0.83, 1.405, 0.58], [-1.03, 1.374, 0.585], [-1.23, 1.312, 0.595], [-1.43, 1.235, 0.61], [-1.63, 1.155, 0.63], [-1.83, 1.078, 0.655], [-1.92, 1.06, 0.665],
    ],
    // The window line rises to the back and ends in the IS's sharp rear point; a thin bar splits off
    // the rear door's fixed pane. The 2027 frames are gloss black, not chrome.
    windows: {
      belt: 0.012, top: 0.075, bands: [{ u0: 0.81, u1: -1.28, k0: 0.55, k1: 0.44 }], pillars: [-0.26], kick: [[-1.14, 0], [-1.19, 0.008], [-1.28, 0.13]],
      extra: [{ u0: -0.958, u1: -0.982, k0: 40, k1: 40, mat: 'dark', off: 0.016 }],
    },
    windshield: [0.93, -0.05], backlight: [-1.05, -1.86],
    rim: { n: 10, style: 'split', color: 0x8c939b },
    doors: [0.92, -0.225, -1.0], handles: [-0.05, -1.03],
    wrap: 0.45, mirror: { u: 0.57, mat: 'dark' },
    stats: { top: 1.12, accel: 1.1, grip: 1.2 },
    details(c) {
      // Front, 2026+ facelift: the L badge sits on a body-colour nose panel above a black slot and
      // the big mesh spindle grille; slim blade headlights with a running-light line that hooks down
      // at the inner end; black mesh fangs in the bumper corners and a black splitter.
      const grille = [[0.42, 0.612], [0.4, 0.545], [0.5, 0.485], [0.57, 0.42], [0.595, 0.33], [0.565, 0.25], [0.52, 0.24]];
      c.frontMid('grille', [...grille, ...grille.slice().reverse().map(([x, y]) => [-x, y])], 0.014);
      c.frontMid('dark', [[-0.43, 0.606], [0.43, 0.606], [0.41, 0.632], [-0.41, 0.632]], 0.016);
      c.frontMid('dark', [[-0.44, 0.694], [0.44, 0.694], [0.45, 0.688], [-0.45, 0.688]], 0.013);
      c.frontMid('chrome', ellipse(0, 0.668, 0.05, 0.023, 10), 0.02);
      c.frontMid('paint', ellipse(0, 0.668, 0.04, 0.016, 10), 0.022);
      c.front('lens', [[0.405, 0.615], [0.44, 0.655], [0.675, 0.697], [0.85, 0.736], [0.78, 0.675], [0.735, 0.632], [0.69, 0.61], [0.49, 0.6]]);
      c.front('head', [[0.425, 0.614], [0.43, 0.632], [0.62, 0.673], [0.78, 0.712], [0.78, 0.703], [0.62, 0.664], [0.45, 0.626], [0.44, 0.612]], 0.018);
      c.front('grille', [[0.72, 0.3], [0.775, 0.475], [0.84, 0.4], [0.84, 0.27], [0.78, 0.27]], 0.014);
      c.box('dark', 0, 0.2, -2.29, 1.0, 0.03, 0.12);
      // Headlights and mesh fangs wrap round onto the front fenders.
      c.side('lens', [[1.82, 0.738], [1.95, 0.728], [2.05, 0.712], [2.12, 0.695], [2.2, 0.68], [2.2, 0.62], [2.1, 0.615], [2.05, 0.635], [2.0, 0.672], [1.92, 0.712]]);
      c.side('head', [[1.84, 0.736], [1.95, 0.727], [2.05, 0.711], [2.12, 0.694], [2.12, 0.686], [2.05, 0.702], [1.95, 0.719]], 0.009);
      c.side('dark', [[1.9, 0.2], [2.05, 0.215], [2.25, 0.25], [2.27, 0.2], [2.0, 0.19]]);
      // The IS's sculpted flank: a long concave teardrop over both doors, pointed at the rear wheel,
      // under the bright haunch (split at the door line so the shut line stays visible).
      c.side('paint', [[-0.235, 0.85], [-0.317, 0.846], [-0.55, 0.819], [-0.736, 0.763], [-0.876, 0.67], [-0.946, 0.492], [-0.853, 0.437], [-0.69, 0.381], [-0.457, 0.32], [-0.235, 0.276]], 0.003, 0.84);
      c.side('paint', [[-0.215, 0.856], [0.009, 0.865], [0.381, 0.87], [0.753, 0.865], [0.9, 0.857], [0.912, 0.67], [0.9, 0.44], [0.846, 0.255], [0.613, 0.245], [0.194, 0.254], [-0.178, 0.281], [-0.215, 0.274]], 0.003, 0.84);
      // Rear: one light bar right across the trunk, swelling into blade-shaped corner lamps that run
      // forward along the rear fenders; LEXUS lettering above; black lower bumper, twin round pipes.
      // Smoked lamp housings with the red light strips inside them.
      c.rear('dark', [[0, 0.878], [0.5, 0.89], [0.72, 0.895], [0.75, 0.875], [0.735, 0.8], [0.711, 0.768], [0.62, 0.8], [0.555, 0.835], [0.4, 0.856], [0, 0.862]]);
      c.rear('tail', [[0, 0.871], [0.4, 0.866], [0.555, 0.845], [0.69, 0.79], [0.745, 0.87], [0.752, 0.86], [0.716, 0.775], [0.62, 0.808], [0.555, 0.836], [0.4, 0.857], [0, 0.863]], 0.016);
      c.side('dark', [[-2.19, 0.89], [-2.0, 0.887], [-1.85, 0.882], [-1.76, 0.877], [-1.85, 0.857], [-1.95, 0.846], [-2.05, 0.83], [-2.08, 0.8], [-2.09, 0.758], [-2.13, 0.81], [-2.18, 0.85]]);
      c.side('tail', [[-2.17, 0.876], [-1.88, 0.872], [-1.88, 0.864], [-2.05, 0.852], [-2.17, 0.858]], 0.01);
      for (const x of [-0.19, -0.095, 0, 0.095, 0.19]) c.rearMid('chrome', rect(x - 0.017, 0.943, x + 0.017, 0.961), 0.014);
      c.rear('dark', [[0.552, 0.85], [0.56, 0.85], [0.56, 0.7], [0.53, 0.665], [0.52, 0.672], [0.552, 0.704]], 0.013);
      c.rearMid('dark', rect(-0.52, 0.66, 0.52, 0.666), 0.013);
      c.rearMid('dark', [[-0.55, 0.545], [0.55, 0.545], [0.66, 0.525], [0.69, 0.48], [0.665, 0.36], [0.63, 0.29], [-0.63, 0.29], [-0.665, 0.36], [-0.69, 0.48], [-0.66, 0.525]]);
      c.rear('dark', [[0.63, 0.29], [0.66, 0.31], [0.8, 0.31], [0.82, 0.28], [0.63, 0.27]]);
      c.rearMid('lens', rect(-0.58, 0.4, 0.58, 0.42), 0.016);
      c.rear('tail', [[0.615, 0.4], [0.64, 0.4], [0.665, 0.52], [0.64, 0.52]], 0.015);
      c.side('dark', [[-2.34, 0.54], [-2.25, 0.46], [-2.1, 0.375], [-1.95, 0.3], [-1.8, 0.24], [-1.72, 0.205], [-1.85, 0.205], [-2.05, 0.215], [-2.25, 0.235], [-2.34, 0.26]]);
      c.plate(0.76);
      c.rear('chrome', ellipse(0.5, 0.315, 0.052, 0.036, 12), 0.014);
      c.rear('dark', ellipse(0.5, 0.315, 0.04, 0.026, 12), 0.016);
    },
  },
  legacy: {
    brand: 'Subaru', name: 'Legacy', color: 0x9aa0a6, desc: 'All-wheel drive, grips anything',
    // 2025 Subaru Legacy, the last model year (production ended in 2025; subaru.ca no longer lists it).
    // Subaru's 2025 Legacy spec sheet: 4854 long, 1839 wide, 1501 tall, wheelbase 2751, overhangs
    // 1026/1080, track 1580/1610; Limited trim, 225/50R18. Shaped on Subaru's 360-degree studio
    // images of the 2025 Legacy Limited (subaru.com).
    len: 4.85, width: 1.84, wheelR: 0.341, tireW: 0.225, axles: [1.4, -1.35], round: 0.1, fin: -1.02, nose: 0.1, tail: 0.1,
    section: { shoulder: 0.62, belt: 0.06, tuck: 0.07, crease: 1.5, crown: 0.03, flare: 0.01, gap: 0.045, rocker: false },
    side: [
      [2.415, 0.29, 0.53], [2.39, 0.22, 0.62], [2.36, 0.19, 0.67], [2.32, 0.175, 0.74], [2.28, 0.18, 0.79], [2.22, 0.2, 0.838],
      [2.12, 0.205, 0.876], [2.0, 0.205, 0.908], [1.85, 0.205, 0.94], [1.7, 0.205, 0.96], [1.5, 0.2, 0.983], [1.3, 0.2, 1.0],
      [1.15, 0.2, 1.005], [0.95, 0.2, 0.978], [0.6, 0.2, 0.978], [0.2, 0.2, 0.998], [-0.4, 0.2, 1.033], [-1.0, 0.2, 1.063],
      [-1.3, 0.2, 1.08], [-1.6, 0.21, 1.105], [-1.8, 0.225, 1.12], [-2.0, 0.24, 1.126], [-2.1, 0.255, 1.123], [-2.2, 0.27, 1.115],
      [-2.28, 0.29, 1.108], [-2.33, 0.3, 1.09], [-2.36, 0.31, 1.04], [-2.385, 0.32, 0.8], [-2.42, 0.34, 0.66], [-2.44, 0.38, 0.55],
    ],
    plan: [
      [2.415, 0.22], [2.39, 0.36], [2.36, 0.46], [2.32, 0.57], [2.27, 0.67], [2.2, 0.77], [2.12, 0.84], [2.0, 0.89], [1.85, 0.91], [1.7, 0.918], [1.0, 0.915],
      [0.0, 0.91], [-1.0, 0.915], [-1.5, 0.92], [-1.9, 0.912], [-2.1, 0.895], [-2.2, 0.855], [-2.26, 0.79], [-2.3, 0.7], [-2.34, 0.58], [-2.37, 0.46], [-2.4, 0.36], [-2.43, 0.27], [-2.44, 0.2],
    ],
    cabin: [
      [1.15, 1.005, 0.69], [1.02, 1.051, 0.675], [0.92, 1.109, 0.665], [0.72, 1.225, 0.645], [0.52, 1.326, 0.63], [0.32, 1.419, 0.62],
      [0.12, 1.462, 0.615], [-0.18, 1.489, 0.61], [-0.38, 1.493, 0.61], [-0.58, 1.489, 0.61], [-0.78, 1.473, 0.612], [-0.98, 1.45, 0.615],
      [-1.18, 1.405, 0.62], [-1.38, 1.345, 0.63], [-1.58, 1.278, 0.64], [-1.78, 1.196, 0.655], [-1.98, 1.118, 0.67], [-2.02, 1.115, 0.675],
    ],
    // Six-light glass house in black frames (the 2025 Legacy has no chrome window trim): a division
    // bar in the rear door and a small pointed quarter window behind it; the belt rises to the back.
    windows: {
      belt: 0.012, top: 0.05, bands: [{ u0: 0.95, u1: -1.52, k0: 0.63, k1: 0.59 }], pillars: [-0.28],
      kick: [[-1.28, 0], [-1.36, 0.012], [-1.45, 0.045], [-1.52, 0.09]],
      extra: [{ u0: -0.94, u1: -0.98, k0: 40, k1: 40, mat: 'dark', off: 0.016 }, { u0: -1.29, u1: -1.31, k0: 40, k1: 40, mat: 'dark', off: 0.016 }],
    },
    windshield: [1.12, 0.15], backlight: [-1.05, -1.98],
    rim: { n: 10, style: 'multi', color: 0xb7bcc2 },
    doors: [0.95, -0.22, -1.285], handles: [-0.05, -1.1], handleMat: 'paint',
    mirror: { u: 0.66, dy: -0.05 },
    stats: { top: 0.98, accel: 1.0, grip: 1.25 },
    details(c) {
      // Front, 2023+ facelift: a big black hexagonal grille with gunmetal slats and a dark wing bar
      // carrying the blue six-star oval; slim swept headlights with the C-shaped running light; black
      // C-shaped fog-lamp frames in the corners and a wide black intake below.
      const grille = [[0, 0.8], [0.45, 0.795], [0.53, 0.775], [0.57, 0.715], [0.48, 0.575], [0.4, 0.455], [0.35, 0.43], [0, 0.43]];
      c.frontMid('grille', [...grille, ...grille.slice(1, -1).reverse().map(([x, y]) => [-x, y])], 0.014);
      for (const [y, w] of [[0.625, 0.5], [0.565, 0.46], [0.505, 0.42]]) c.frontMid('lens', rect(-w, y - 0.007, w, y + 0.007), 0.017);
      c.front('lens', [[0.07, 0.703], [0.3, 0.71], [0.5, 0.718], [0.64, 0.724], [0.65, 0.742], [0.5, 0.738], [0.3, 0.731], [0.07, 0.726]], 0.018);
      c.frontMid('chrome', ellipse(0, 0.7, 0.085, 0.05, 12), 0.02);
      c.frontMid('badge', ellipse(0, 0.7, 0.074, 0.041, 12), 0.022);
      c.frontMid('chrome', [[-0.045, 0.705], [-0.025, 0.711], [-0.019, 0.73], [-0.013, 0.711], [0.007, 0.705], [-0.013, 0.699], [-0.019, 0.68], [-0.025, 0.699]], 0.024);
      c.frontMid('chrome', [[0.005, 0.69], [0.05, 0.69], [0.05, 0.703], [0.005, 0.703]], 0.024);
      c.front('lens', [[0.44, 0.75], [0.6, 0.805], [0.8, 0.86], [0.83, 0.86], [0.83, 0.755], [0.7, 0.726], [0.55, 0.724]]);
      c.front('head', [[0.6, 0.728], [0.75, 0.738], [0.83, 0.762], [0.852, 0.81], [0.842, 0.812], [0.82, 0.77], [0.75, 0.747], [0.6, 0.737]], 0.018);
      c.front('chrome', [[0.66, 0.785], [0.74, 0.792], [0.74, 0.812], [0.66, 0.806]], 0.017);
      c.front('dark', [[0.62, 0.53], [0.83, 0.535], [0.8, 0.47], [0.64, 0.49]]);
      c.front('dark', [[0.8, 0.47], [0.83, 0.535], [0.83, 0.28], [0.76, 0.28], [0.67, 0.32], [0.8, 0.385]]);
      c.front('chrome', [[0.805, 0.34], [0.855, 0.335], [0.86, 0.375], [0.81, 0.38]], 0.017);
      c.frontMid('grille', [[-0.58, 0.365], [0.58, 0.365], [0.52, 0.3], [0.42, 0.24], [-0.42, 0.24], [-0.52, 0.3]]);
      // The headlights wrap round onto the front fenders.
      c.side('lens', [[1.72, 0.905], [1.8, 0.89], [1.9, 0.87], [2.0, 0.85], [2.1, 0.82], [2.2, 0.79], [2.28, 0.76], [2.28, 0.72], [2.2, 0.72], [2.1, 0.73], [2.0, 0.75], [1.95, 0.78], [1.85, 0.82], [1.78, 0.86]]);
      c.side('head', [[1.95, 0.775], [2.0, 0.748], [2.1, 0.728], [2.2, 0.718], [2.2, 0.727], [2.1, 0.737], [2.0, 0.757]], 0.009);
      // Rear: wedge-shaped tail lamps with a red C round a clear centre, wrapping onto the fenders;
      // the blue oval on the trunk lid, SUBARU and LEGACY lettering, a black lower bumper.
      c.rear('dark', [[0.35, 0.99], [0.6, 1.02], [0.8, 1.038], [0.8, 0.878], [0.7, 0.878], [0.55, 0.915], [0.44, 0.96]]);
      c.rear('tail', [[0.4, 0.993], [0.55, 1.008], [0.55, 1.0], [0.42, 0.988]], 0.016);
      c.rear('tail', [[0.55, 1.008], [0.84, 1.032], [0.84, 1.002], [0.55, 0.99]], 0.016);
      c.rear('tail', [[0.8, 1.01], [0.845, 1.01], [0.845, 0.886], [0.8, 0.9]], 0.016);
      c.rear('tail', [[0.62, 0.912], [0.7, 0.886], [0.845, 0.886], [0.845, 0.906], [0.72, 0.906], [0.66, 0.918]], 0.016);
      c.rear('lens', [[0.52, 0.968], [0.8, 0.995], [0.8, 0.92], [0.66, 0.93]], 0.015);
      c.side('dark', [[-2.36, 1.0], [-2.2, 1.005], [-2.0, 1.0], [-1.96, 0.99], [-2.05, 0.93], [-2.2, 0.87], [-2.36, 0.86]]);
      c.side('tail', [[-2.35, 0.992], [-2.0, 0.993], [-1.975, 0.987], [-2.0, 0.979], [-2.25, 0.978], [-2.25, 0.875], [-2.35, 0.87]], 0.009);
      c.rear('dark', [[0, 0.712], [0.35, 0.719], [0.5, 0.742], [0.585, 0.787], [0.625, 0.875], [0.617, 0.875], [0.577, 0.792], [0.496, 0.749], [0.348, 0.726], [0, 0.719]], 0.013);
      c.rearMid('chrome', ellipse(0, 1.065, 0.07, 0.042, 12), 0.016);
      c.rearMid('badge', ellipse(0, 1.065, 0.06, 0.034, 12), 0.018);
      for (const x0 of [-0.555, 0.33]) for (let k = 0; k < 6; k++) c.rearMid('chrome', rect(x0 + k * 0.031, 0.813, x0 + k * 0.031 + 0.022, 0.829), 0.014);
      const bumper = [[0, 0.44], [0.3, 0.447], [0.45, 0.47], [0.6, 0.5], [0.78, 0.515], [0.78, 0.3]];
      c.rearMid('dark', [...bumper, ...bumper.slice(1).reverse().map(([x, y]) => [-x, y])]);
      c.side('dark', [[-2.44, 0.5], [-2.36, 0.5], [-2.3, 0.45], [-2.25, 0.38], [-2.18, 0.31], [-2.44, 0.31]]);
      c.plate(0.875);
    },
  },
  carnival: {
    // The 2027 Carnival as on kia.ca (the 2025 facelift look, "Star Map" lights), SX trim as in Kia
    // Canada's 360 view: 19" wheels, roof rails. Official sizes: 5,155 long, 1,995 wide (2,266 with
    // mirrors), 1,740 tall (1,775 with roof rails), wheelbase 3,090, overhangs 935 / 1,130, track
    // 1,740, 235/55R19 tyres. Profile and window lines measured off Kia Canada's 360 renders.
    brand: 'Kia', name: 'Carnival', color: 0xeeeeea, desc: '7 seats, sliding doors. Heavy.', heavy: true,
    len: 5.155, width: 2.0, wheelR: 0.37, tireW: 0.235, axles: [1.6425, -1.4475], round: 0.15, cladding: true, fin: -1.95,
    // Thin black arch mouldings close to the tyres, black sill, tall black lower rear bumper.
    section: {
      shoulder: 0.6, belt: 0.045, tuck: 0.06, crease: 1.6, crown: 0.025, flare: 0.015, gap: 0.035, mold: 0.04, faceFade: true,
      sill: [[2.5775, 0.12], [2.2, 0.2], [1.9, 0.2], [1.2, 0.17], [-1.0, 0.17], [-1.9, 0.33], [-2.3, 0.36], [-2.5775, 0.3]],
    },
    // Tall upright nose under a long, nearly flat hood.
    side: [[2.5775, 0.3, 0.93], [2.49, 0.25, 0.985], [2.41, 0.245, 1.012], [2.3, 0.245, 1.052], [2.2, 0.242, 1.083], [2.0, 0.24, 1.124], [1.8, 0.24, 1.155], [1.6, 0.243, 1.175], [1.48, 0.245, 1.185],
      [1.263, 0.247, 1.146], [1.07, 0.247, 1.166], [0.074, 0.247, 1.166], [-0.058, 0.247, 1.2], [-0.8, 0.247, 1.2], [-1.22, 0.247, 1.215], [-1.6, 0.25, 1.22],
      [-1.9, 0.271, 1.225], [-2.1, 0.305, 1.225], [-2.3, 0.344, 1.215], [-2.45, 0.37, 1.2], [-2.5775, 0.4, 1.17]],
    // Seen from above both ends are well rounded: the lamps wrap round the corners (positions
    // triangulated from three of Kia's 360 frames).
    plan: [[2.5775, 0.45], [2.52, 0.58], [2.47, 0.64], [2.42, 0.69], [2.36, 0.75], [2.3, 0.82], [2.25, 0.875], [2.18, 0.92], [2.08, 0.96], [1.95, 0.985], [1.8, 0.998], [1.64, 1.0],
      [-1.45, 1.0], [-1.86, 0.995], [-1.95, 0.98], [-2.05, 0.94], [-2.14, 0.905], [-2.25, 0.88], [-2.35, 0.86], [-2.38, 0.83], [-2.41, 0.77], [-2.45, 0.69],
      [-2.48, 0.64], [-2.52, 0.56], [-2.5775, 0.45]],
    // Flat roof to the spoiler, then the raked rear window.
    cabin: [[1.48, 1.2, 0.86], [1.27, 1.31, 0.84], [1.07, 1.43, 0.82], [0.86, 1.538, 0.805], [0.65, 1.63, 0.795], [0.45, 1.69, 0.79], [0.25, 1.725, 0.79], [0, 1.735, 0.79],
      [-1.0, 1.738, 0.79], [-2.0, 1.73, 0.795], [-2.2, 1.68, 0.79], [-2.29, 1.6, 0.78], [-2.36, 1.42, 0.75], [-2.44, 1.3, 0.69], [-2.52, 1.19, 0.58], [-2.555, 1.13, 0.5]],
    // Black glass line (a small step up behind the B pillar) that wraps round the D pillar, and the
    // Carnival's silver blade between the sliding-door glass and the rear quarter glass, leaning
    // forward (a chrome skin, with glass laid back over it in front of its slanted front edge).
    windows: {
      belt: 0.01, top: 0.13, bands: [{ u0: 1.263, u1: -2.35, k0: 0.62, k1: 6 }], pillars: [0.008], kick: [[-2.2, 0], [-2.35, 0.22]],
      extra: [
        { u0: -1.092, u1: -1.442, k0: 40, k1: 2.69, mat: 'chrome', off: 0.02 },
        { u0: -0.95, u1: -1.222, k0: 40, k1: 2.69, mat: 'glass', off: 0.024 },
      ],
    },
    windshield: [1.46, 0.5], backlight: [-2.31, -2.46], cabinStations: [-2.25, -2.31, -2.37, -2.43, -2.5],
    mirror: { u: 0.98, y: -0.016, out: 0.11, mat: 'dark', armMat: 'paint' },
    rim: { n: 5, style: 'split', color: 0x2b2d31 },
    doors: [1.132, 0.065, -1.13], handles: [0.27, -0.13],
    stats: { top: 0.9, accel: 0.9, grip: 0.92 },
    details(c) {
      // Mirrored shapes: a right half from the centre line round to the centre line again.
      const full = (half) => [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
      const thin = (pts, w = 0.004) => [...pts.map(([x, y]) => [x + w, y + w]), ...[...pts].reverse().map(([x, y]) => [x - w, y - w])];
      // Front (traced from Kia Canada's renders): a stack of four LED lamps at each corner, with the
      // amber "Star Map" light running down its outer edge and in along the top of the grille.
      c.front('dark', [[0.88, 1.012], [0.774, 1.004], [0.756, 0.717], [0.782, 0.692], [0.84, 0.692], [0.866, 0.721]], 0.012, 0.35);
      for (const y of [0.931, 0.868, 0.804, 0.742]) c.front('head', rect(0.785, y - 0.017, 0.835, y + 0.017), 0.016, 0.35);
      c.front('amber', [[0.878, 0.988], [0.851, 0.98], [0.844, 0.717], [0.866, 0.717]], 0.016, 0.35);
      c.front('amber', [[0.865, 0.994], [0.58, 0.984], [0.27, 0.968], [0.266, 0.954], [0.579, 0.967], [0.84, 0.973]], 0.016, 0.35);
      // The lamp housing and the amber line run back along the top of the front fender to a point.
      c.sideFlat('dark', [[1.91, 1.022], [2.05, 1.006], [2.25, 0.99], [2.25, 0.7], [2.215, 0.835], [2.088, 0.909]]);
      c.sideFlat('amber', [[1.935, 1.016], [2.05, 1.0], [2.25, 0.983], [2.25, 0.963], [2.05, 0.982], [1.97, 1.006]], 0.012);
      c.frontMid('chrome', [[-0.268, 0.952], [0.268, 0.952], [0.268, 0.966], [-0.268, 0.966]], 0.014);
      // The wide grille: chrome frame, black inside, rows of silver dashes, a dip in its lower edge.
      c.frontMid('chrome', full([[0, 0.962], [0.642, 0.962], [0.686, 0.937], [0.688, 0.784], [0.654, 0.751], [0.409, 0.744], [0.305, 0.707], [0, 0.703]]), 0.012);
      // (The black sits well clear of the frame so the two never fight where the face curves.)
      c.frontMid('dark', full([[0, 0.946], [0.632, 0.946], [0.669, 0.926], [0.671, 0.79], [0.645, 0.767], [0.405, 0.76], [0.3, 0.722], [0, 0.719]]), 0.022);
      [0.915, 0.872, 0.829, 0.786].forEach((y, row) => {
        for (let k = -6; k <= 6; k++) {
          const x = (k + (row % 2) * 0.5) * 0.1;
          if (Math.abs(x) > (row === 3 ? 0.5 : 0.59)) continue;
          const z = c.at(x, y);
          if (z != null) c.panel('chrome', x, y, z - 0.03, 0.064, 0.012);
        }
      });
      // KIA wordmark on the nose of the hood.
      c.frontMid('dark', [[-0.094, 1.022], [-0.082, 1.022], [-0.072, 1.05], [-0.084, 1.05]], 0.014);
      c.frontMid('dark', [[-0.076, 1.034], [0.0, 1.05], [0.012, 1.05], [-0.07, 1.025]], 0.014);
      c.frontMid('dark', [[0.012, 1.022], [0.044, 1.05], [0.056, 1.05], [0.072, 1.022], [0.06, 1.022], [0.05, 1.04], [0.024, 1.022]], 0.014);
      // Lower intake band with the LED fog-lamp cubes and the plate bracket.
      c.frontMid('dark', [[-0.74, 0.374], [0.74, 0.374], [0.76, 0.541], [-0.76, 0.541]]);
      c.front('head', rect(0.505, 0.408, 0.609, 0.49), 0.016);
      c.frontMid('lens', rect(-0.099, 0.379, 0.099, 0.504), 0.016);
      // Rear: a full-width light bar under the rear glass, its ends turning down into the corner lamps.
      c.rearMid('tail', [[-0.79, 1.15], [-0.77, 1.227], [0.77, 1.227], [0.79, 1.15], [0.72, 1.177], [-0.72, 1.177]], 0.014, 0.35);
      // The corner lamps sit on the rounded rear corners, with an arm reaching forward along the
      // quarter panel (traced from the side view; from behind, their rear edge is the inner edge).
      c.sideFlat('tail', [[-2.425, 1.195], [-2.342, 1.178], [-2.239, 1.15], [-2.144, 1.1], [-2.21, 1.093], [-2.286, 1.085], [-2.353, 1.085], [-2.353, 0.907], [-2.368, 0.858], [-2.405, 0.9], [-2.415, 1.0], [-2.42, 1.1]], 0.01);
      c.rearMid('dark', [[-0.098, 1.07], [-0.086, 1.07], [-0.076, 1.11], [-0.088, 1.11]], 0.014);
      c.rearMid('dark', [[-0.08, 1.087], [0.0, 1.11], [0.012, 1.11], [-0.074, 1.074]], 0.014);
      c.rearMid('dark', [[0.012, 1.07], [0.046, 1.11], [0.058, 1.11], [0.076, 1.07], [0.064, 1.07], [0.052, 1.096], [0.024, 1.07]], 0.014);
      c.plate(0.835);
      // Tailgate shut line, CARNIVAL lettering, black lower bumper with reflectors and a silver skid plate.
      c.rear('dark', thin([[0.002, 0.615], [0.667, 0.61], [0.702, 0.639], [0.72, 0.799], [0.733, 0.925]]), 0.013);
      c.rearMid('chrome', rect(-0.69, 0.682, -0.465, 0.698), 0.014);
      c.rearMid('dark', [[-0.76, 0.64], [-0.496, 0.6], [0, 0.594], [0.496, 0.6], [0.76, 0.64], [0.76, 0.38], [-0.76, 0.38]], 0.012);
      c.rear('tail', [[0.58, 0.58], [0.74, 0.574], [0.74, 0.54], [0.58, 0.548]], 0.016);
      c.rear('head', rect(0.74, 0.54, 0.77, 0.574), 0.016);
      c.rearMid('chrome', rect(-0.497, 0.38, 0.497, 0.426), 0.016);
      // Low roof rails sitting on the roof, and the roof spoiler over the rear window.
      for (const s of [-1, 1]) c.box('dark', s * 0.56, 1.755, 0.87, 0.04, 0.04, 2.14);
      c.box('paint', 0, 1.62, 2.31, 1.45, 0.04, 0.12);
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

// The supercars (src/supercars/) join the garage; traffic stays the team's own cars.
Object.assign(CAR_MODELS, SUPERCARS);
export const CAR_IDS = Object.keys(CAR_MODELS);
export const TRAFFIC_MIX = CAR_IDS.filter((id) => !CAR_MODELS[id].kind && !CAR_MODELS[id].super);
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
// Amber running lights (decal material 'amber', e.g. the Carnival's "Star Map" light lines).
const amberMat = new THREE.MeshStandardMaterial({ color: 0xffa424, emissive: 0xff8c00, emissiveIntensity: 0.65 });
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
//   sill: optional [[u, h], ...]: a black band h metres tall along the bottom of the body (sill and
//     lower bumpers), stopping at the wheel openings; unlike `cladding` it doesn't ring the arches
//     (on a car with `cladding`, it sets the height of the cladding instead of the usual 0.17 m)
//   mold: optional width of the cladding band round the wheel arches (default 0.075 m)
//   faceFade: optional; keeps dark underbody/trim colours from streaking up the bumper faces
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
  // Optional d.rearWheel { r, w }: the rear axle's wheel radius and tyre width, for staggered
  // supercar wheels (bigger, wider at the back). Without it every wheel is wheelR / tireW.
  const RW = d.rearWheel;
  const wheelROf = (axle) => (RW && axle === d.axles[1] ? RW.r : d.wheelR);
  const tireWOf = (axle) => (RW && axle === d.axles[1] ? RW.w : tireW);
  const nose = d.nose ?? 0.13;
  const tail = d.tail ?? 0.11;
  const sillAt = S.sill ? monotone(S.sill) : null;
  const clad = !!d.cladding || !!sillAt;
  // How much the section is shrunk towards its centre at u (1 = not at all).
  const bumper = (u) => {
    if (u > uFront - nose) return bumperScale((u - (uFront - nose)) / nose);
    if (u < uBack + tail) return bumperScale((uBack + tail - u) / tail);
    return 1;
  };

  // Wheels sit just inside the widest line of the body; their wells are cut out of it.
  const wheelX = (axle) => half(axle) - 0.015 - tireWOf(axle) / 2;
  const arches = d.axles.map((a) => ({ u: a, r: wheelROf(a), R: wheelROf(a) + S.gap, xIn: half(a) - tireWOf(a) - 0.05 }));
  const archAt = (u) => arches.find((A) => Math.abs(u - A.u) < A.R);
  // Top of the wheel opening at u (-Infinity away from the wheels).
  const archTop = (u) => {
    const A = archAt(u);
    return A ? A.r + Math.sqrt(A.R * A.R - (u - A.u) ** 2) : -Infinity;
  };
  // Distance outside the nearest wheel opening's edge (negative inside it).
  const archDist = (u, y) => {
    let best = Infinity;
    for (const A of arches) best = Math.min(best, Math.hypot(u - A.u, y - A.r) - A.R);
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
    // `mold` sets the band's width round the arches; `sill` keyframes (if given) its height.
    const MOLD = S.mold ?? 0.075;
    let moldY = -Infinity;
    if (d.cladding) {
      moldY = y0 + (sillAt ? sillAt(u) : 0.17);
      for (const A of arches) {
        const du = u - A.u;
        const R = A.R + MOLD;
        if (Math.abs(du) < R) moldY = Math.max(moldY, A.r + Math.sqrt(R * R - du * du));
      }
      moldY = Math.min(sideTop - 0.002, Math.max(sideBot + 0.002, moldY));
    } else if (sillAt) {
      // Above the wheel opening's top (where there is one), so the band stops at the arch.
      moldY = Math.min(sideTop - 0.002, Math.max((cutY ?? sideBot + 0.004) + 0.002, y0 + sillAt(u)));
    }
    const pts = [];
    const shade = [];
    const paintAt = (y) => {
      if (clad && y < moldY) return 0.13;
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
    const upperEnd = clad ? moldY : breakY;
    let edge = -1;
    const UPPER = 6;
    for (let k = 1; k <= UPPER; k++) {
      const y = sideTop - ((sideTop - upperEnd) * k) / (UPPER + 1);
      push(sideX(y), y, paintAt(y));
    }
    if (clad) {
      push(sideX(moldY), moldY, 0.8 + 0.2 * smoothstep(y0, y0 + 0.45, moldY));
      push(sideX(moldY), moldY, 0.13);
      const MID = d.cladding ? 3 : 1; // a sill band is short: one point down it is enough
      for (let k = 1; k <= MID; k++) {
        const y = moldY - ((moldY - breakY) * k) / (MID + 1);
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
      shade.push(clad ? 0.13 : low ?? shade[shade.length - 1]);
    }
    for (let k = 1; k <= 3; k++) {
      const a = -(Math.PI / 2) * (k / 3);
      const y = sideBot + rb * Math.sin(a);
      push(wb - rb + rb * Math.cos(a), y, clad ? 0.13 : low ?? paintAt(y), cutY != null);
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
      // faceFade: on the rounded bumper faces, fade the dark underbody and trim colours back
      // to paint as the section shrinks, so they don't streak up to the middle of the face.
      if (S.faceFade) {
        const f = smoothstep(0.85, 0.45, c);
        for (let k = 0; k < shade.length; k++) shade[k] += (1 - shade[k]) * f;
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

  // Glass-house section at u. It starts inside the body so the joint never shows. Opt-in: a 4th
  // value in the `cabin` keyframes sets its half-width at that base (default: the body's full
  // width), for a canopy narrower than the body (the McLaren's teardrop between its haunches).
  const baseW = d.cabin.every((k) => k.length > 3) ? monotone(d.cabin.map(([u, , , b]) => [u, b])) : null;
  const gh = (u) => {
    const y0 = top(u) - 0.1;
    return { y0, y1: Math.max(y0 + 0.02, roofY(u)), wb: baseW ? baseW(u) : half(u) - rTop * 0.7, wt: roofW(u) };
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
  // Glass house sits on the belt line, narrower at the roof (tumblehome). `cabinStations` adds
  // sections where the roof bends sharply, so the glass laid on it stays on the surface.
  const glassHouse = (m) => {
    const us = [];
    for (let i = 0; i < m; i++) us.push(cFront + ((cBack - cFront) * i) / (m - 1));
    for (const u of d.cabinStations || []) if (u < cFront && u > cBack) us.push(u);
    us.sort((a, b) => b - a);
    return us.map((u) => {
      const g = gh(u);
      return { u, pts: ring(g.y0, g.y1, g.wb, g.wt, 0.02, rtG) };
    });
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
    tireW, wheelX, archTop, wheelROf, tireWOf,
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
  geos.rearWheel = RW ? buildWheel({ ...d, wheelR: RW.r }, { ...fn, tireW: RW.w }) : geos.wheel;
  geos.wheelOf = (axle) => (axle === d.axles[1] ? geos.rearWheel : geos.wheel);
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
      const grad = g.createRadialGradient(x, y, 0, x, y, fn.tireWOf(axle) * sx * 1.4);
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
function topPane(fn, ua, ub, inset, add, mat = 'glass', lift = 0.012, step = 0.03) {
  const tris = [];
  const cols = 10;
  const rows = Math.max(2, Math.ceil(Math.abs(ua - ub) / step));
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
  // How far back from the bumper tips a front/rear decal may wrap round the corners (m):
  // opt-in per car (`wrap`) and per decal (the helpers' last argument).
  const WRAP_DEPTH = d.wrap ?? 0.32;
  const decal = (mat, pts, front, off, mirror, wrap = WRAP_DEPTH) => {
    const cache = new Map();
    const map = (x, y) => {
      const key = `${x.toFixed(5)},${y.toFixed(5)}`;
      if (!cache.has(key)) {
        const u = fn.surfaceU(x, y, front);
        if (u == null || (front ? fn.uFront - u : u - fn.uBack) > wrap) cache.set(key, null);
        else {
          fn.surfaceNormal(x, y, front, nrm);
          cache.set(key, [x + nrm.x * off, y + nrm.y * off, -u + nrm.z * off]);
        }
      }
      return cache.get(key);
    };
    const SAG = d.sag ?? 0.004; // metres a decal edge may stray from the body before it's split (keep below the decals' offsets)
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

  // A decal on the body's flanks, given as an [u, y] outline for the right-hand side (mirrored):
  // for lights that wrap far along the fenders. Each point is pushed out to the body (or glass
  // house) surface and lifted off it by `off` along the normal. With `shade`, a 'paint' decal is
  // that much darker (a vertex colour), to suggest a sculpted, shadowed panel.
  const sideX = (u, y) => Math.max(fn.bodyX(u, y), fn.ghX(u, y));
  const sideDecal = (mat, pts, off, shade) => {
    const contour = pts.map(([u, y]) => new THREE.Vector2(u, y));
    const faces = THREE.ShapeUtils.triangulateShape(contour, []);
    // Point on the surface, with the surface's own normal (smooth, so reflections don't facet).
    const P = (u, y, s) => {
      const x = sideX(u, y);
      if (!(x > 0)) return null;
      const h = 0.01;
      const slope = (a, b) => (a > 0 && b > 0 ? (a - b) / (2 * h) : 0);
      const n = new THREE.Vector3(1, -slope(sideX(u, y + h), sideX(u, y - h)), slope(sideX(u + h, y), sideX(u - h, y))).normalize();
      return { p: [s * (x + n.x * off), y + n.y * off, -u + n.z * off], n: [s * n.x, n.y, n.z] };
    };
    const a0 = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    for (const s of [1, -1]) {
      const pos = [];
      const nor = [];
      for (const [ia, ib, ic] of faces) {
        const A = contour[ia], B = contour[ib], C = contour[ic];
        // Pieces about 10 cm long hug the gently curved flanks closely enough.
        const S = Math.min(6, Math.max(1, Math.ceil(Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A)) / 0.1)));
        const at = (i, j) => [A.x + ((B.x - A.x) * i + (C.x - A.x) * j) / S, A.y + ((B.y - A.y) * i + (C.y - A.y) * j) / S];
        for (let i = 0; i < S; i++) {
          for (let j = 0; j < S - i; j++) {
            const cells = [[at(i, j), at(i + 1, j), at(i, j + 1)]];
            if (j < S - i - 1) cells.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
            for (const cell of cells) {
              const v = cell.map(([u, y]) => P(u, y, s));
              if (!v.every(Boolean)) continue;
              a0.fromArray(v[0].p);
              ab.fromArray(v[1].p).sub(a0);
              ac.fromArray(v[2].p).sub(a0);
              const order = ab.cross(ac).x * s >= 0 ? [0, 1, 2] : [0, 2, 1];
              for (const o of order) { pos.push(...v[o].p); nor.push(...v[o].n); }
            }
          }
        }
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      if (shade != null) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(shade), 3));
      add(mat, g);
    }
  };

  const ctx = {
    front: (mat, pts, off = 0.012, wrap) => decal(mat, pts, true, off, true, wrap),
    frontMid: (mat, pts, off = 0.012, wrap) => decal(mat, pts, true, off, false, wrap),
    rear: (mat, pts, off = 0.012, wrap) => decal(mat, pts, false, off, true, wrap),
    rearMid: (mat, pts, off = 0.012, wrap) => decal(mat, pts, false, off, false, wrap),
    side: (mat, pts, off = 0.006, shade) => sideDecal(mat, pts, off, shade),
    plate(y) {
      decal('dark', rect(-0.18, y - 0.095, 0.18, y + 0.095), false, 0.012, false);
      decal('plate', rect(-0.16, y - 0.08, 0.16, y + 0.08), false, 0.018, false);
    },
    // A simpler side decal than side(): the [u, y] outline pushed straight out from the body
    // by `off`, flat-shaded (the Carnival's lights; side() follows the surface's curve).
    sideFlat(mat, pts, off = 0.008) {
      const contour = pts.map(([u, y]) => new THREE.Vector2(u, y));
      const faces = THREE.ShapeUtils.triangulateShape(contour, []);
      const S = 4;
      for (const s of [-1, 1]) {
        const tris = [];
        const P = (u, y) => {
          const x = fn.bodyX(u, y);
          return x > 0 ? [s * (x + off), y, -u] : null;
        };
        for (const [ia, ib, ic] of faces) {
          const A = contour[ia];
          const B = contour[ib];
          const C = contour[ic];
          const at = (i, j) => [A.x + ((B.x - A.x) * i + (C.x - A.x) * j) / S, A.y + ((B.y - A.y) * i + (C.y - A.y) * j) / S];
          for (let i = 0; i < S; i++) {
            for (let j = 0; j < S - i; j++) {
              const cells = [[at(i, j), at(i + 1, j), at(i, j + 1)]];
              if (j < S - i - 1) cells.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
              for (const cell of cells) {
                const v = cell.map(([u, y]) => P(u, y));
                if (v.every(Boolean)) tris.push(...v);
              }
            }
          }
        }
        if (tris.length) add(mat, triMesh(tris, new THREE.Vector3(s, 0, 0)));
      }
    },
    // z of the body surface seen from the front (or the back) at (x, y), for placing small parts.
    at: (x, y, front = true) => {
      const u = fn.surfaceU(x, y, front);
      return u == null ? null : -u;
    },
    // A flat w × h panel facing forwards (or backwards): two triangles, for small flat parts.
    panel(mat, x, y, z, w, h, front = true) {
      const g = new THREE.PlaneGeometry(w, h);
      if (front) g.rotateY(Math.PI);
      add(mat, g.translate(x, y, z));
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

  // Glass. `glassFrame`: a black border round the windshield and rear window that wraps down to
  // the side glass (black A pillars).
  windowGeos(d, fn, add);
  for (const [pane, inset] of [[d.windshield, 0.07], [d.backlight, 0.08]]) {
    if (!pane) continue;
    if (d.glassFrame) topPane(fn, pane[0] + 0.03, pane[1] - 0.03, 0, add, 'dark', 0.008, 0.07);
    topPane(fn, pane[0], pane[1], inset, add);
  }

  // Wipers resting at the bottom of the windshield.
  if (d.windshield) {
    const u = d.windshield[0] - 0.07;
    const g = fn.gh(u);
    for (const s of [-1, 1]) {
      const arm = new THREE.BoxGeometry(0.62, 0.014, 0.03).rotateZ(s * 0.06);
      add('dark', arm.translate(s * 0.32 - 0.04, g.y1 + 0.03, -u));
    }
  }
  // Third brake light at the top of the rear window (opt-out per car: `brakeLight: false`, for cars
  // that have it elsewhere, like the 911's on its wing).
  if (d.backlight && d.brakeLight !== false) {
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
  // Handles are chrome unless the car says otherwise (`handleMat`, e.g. 'paint').
  for (const u of d.handles || []) {
    for (const s of [-1, 1]) {
      const y = fn.top(u) - 0.11;
      const handle = new THREE.CapsuleGeometry(0.016, 0.13, 4, 8).rotateX(Math.PI / 2);
      add(d.handleMat || 'chrome', handle.translate(s * (fn.bodyX(u, y) + 0.008), y, -u));
    }
  }

  // Mirrors: a rounded shell on a short arm at the bottom corner of the side glass.
  // Opt-in per car: `mirror: { u, y, out, dx, dy, mat, armMat }`: where along the car (default
  // 0.3 m behind the windshield base), its base height above the belt (default 0.02 m), how
  // far out the shell sits (default 0.17 m), extra moves out / up (m), the shell's material
  // (default paint) and the arm's (default: the shell's).
  const mirror = d.mirror || {};
  for (const s of [-1, 1]) {
    const u = mirror.u ?? fn.cFront - 0.3;
    const yBase = fn.top(u) + (mirror.y ?? 0.02);
    const x = fn.ghX(u, yBase + 0.05);
    const y = yBase + 0.1 + (mirror.dy ?? 0);
    const out = (mirror.out ?? 0.17) + (mirror.dx ?? 0);
    const shell = new THREE.SphereGeometry(0.1, 14, 10).scale(1.05, 0.62, 0.55);
    add(mirror.mat || 'paint', shell.translate(s * (x + out), y, -u));
    add('dark', new THREE.CircleGeometry(0.088, 14).scale(1.05, 0.58, 1).translate(s * (x + out), y, -u + 0.052));
    const arm = new THREE.BoxGeometry(out - 0.01, 0.05, 0.09);
    add(mirror.armMat || mirror.mat || 'paint', arm.translate(s * (x + out / 2 - 0.015), y - 0.04, -u));
  }

  // Brake discs and calipers behind the spokes (they don't turn with the wheel).
  for (const axle of d.axles) {
    const wr = fn.wheelROf(axle);
    const rimR = wr * (d.rim?.size ?? 0.7);
    for (const s of [-1, 1]) {
      const cx = s * (fn.wheelX(axle) + fn.tireWOf(axle) / 2 - 0.085);
      add('disc', new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.02, 28).rotateZ(Math.PI / 2).translate(cx, wr, -axle));
      const caliper = new THREE.BoxGeometry(0.05, 0.15, 0.09).translate(0, rimR * 0.68, 0).rotateX(axle > 0 ? -0.5 : 0.5);
      add('caliper', caliper.translate(cx + s * 0.02, wr, -axle));
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
  const rim = d.rim || { n: 5, style: 'twin', color: 0x9da3ab };
  // Optional: rim.size (rim radius as a share of the wheel radius), rim.lip ('dark' for a black lip),
  // rim.split / rim.spoke (half-angle and width of the 'split' style's spoke pairs).
  const rimR = r * (rim.size ?? 0.7);
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
    (rim.lip === 'dark' ? dark : face).push(new THREE.TorusGeometry(rimR - 0.008, 0.014, 4, 26).rotateY(Math.PI / 2).translate(outer, 0, 0));
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
      if (rim.style === 'split') { spoke(a - (rim.split ?? 0.075), rim.spoke ?? 0.032); spoke(a + (rim.split ?? 0.075), rim.spoke ?? 0.032); }
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
    paint, tail, head: headMat, amber: amberMat, dark: darkMat, chrome: chromeMat, glass: glassMat, lens: lensMat,
    grille: grilleMat, plate: plateMat, badge: badgeMat, disc: discMat, caliper: caliperMat,
  };

  for (const g of geos.body) car.add(new THREE.Mesh(g, paint));
  for (const g of geos.glass) car.add(new THREE.Mesh(g, d.greenhouse === 'glass' ? glassMat : paint));
  for (const [key, g] of Object.entries(geos.parts)) car.add(new THREE.Mesh(g, mats[key]));

  const wheels = [];
  const rimMaterial = rimMatFor(geos.wheel.color);
  for (const axle of d.axles) {
    const W = geos.wheelOf(axle);
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      const parts = W[s];
      w.add(new THREE.Mesh(W.tire, tireMat), new THREE.Mesh(parts.face, rimMaterial), new THREE.Mesh(parts.dark, darkMat));
      w.position.set(s * geos.fn.wheelX(axle), geos.fn.wheelROf(axle), -axle);
      w.userData.r = geos.fn.wheelROf(axle); // a bigger rear wheel turns slower
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

const PALETTE = ['dark', 'disc', 'caliper', 'tire', 'head', 'grille', 'plate', 'chrome', 'lens', 'badge', 'amber'];
const paletteSource = () => ({
  dark: darkMat, disc: discMat, caliper: caliperMat, tire: tireMat, head: headMat, grille: grilleMat, plate: plateMat,
  chrome: chromeMat, lens: lensMat, badge: badgeMat, amber: amberMat,
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
  const wheels = d.axles.flatMap((axle) => [-1, 1].map((s) => ({ axle, s, x: s * fn.wheelX(axle), r: fn.wheelROf(axle), W: geos.wheelOf(axle) })));
  const at = (g, w) => g.clone().translate(w.x, w.r, -w.axle);
  const glassLoft = d.greenhouse === 'glass';
  const paintOf = (body, glass) => mergeGeometries([...body, ...(glassLoft ? [] : glass), ...(parts.paint ? [parts.paint] : [])]
    .map((g) => only(g, ['position', 'normal', 'color'])));
  const merge = (list) => mergeGeometries(list.filter(Boolean));
  const pal = (key, g, color = src[key].color) => (g ? paletteGeo(g, key, color) : null);
  const wheelDark = wheels.map((w) => pal('dark', at(w.W[w.s].dark, w)));
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
      ...wheels.map((w) => pal('tire', at(w.W.tire, w))), pal('amber', parts.amber),
    ]),
    farPlain: merge([
      pal('dark', parts.dark), ...wheelDark, pal('head', parts.head),
      pal('grille', parts.grille, averageColor(grilleTex)), pal('plate', parts.plate, averageColor(plateTex)),
      ...wheels.map((w) => pal('tire', at(w.W.farTire, w))), pal('amber', parts.amber),
    ]),
    // Both rims of an axle, around the axle's centre (they spin together).
    axles: d.axles.map((axle) => ({
      axle,
      r: fn.wheelROf(axle),
      geo: mergeGeometries([-1, 1].map((s) => geos.wheelOf(axle)[s].face.clone().translate(s * fn.wheelX(axle), 0, 0))),
    })),
    farRims: mergeGeometries(wheels.map((w) => at(w.W[w.s].face, w))),
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
  const wheels = t.axles.map(({ axle, r, geo }) => {
    const g = new THREE.Group();
    g.position.set(0, r, -axle);
    g.userData.r = r;
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
  for (const w of car.userData.wheels) w.rotation.x -= distance / (w.userData.r || car.userData.wheelR);
  car.userData.onSpin?.(distance);
}
