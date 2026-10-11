// Supercars for the garage (the owner asked for "fancy cars like 跑车", 2026-10-10). Each car
// is its own module in src/supercars/, in the same format as CAR_MODELS in cars.js (see the
// top of that file); cars.js merges them into CAR_MODELS. `super: true` puts a car in the
// garage's Supercars row and keeps it out of traffic. Engines and horns: ENGINES and HORNS
// in sound.js.
import revuelto from './supercars/revuelto.js';
import ferrari296 from './supercars/ferrari296.js';
import porsche911 from './supercars/porsche911.js';
import mclaren750s from './supercars/mclaren750s.js';

export const SUPERCARS = { revuelto, ferrari296, porsche911, mclaren750s };
