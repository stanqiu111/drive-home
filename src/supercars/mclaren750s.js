// McLaren 750S (mid-engine twin-turbo V8). Stand-in body at its real size until it is
// modelled from McLaren's official photos and specifications.
import { sportsBody, standInDetails } from './_shape.js';

export default {
  brand: 'McLaren', name: '750S', color: 0xff7f11, super: true,
  desc: 'Featherweight twin-turbo V8 in papaya orange.',
  ...sportsBody({ len: 4.569, width: 1.93, height: 1.196, wheelbase: 2.67, wheelR: 0.345, tireW: 0.29 }),
  rim: { n: 5, style: 'aero', color: 0x3a3d42 },
  stats: { top: 1.38, accel: 1.5, grip: 1.18 },
  details: standInDetails,
};
