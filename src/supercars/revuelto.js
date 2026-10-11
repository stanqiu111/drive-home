// Lamborghini Revuelto (the V12 hybrid flagship). Stand-in body at its real size until it is
// modelled from Lamborghini's official photos and specifications.
import { sportsBody, standInDetails } from './_shape.js';

export default {
  brand: 'Lamborghini', name: 'Revuelto', color: 0x8ccf2a, super: true,
  desc: 'V12 hybrid, scissor doors, 1001 hp. Wild.',
  ...sportsBody({ len: 4.947, width: 2.033, height: 1.16, wheelbase: 2.779, wheelR: 0.36, tireW: 0.31 }),
  rim: { n: 5, style: 'aero', color: 0x2a2c30 },
  stats: { top: 1.4, accel: 1.55, grip: 1.15 },
  details: standInDetails,
};
