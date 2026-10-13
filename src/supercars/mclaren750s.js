// McLaren 750S coupe (mid-engine twin-turbo V8), as on mclaren.com in Oct 2026.
// Official sizes (McLaren press site technical specification): 4,569 long, 1,930 wide without
// mirrors (2,161 with), 1,196 tall, wheelbase 2,670, track 1,680 front / 1,629 rear; 19 x 9J wheels
// with 245/35 R19 tyres in front, 20 x 11J with 305/30 R20 at the back.
// The shape was measured off McLaren's own 3D configurator (configurator.mclaren.com): its car was
// photographed from 60 exact camera positions and its outline turned into a 3D hull; lights,
// intakes and lines were traced from the same pictures.
import { rect, ellipse } from './_shape.js';

export default {
  brand: 'McLaren', name: '750S', color: 0xff7f11, super: true,
  desc: 'Featherweight twin-turbo V8 in papaya orange.',
  len: 4.569, width: 1.93, wheelR: 0.327, tireW: 0.245, rearWheel: { r: 0.3455, w: 0.305 },
  axles: [1.21, -1.46], round: 0.32, nose: 0.1, tail: 0.05, greenhouse: 'glass', wrap: 0.45,
  section: { shoulder: 0.39, belt: 0.1, tuck: 0.06, crease: 2.0, crown: 0.0, gap: 0.045, rocker: false, faceFade: true },
  // Low pointed nose rising in one sweep to the windshield; the body's top then runs along the
  // door tops and the rear haunches to the wide tail and its stowed wing.
  side: [
    [2.2845, 0.2, 0.41], [2.26, 0.17, 0.45], [2.22, 0.16, 0.49], [2.14, 0.15, 0.53], [2.04, 0.135, 0.57], [1.94, 0.125, 0.615],
    [1.84, 0.12, 0.66], [1.74, 0.11, 0.695], [1.64, 0.105, 0.72], [1.54, 0.105, 0.74], [1.44, 0.105, 0.76], [1.34, 0.105, 0.77],
    [1.24, 0.105, 0.785], [1.12, 0.105, 0.79], [0.8, 0.105, 0.8], [0.4, 0.105, 0.825], [0.0, 0.105, 0.855], [-0.4, 0.105, 0.88],
    [-0.8, 0.105, 0.9], [-1.2, 0.11, 0.915], [-1.6, 0.12, 0.915], [-1.8, 0.135, 0.895], [-2.0, 0.15, 0.88], [-2.1, 0.21, 0.89],
    [-2.16, 0.26, 0.905], [-2.2, 0.36, 0.915], [-2.215, 0.42, 0.8], [-2.235, 0.45, 0.69], [-2.26, 0.47, 0.67], [-2.2845, 0.56, 0.63],
  ],
  // Pointed in plan at the nose, widest over the rear wheels, tucking in hard at the tail.
  plan: [
    [2.2845, 0.24], [2.27, 0.28], [2.25, 0.33], [2.22, 0.39], [2.18, 0.45], [2.14, 0.5], [2.1, 0.55],
    [2.04, 0.62], [1.99, 0.69], [1.94, 0.745], [1.89, 0.795], [1.84, 0.84], [1.79, 0.875], [1.74, 0.9], [1.69, 0.918], [1.59, 0.94],
    [1.49, 0.952], [1.39, 0.962], [1.21, 0.969], [0.9, 0.966], [-1.0, 0.966], [-1.46, 0.972], [-1.66, 0.968], [-1.76, 0.96],
    [-1.86, 0.945], [-1.91, 0.92], [-1.96, 0.875], [-2.01, 0.825], [-2.06, 0.78], [-2.11, 0.725], [-2.16, 0.66], [-2.21, 0.575],
    [-2.25, 0.45], [-2.2845, 0.3],
  ],
  // The canopy: a dark teardrop of glass and black roof from the windshield base over the cabin
  // and down the engine cover, narrower than the body ([u, roof, roof half-width, base half-width]).
  cabin: [
    [1.12, 0.8, 0.64, 0.72], [0.94, 0.9, 0.63, 0.78], [0.74, 0.99, 0.62, 0.82], [0.54, 1.08, 0.62, 0.85], [0.34, 1.15, 0.62, 0.86],
    [0.14, 1.19, 0.62, 0.86], [-0.06, 1.196, 0.6, 0.84], [-0.31, 1.175, 0.57, 0.8], [-0.61, 1.12, 0.52, 0.74], [-0.91, 1.05, 0.47, 0.66],
    [-1.21, 0.975, 0.38, 0.55], [-1.45, 0.93, 0.29, 0.44], [-1.7, 0.905, 0.2, 0.3], [-1.9, 0.89, 0.12, 0.16],
  ],
  windows: null,
  // 10-spoke ultra-lightweight forged wheels: five V-pairs in dark silver.
  rim: { n: 5, style: 'split', split: 0.2, spoke: 0.018, color: 0x4f545a, size: 0.74 },
  mirror: { u: 0.67, y: 0.0, out: 0.33, dy: -0.02 },
  stats: { top: 1.38, accel: 1.5, grip: 1.18 },
  details(c) {
    // Front: the "eye socket" headlights, a dark teardrop at each corner with two LED strips,
    // the slim corner intakes below them, two vents in the bonnet and the badge.
    c.front('dark', [[0.825, 0.627], [0.79, 0.626], [0.746, 0.62], [0.68, 0.598], [0.621, 0.572], [0.57, 0.548], [0.534, 0.528], [0.505, 0.506], [0.49, 0.483], [0.505, 0.462], [0.534, 0.446], [0.575, 0.434], [0.621, 0.428], [0.67, 0.423], [0.721, 0.421], [0.765, 0.427], [0.795, 0.438], [0.818, 0.462], [0.83, 0.495], [0.834, 0.527], [0.833, 0.557], [0.83, 0.595]], 0.012);
    c.front('head', [[0.815, 0.617], [0.733, 0.607], [0.621, 0.557], [0.621, 0.538], [0.733, 0.582], [0.815, 0.592]], 0.016);
    c.front('head', [[0.825, 0.528], [0.696, 0.508], [0.584, 0.475], [0.589, 0.458], [0.696, 0.483], [0.825, 0.503]], 0.016);
    c.front('dark', [[0.689, 0.266], [0.611, 0.29], [0.513, 0.31], [0.459, 0.295], [0.464, 0.242], [0.538, 0.222], [0.66, 0.215], [0.704, 0.237]], 0.012);
    c.front('grille', [[0.67, 0.259], [0.6, 0.28], [0.52, 0.296], [0.476, 0.285], [0.48, 0.25], [0.545, 0.234], [0.655, 0.228], [0.685, 0.243]], 0.015);
    c.front('dark', [[0.506, 0.712], [0.475, 0.712], [0.397, 0.606], [0.415, 0.601]], 0.012);
    c.frontMid('chrome', rect(-0.1, 0.493, 0.1, 0.516), 0.014);
    c.frontMid('dark', rect(-0.09, 0.497, 0.09, 0.512), 0.017);
    // The black splitter lip along the bottom of the nose.
    c.frontMid('dark', [[-0.82, 0.13], [0.82, 0.13], [0.82, 0.19], [0.48, 0.18], [0, 0.177], [-0.48, 0.18], [-0.82, 0.19]], 0.012);
    // Sides: the eye socket's end and the corner intake as they wrap round; the scoop down the
    // door (darker, below its crease); the sill intake ahead of the rear wheel; the vent behind it.
    c.side('dark', [[1.741, 0.64], [1.778, 0.617], [1.806, 0.595], [1.817, 0.572], [1.806, 0.55], [1.758, 0.561], [1.73, 0.583], [1.708, 0.628]]);
    c.side('head', [[1.79, 0.6], [1.81, 0.585], [1.81, 0.578], [1.785, 0.592]], 0.009);
    c.side('dark', [[1.623, 0.482], [1.677, 0.449], [1.713, 0.392], [1.739, 0.336], [1.741, 0.325], [1.736, 0.302], [1.713, 0.294], [1.665, 0.294], [1.66, 0.336], [1.646, 0.392], [1.629, 0.437], [1.612, 0.482]]);
    c.side('paint', [[0.885, 0.568], [0.769, 0.485], [0.631, 0.388], [0.493, 0.333], [0.355, 0.319], [0.078, 0.313], [-0.198, 0.324], [-0.475, 0.347], [-0.64, 0.36], [-0.7, 0.3], [-0.7, 0.17], [0.84, 0.17], [0.825, 0.3], [0.83, 0.42], [0.86, 0.5]], 0.003, 0.72);
    c.side('dark', [[-0.32, 0.28], [-0.44, 0.292], [-0.67, 0.232], [-0.65, 0.212], [-0.58, 0.195], [-0.5, 0.197]]);
    // Rear wheelarch vent: three dark slats following the back of the arch.
    for (const k of [0, 1]) c.side('dark', [[-1.85 - k * 0.035, 0.66 - k * 0.02], [-1.87 - k * 0.035, 0.66 - k * 0.02], [-1.92 - k * 0.035, 0.38 + k * 0.02], [-1.9 - k * 0.035, 0.38 + k * 0.02]]);
    // Door shut lines: the dihedral door's rear edge sweeps forward as it drops; the front
    // fender's rear edge behind the front wheel.
    const line = (pts, w = 0.006) => [...pts.map(([u, y]) => [u + w, y]), ...pts.slice().reverse().map(([u, y]) => [u - w, y])];
    c.side('dark', line([[-0.336, 0.9], [-0.309, 0.789], [-0.253, 0.623], [-0.198, 0.485], [-0.157, 0.347], [-0.121, 0.17]]), 0.004);
    c.side('dark', line([[0.921, 0.72], [0.885, 0.664], [0.857, 0.617], [0.833, 0.568]]), 0.004);
    // Rear: slim tail lights over the full-width mesh, the high central exhaust with the black
    // pylon of the wing above it, black diffuser between body-coloured corners, reflectors.
    c.rear('tail', [[0.372, 0.785], [0.435, 0.806], [0.646, 0.813], [0.68, 0.821], [0.734, 0.821], [0.751, 0.806], [0.771, 0.791], [0.788, 0.777], [0.79, 0.769], [0.783, 0.754], [0.758, 0.74], [0.732, 0.74], [0.7, 0.754], [0.678, 0.762], [0.382, 0.769]], 0.014, 0.26);
    c.rear('grille', [[0.15, 0.75], [0.45, 0.756], [0.73, 0.756], [0.78, 0.73], [0.73, 0.688], [0.49, 0.667], [0.15, 0.662]], 0.012, 0.26);
    c.rearMid('chrome', ellipse(0, 0.734, 0.15, 0.078, 28), 0.018, 0.15);
    c.rearMid('dark', ellipse(0, 0.734, 0.124, 0.06, 28), 0.022, 0.15);
    for (const s of [-1, 1]) c.rearMid('chrome', ellipse(s * 0.058, 0.73, 0.04, 0.036, 16), 0.024, 0.15);
    c.rearMid('dark', rect(-0.16, 0.812, 0.16, 0.875), 0.012, 0.15);
    // The wing's trailing edge with a shadow gap under it, over the tail lights.
    c.rear('dark', [[0.16, 0.858], [0.45, 0.85], [0.7, 0.838], [0.8, 0.815], [0.84, 0.79], [0.8, 0.8], [0.7, 0.822], [0.45, 0.834], [0.16, 0.842]], 0.012, 0.3);
    // Black lower bumper and diffuser between body-coloured corners, with the corner vents.
    c.rearMid('dark', [[-0.62, 0.62], [0.62, 0.62], [0.6, 0.45], [0.58, 0.38], [-0.58, 0.38], [-0.6, 0.45]], 0.01, 0.3);
    c.box('dark', 0, 0.27, 2.08, 0.92, 0.2, 0.26);
    for (const x of [-0.3, -0.1, 0.1, 0.3]) c.box('dark', x, 0.24, 2.19, 0.02, 0.14, 0.12);
    c.rear('dark', [[0.64, 0.46], [0.76, 0.46], [0.77, 0.31], [0.64, 0.31]], 0.012, 0.3);
    c.rear('tail', rect(0.314, 0.435, 0.448, 0.459), 0.016, 0.15);
    c.plate(0.52);
  },
};
