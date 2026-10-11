// Porsche 911 Turbo S (rear-engine flat six, all-wheel drive). Stand-in body at its real size
// until it is modelled from Porsche's official photos and specifications.
import { sportsBody, standInDetails } from './_shape.js';

export default {
  brand: 'Porsche', name: '911 Turbo S', color: 0xc0c3c7, super: true,
  desc: 'All-wheel-drive launch rocket. Nothing leaves the lights faster.',
  ...sportsBody({ len: 4.535, width: 1.9, height: 1.303, wheelbase: 2.45, wheelR: 0.345, tireW: 0.28, mid: false }),
  rim: { n: 5, style: 'split', color: 0x55595f },
  stats: { top: 1.34, accel: 1.6, grip: 1.25 },
  details: standInDetails,
};
