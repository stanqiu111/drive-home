// Ferrari 296 GTB (mid-engine V6 hybrid). Stand-in body at its real size until it is modelled
// from Ferrari's official photos and specifications.
import { sportsBody, standInDetails } from './_shape.js';

export default {
  brand: 'Ferrari', name: '296 GTB', color: 0xd40000, super: true,
  desc: 'Mid-engine V6 hybrid. Rosso Corsa, of course.',
  ...sportsBody({ len: 4.565, width: 1.958, height: 1.187, wheelbase: 2.6, wheelR: 0.345, tireW: 0.28 }),
  rim: { n: 5, style: 'twin', color: 0x9aa0a6 },
  stats: { top: 1.36, accel: 1.5, grip: 1.2 },
  details: standInDetails,
};
