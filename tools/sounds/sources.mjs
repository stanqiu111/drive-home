// Every recording the game's sounds are cut from, and how each sample is cut.
// All are CC0 (public domain) on Freesound.org: free to bundle, no credit required (we credit
// them anyway in CLAUDE.md and the menu). `page` is the sound's Freesound page (license and
// description); `preview` is its public preview MP3, which needs no account or key.
export const SOURCES = {
  i4_on_2500: { id: 162509, author: 'Chippy569', page: 'https://freesound.org/people/Chippy569/sounds/162509/', title: '19_2500_D6.wav', what: 'Mercedes-Benz 190E 2.3-16V (inline four) on a dyno, ~2500 rpm, full load, exhaust mic', preview: 'https://cdn.freesound.org/previews/162/162509_1277206-hq.mp3' },
  i4_sweep_up: { id: 162501, author: 'Chippy569', page: 'https://freesound.org/people/Chippy569/sounds/162501/', title: '17_ShortSweep_D6.wav', what: 'same car, full-throttle sweep 3000-7000 rpm, exhaust mic', preview: 'https://cdn.freesound.org/previews/162/162501_1277206-hq.mp3' },
  i4_on_6500: { id: 162512, author: 'Chippy569', page: 'https://freesound.org/people/Chippy569/sounds/162512/', title: '20_6500_D6.wav', what: 'same car, ~6200 rpm, full load, exhaust mic', preview: 'https://cdn.freesound.org/previews/162/162512_1277206-hq.mp3' },
  i4_off_idle: { id: 162515, author: 'Chippy569', page: 'https://freesound.org/people/Chippy569/sounds/162515/', title: '21_500_D6.wav', what: 'same car, idle (~1000 rpm), no load, exhaust mic', preview: 'https://cdn.freesound.org/previews/162/162515_1277206-hq.mp3' },
  i4_off_2500: { id: 162518, author: 'Chippy569', page: 'https://freesound.org/people/Chippy569/sounds/162518/', title: '21_2500_D6.wav', what: 'same car, ~2400 rpm, no load, exhaust mic', preview: 'https://cdn.freesound.org/previews/162/162518_1277206-hq.mp3' },
  i4_sweep_down: { id: 162504, author: 'Chippy569', page: 'https://freesound.org/people/Chippy569/sounds/162504/', title: '17_MedSweep_D6.wav', what: 'same car, coasting down from 6200 rpm, exhaust mic', preview: 'https://cdn.freesound.org/previews/162/162504_1277206-hq.mp3' },
  i4_off_6500: { id: 162521, author: 'Chippy569', page: 'https://freesound.org/people/Chippy569/sounds/162521/', title: '21_6500_D6.wav', what: 'same car, ~6300 rpm, no load, exhaust mic', preview: 'https://cdn.freesound.org/previews/162/162521_1277206-hq.mp3' },
  boxer_dyno: { id: 183654, author: 'dezoris', page: 'https://freesound.org/people/dezoris/sounds/183654/', title: 'DynoJet Scion FR-S', what: 'Scion FR-S (Subaru FA20 flat four) dyno pull 2000-7400 rpm, exhaust + engine bay', preview: 'https://cdn.freesound.org/previews/183/183654_89652-hq.mp3' },
  boxer_idle: { id: 273334, author: 'ulose2piranha', page: 'https://freesound.org/people/ulose2piranha/sounds/273334/', title: 'WRX - Exhaust sounds', what: '2003 Subaru Impreza WRX (flat four) idling and revving', preview: 'https://cdn.freesound.org/previews/273/273334_4168822-hq.mp3' },
  six_dyno: { id: 496171, author: 'editboy23', page: 'https://freesound.org/people/editboy23/sounds/496171/', title: 'Import car revs on Chassis Dyno with Turbo.wav', what: 'Toyota Supra (2JZ straight six, turbo) on a chassis dyno, with turbo whistle', preview: 'https://cdn.freesound.org/previews/496/496171_1784475-hq.mp3' },
  squeal: { id: 71739, author: 'audible-edge', page: 'https://freesound.org/people/audible-edge/sounds/71739/', title: 'Chrysler LHS tire squeal 04 (04-25-2009).wav', what: 'tyres squealing as a car circles the mic', preview: 'https://cdn.freesound.org/previews/71/71739_995351-hq.mp3' },
  afterburner: { id: 413312, author: 'TiesWijnen', page: 'https://freesound.org/people/TiesWijnen/sounds/413312/', title: 'Afterburner', what: 'turbojet engine afterburner', preview: 'https://cdn.freesound.org/previews/413/413312_1511977-hq.mp3' },
  tesla: { id: 761685, author: 'justVova', page: 'https://freesound.org/people/justVova/sounds/761685/', title: 'Acceleration of an electric car', what: 'Tesla Model S Plaid at full throttle', preview: 'https://cdn.freesound.org/previews/761/761685_13088347-hq.mp3' },
  drill: { id: 390162, author: 'megashroom', page: 'https://freesound.org/people/megashroom/sounds/390162/', title: 'DeWalt 18V Cordless Combi Drill 170427_1452.wav', what: 'brushless electric motor spinning', preview: 'https://cdn.freesound.org/previews/390/390162_1830834-hq.mp3' },
  air: { id: 131302, author: 'reg7783', page: 'https://freesound.org/people/reg7783/sounds/131302/', title: 'release_air_pffft.wav', what: 'compressed-air line released (stands in for a turbo blow-off valve)', preview: 'https://cdn.freesound.org/previews/131/131302_2394357-hq.mp3' },
};

