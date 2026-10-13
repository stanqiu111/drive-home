// Ferrari 296 GTB (mid-engine V6 plug-in hybrid, 2022-2026 model years).
// ferrari.com technical data: 4565 long, 1958 wide, 1187 tall, 2600 wheelbase, 1665 / 1632 front /
// rear track, 245/35 ZR20 front and 305/35 ZR20 rear tyres.
// Shape measured from ferrari.com's photos (side cut-out, top view, front and close-ups) and the
// Ferrari configurator's renders, cameras fitted from the wheel hubs: axles 1.173 m ahead of and
// 1.427 m behind the middle of the car (two independent side views agree within 2 mm).
import { rect } from './_shape.js';

// Front and rear outlines are given for the car's right side (x > 0) and mirrored automatically.
export default {
  brand: 'Ferrari', name: '296 GTB', color: 0xd40000, super: true,
  desc: 'Mid-engine V6 hybrid. Rosso Corsa, of course.',
  len: 4.565, width: 1.958, wheelR: 0.34, tireW: 0.245, rearWheel: { r: 0.361, w: 0.305 },
  axles: [1.173, -1.427], round: 0.12, nose: 0.1, tail: 0.07, wrap: 0.8, sag: 0.006,
  mirror: { u: 0.5, y: -0.03, out: 0.17 },
  section: {
    shoulder: 0.5, belt: 0.08, tuck: 0.09, crease: 1.6, crown: -0.06, flare: 0.025, gap: 0.03, rocker: false,
    // Black splitter, sills and diffuser.
    sill: [[2.2825, 0.05], [2.0, 0.06], [1.5, 0.08], [0.8, 0.12], [-0.9, 0.12], [-1.7, 0.1], [-2.0, 0.17], [-2.2825, 0.2]],
  },
  // Long, low nose rising gently to the base of the windshield (`top` is the middle of the car; the
  // negative crown lifts the fender crests about 0.06 m above it); the belt kicks up behind the door
  // into the rear haunches; the short tail leans forward under the spoiler lip.
  side: [
    [2.2825, 0.3, 0.42], [2.25, 0.25, 0.432], [2.2, 0.225, 0.445], [2.1, 0.215, 0.5], [2.0, 0.2, 0.55], [1.9, 0.19, 0.595],
    [1.8, 0.178, 0.635], [1.7, 0.17, 0.67], [1.6, 0.165, 0.7], [1.5, 0.16, 0.725], [1.4, 0.157, 0.75], [1.3, 0.155, 0.775],
    [1.2, 0.152, 0.795], [1.1, 0.15, 0.81], [1.0, 0.14, 0.805], [0.9, 0.14, 0.78], [0.5, 0.13, 0.77], [0.1, 0.125, 0.79], [-0.3, 0.12, 0.84],
    [-0.6, 0.12, 0.89], [-0.9, 0.12, 0.92], [-1.2, 0.12, 0.935], [-1.5, 0.12, 0.935], [-1.7, 0.12, 0.925], [-1.9, 0.115, 0.905],
    [-2.05, 0.13, 0.875], [-2.15, 0.15, 0.85], [-2.19, 0.18, 0.74], [-2.23, 0.24, 0.56], [-2.2825, 0.3, 0.42],
  ],
  // Plan: a broad, blunt nose (from the configurator's front 3/4 view and the side view; ferrari.com's
  // top-view graphic squeezes the ends), 1.88 m over the front fenders, the full 1.96 m over the
  // rear haunches, short blunt tail.
  plan: [
    [2.2825, 0.44], [2.25, 0.56], [2.2, 0.66], [2.15, 0.735], [2.1, 0.785], [2.05, 0.822], [2.0, 0.848], [1.9, 0.876],
    [1.8, 0.894], [1.7, 0.907], [1.6, 0.918], [1.5, 0.928], [1.35, 0.937], [1.1, 0.942], [0.9, 0.932], [0.6, 0.928],
    [0.3, 0.935], [0.0, 0.942], [-0.3, 0.949], [-0.6, 0.951], [-0.9, 0.95], [-1.1, 0.968], [-1.3, 0.979], [-1.6, 0.977],
    [-1.75, 0.968], [-1.85, 0.955], [-1.95, 0.935], [-2.05, 0.905], [-2.12, 0.87], [-2.2, 0.8], [-2.25, 0.72], [-2.2825, 0.6],
  ],
  // Cab-forward canopy: raked windshield, roof peak just behind the middle, then the flying
  // buttresses sloping down to the rear deck.
  cabin: [
    [1.08, 0.79, 0.8], [1.0, 0.85, 0.76], [0.9, 0.894, 0.72], [0.8, 0.937, 0.68], [0.7, 0.979, 0.645], [0.6, 1.018, 0.615],
    [0.5, 1.058, 0.59], [0.4, 1.095, 0.57], [0.3, 1.135, 0.555], [0.2, 1.162, 0.545], [0.1, 1.178, 0.54], [0.0, 1.185, 0.54],
    [-0.1, 1.186, 0.54], [-0.2, 1.182, 0.545], [-0.3, 1.176, 0.555], [-0.4, 1.166, 0.57], [-0.5, 1.155, 0.6], [-0.6, 1.14, 0.63],
    [-0.7, 1.13, 0.66], [-0.8, 1.11, 0.69], [-0.9, 1.083, 0.72], [-1.0, 1.054, 0.74], [-1.1, 1.026, 0.75], [-1.2, 1.0, 0.75],
    [-1.3, 0.975, 0.74], [-1.4, 0.958, 0.72],
  ],
  // Side glass from the A pillar back to a point where the rising belt meets the roof.
  windows: { belt: 0.0, top: 0.075, bands: [{ u0: 0.62, u1: -0.5, k0: 0.85, k1: 3.0 }], kick: [[0.62, 0], [0.1, 0.02], [-0.2, 0.045], [-0.5, 0.09]] },
  windshield: [1.04, 0.12], backlight: [-0.95, -1.38], glassFrame: true,
  rim: { n: 5, style: 'split', split: 0.12, spoke: 0.048, color: 0xa9adb3, size: 0.76 },
  doors: [0.74, -0.46], handles: [-0.32],
  stats: { top: 1.36, accel: 1.5, grip: 1.2 },
  details(c) {
    // Headlights: the dark almond lens on the outside, the white running-light blade at its inner
    // end and the small brake-air intake under the blade (measured on ferrari.com's front photo).
    c.front('lens', [[0.7, 0.583], [0.78, 0.6], [0.845, 0.604], [0.86, 0.57], [0.845, 0.53], [0.76, 0.52], [0.68, 0.535]], 0.013);
    c.front('head', [[0.5, 0.508], [0.6, 0.538], [0.71, 0.582], [0.72, 0.565], [0.62, 0.52], [0.52, 0.494]], 0.017);
    c.front('dark', [[0.53, 0.49], [0.63, 0.515], [0.7, 0.545], [0.7, 0.52], [0.6, 0.488], [0.55, 0.478]], 0.014);
    // The recessed full-width black mesh mouth under the body-coloured upper lip, rising at the
    // corners into the brake-cooling intakes; body-coloured chin below it in the middle.
    c.frontMid('grille', [[-0.74, 0.3], [-0.6, 0.27], [0.6, 0.27], [0.74, 0.3], [0.75, 0.4], [0.68, 0.41], [0.3, 0.405], [-0.3, 0.405], [-0.68, 0.41], [-0.75, 0.4]], 0.012);
    c.frontMid('paint', [[-0.3, 0.27], [0.3, 0.27], [0.24, 0.3], [-0.24, 0.3]], 0.016);
    c.frontMid('dark', [[-0.8, 0.19], [0.8, 0.19], [0.78, 0.225], [-0.78, 0.225]], 0.014);
    // The yellow Ferrari shield on the nose.
    c.frontMid('amber', [[-0.02, 0.495], [0.02, 0.495], [0.022, 0.53], [0.0, 0.537], [-0.022, 0.53]], 0.016);
    // Rear: the black band with the spoiler across the top of the tail, slim tail lights at its ends.
    c.rearMid('dark', [[-0.88, 0.72], [0.88, 0.72], [0.86, 0.8], [-0.86, 0.8]], 0.01);
    c.rear('tail', [[0.6, 0.762], [0.86, 0.765], [0.87, 0.78], [0.6, 0.777]], 0.014);
    c.rear('tail', [[0.62, 0.75], [0.66, 0.725], [0.82, 0.725], [0.86, 0.75]], 0.013);
    // Black vents at the rear corners, under the tail lights.
    c.rear('dark', [[0.845, 0.665], [0.9, 0.665], [0.905, 0.56], [0.86, 0.565]], 0.011);
    // The wide mesh band across the rear with the big single central exhaust, perforated grilles
    // above it and the prancing horse in the middle.
    c.rearMid('grille', [[-0.72, 0.42], [-0.5, 0.39], [0.5, 0.39], [0.72, 0.42], [0.77, 0.5], [0.7, 0.575], [-0.7, 0.575], [-0.77, 0.5]], 0.012);
    c.rear('grille', [[0.28, 0.58], [0.68, 0.58], [0.75, 0.625], [0.32, 0.63]], 0.012);
    c.rearMid('chrome', [[-0.2, 0.435], [0.2, 0.435], [0.235, 0.565], [-0.235, 0.565]], 0.016);
    c.rearMid('dark', [[-0.18, 0.45], [0.18, 0.45], [0.21, 0.55], [-0.21, 0.55]], 0.019);
    c.rearMid('chrome', [[-0.02, 0.645], [0.02, 0.645], [0.02, 0.695], [-0.02, 0.695]], 0.016);
    // The "296 GTB" plate holder in the lower bumper, the diffuser below it.
    c.rearMid('dark', [[-0.92, 0.12], [0.92, 0.12], [0.9, 0.3], [0.3, 0.26], [-0.3, 0.26], [-0.9, 0.3]], 0.01);
    c.rear('tail', rect(0.3, 0.2, 0.45, 0.22), 0.014);
    c.plate(0.31);
    // The air intake slot on the rear fender, in front of the rear wheel.
    c.side('dark', [[-0.74, 0.9], [-0.66, 0.915], [-0.54, 0.68], [-0.62, 0.64]], 0.006);
  },
};