// Engine loops. Each is `cycles` engine cycles (2 crank turns) centred at `t` seconds in the
// source, pitch-flattened to a steady rpm and looped; `extra` cycles are crossfaded into the
// start so the loop is seamless. `rpm` is a starting guess for the tracker (the measured value
// is written to the manifest). `as` scales the rpm used in the game (an idle borrowed by
// another engine type).
export const PACKS = {
  i4: {
    file: 'engine-i4.m4a',
    loops: [
      { id: 'idle', load: 'off', src: 'i4_off_idle', t: 4.0, rpm: 1030, cycles: 17, extra: 2, range: [0.2, 8.1], track: { cycles: 2.5, tol: 0.04 } },
      { id: 'on_2500', load: 'on', src: 'i4_on_2500', t: 2.4, rpm: 2555, cycles: 21, extra: 3, range: [0.2, 4.6] },
      { id: 'on_3700', load: 'on', src: 'i4_sweep_up', t: 0.95, rpm: 3650, cycles: 8, extra: 2, range: [0.65, 2.3] },
      { id: 'on_4900', load: 'on', src: 'i4_sweep_up', t: 1.35, rpm: 4800, cycles: 10, extra: 2, range: [0.65, 2.3] },
      { id: 'on_6200', load: 'on', src: 'i4_on_6500', t: 0.8, rpm: 6220, cycles: 50, extra: 6, range: [0.05, 1.6] },
      { id: 'off_2400', load: 'off', src: 'i4_off_2500', t: 2.0, rpm: 2429, cycles: 20, extra: 3, range: [0.1, 3.9] },
      { id: 'off_4300', load: 'off', src: 'i4_sweep_down', t: 3.0, rpm: 4296, cycles: 16, extra: 3, range: [1.0, 7.0] },
      { id: 'off_6300', load: 'off', src: 'i4_off_6500', t: 0.95, rpm: 6290, cycles: 48, extra: 6, range: [0.05, 1.88] },
    ],
  },
  b4: {
    file: 'engine-boxer.m4a',
    loops: [
      { id: 'idle', load: 'off', src: 'boxer_idle', t: 3.3, rpm: 720, cycles: 8, extra: 1, range: [0.3, 7.0], track: { cycles: 2.5, tol: 0.04 } },
      { id: 'on_2500', load: 'on', src: 'boxer_dyno', t: 6.25, rpm: 2500, cycles: 16, extra: 3, range: [4.5, 8.5] },
      { id: 'on_3500', load: 'on', src: 'boxer_dyno', t: 9.55, rpm: 3500, cycles: 22, extra: 3, range: [7.5, 11.5] },
      { id: 'on_4400', load: 'on', src: 'boxer_dyno', t: 13.0, rpm: 4440, cycles: 28, extra: 4, range: [11, 15] },
      { id: 'on_5500', load: 'on', src: 'boxer_dyno', t: 16.4, rpm: 5500, cycles: 34, extra: 4, range: [14.5, 18.5] },
      { id: 'on_6500', load: 'on', src: 'boxer_dyno', t: 19.6, rpm: 6490, cycles: 40, extra: 5, range: [17.5, 21.5] },
      { id: 'on_7300', load: 'on', src: 'boxer_dyno', t: 22.5, rpm: 7300, cycles: 40, extra: 5, range: [20.5, 23.2] },
    ],
  },
  i6: {
    file: 'engine-six.m4a',
    loops: [
      { id: 'on_3300', load: 'on', src: 'six_dyno', t: 12.6, rpm: 3270, cycles: 26, extra: 3, range: [11.8, 18] },
      { id: 'on_4300', load: 'on', src: 'six_dyno', t: 20.75, rpm: 4311, cycles: 16, extra: 3, range: [18.5, 22.7] },
      { id: 'on_5400', load: 'on', src: 'six_dyno', t: 22.48, rpm: 5400, cycles: 15, extra: 3, range: [21.2, 22.9] },
      { id: 'on_6900', load: 'on', src: 'six_dyno', t: 23.75, rpm: 6940, cycles: 17, extra: 3, range: [23.3, 24.9] },
    ],
  },
};

// Other loops and one-shots: a plain cut of `len` seconds at `t0`, band-limited to [hp, lp] Hz,
// normalised to `db` RMS; `even: [window s, strength]` evens out level swings inside the loop.
export const FX = {
  file: 'effects.m4a',
  items: [
    { id: 'whistle', src: 'six_dyno', t0: 24.35, len: 0.9, xf: 0.15, hp: 6500, lp: 14500, db: -20, even: [0.2, 0.8] }, // turbo whistle at full boost (~10.5 kHz)
    { id: 'blowoff', src: 'air', t0: 0.12, len: 0.9, oneShot: true, fadeIn: 0.004, fadeOut: 0.3, hp: 300, lp: 14500, db: -16 },
    { id: 'squeal', src: 'squeal', t0: 4.4, len: 2.4, xf: 0.35, hp: 350, lp: 9000, db: -18, even: [0.3, 0.6] },
    { id: 'rocket', src: 'afterburner', t0: 1.9, len: 2.6, xf: 0.4, hp: 25, lp: 14000, db: -18, even: [0.3, 0.5] },
    { id: 'ev', src: 'tesla', t0: 2.6, len: 2.0, xf: 0.4, hp: 25, lp: 14000, db: -18, even: [0.3, 0.7] },
    { id: 'ebike', src: 'drill', t0: 5.95, len: 1.0, xf: 0.2, hp: 150, lp: 7000, db: -20 },
  ],
};
