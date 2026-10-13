// Sound for Drive Home, made with the Web Audio API.
//
// Engines, the turbo whistle and blow-off, tyre squeal, the Tesla's drive sound, the E-bike
// motor and the Rocket's roar are real recordings (public/sounds/*.m4a, built by
// tools/sounds/build-sounds.mjs, listed in src/sound-samples.js). Combustion engines work the
// way racing games build them: steady-rpm loops recorded on and off throttle, each pitched
// around its own rpm and crossfaded by the simulated gearbox's rpm and the throttle. The
// files load after the first click or key; until then, or if they fail, every voice falls
// back to the synthesised one below, so the game never waits for audio. Everything else
// (event sounds, horns, wind, fun rides) is synthesised: oscillators, filtered noise, envelopes.
//
//   sound.play(name, opts)      one-shot effects, see SFX below (e.g. play('crash', { strength: 0.8 }))
//   sound.update(dt, p)         once per frame: engine, wind, tyre squeal, turbo whistle, nitro whoosh
//   sound.setVehicle(id)        engine voice and horn for a car or ride id (cars.js / funrides.js)
//   sound.hornStart() / hornStop()
//   sound.setMuted(bool) / toggleMute() / bindButton(el) / muted
//   sound.useRecordings         false = synthesised engines only (sound studio comparison)
//
// The AudioContext is created on the first user gesture, suspended while the tab is hidden
// or the sound is muted, and nothing throws if Web Audio is missing. Event counters
// (sound.counts) always tick, even without audio, so tests can check the wiring.
import { SAMPLE_PACKS } from './sound-samples.js';

const SAMPLE_URL = `${import.meta.env?.BASE_URL ?? '/'}sounds/`;
// Shown in the menu credits. Every recording is CC0 (tools/sounds/sources.mjs lists them).
export const SOUND_CREDITS = 'Engine, turbo and tyre sounds: recordings by Chippy569, dezoris, ulose2piranha, editboy23, PritzProductions, victormalloy, cheesepuff, audible-edge, TiesWijnen, justVova, megashroom and reg7783 on Freesound.org (CC0)';
const MASTER_VOL = 0.6;
const MUTE_KEY = 'driveHome.muted';
const MAX_VOICES = 14; // simultaneous one-shots
const ENGINE_VOL = 0.25;
const UI_VOL = 0.55;
const WIND_VOL = 1.2;
const SQUEAL_VOL = 0.5;
const HISS_VOL = 0.4;
const REC_ENGINE_VOL = 3.2; // recorded engine loops are mastered at -18 dB RMS
const REC_SQUEAL_VOL = 0.4;
const WHISTLE_VOL = 0.4;
const BLOWOFF_VOL = 0.7;
// Gear tops as a share of the car's top speed: 7 gears so nitro and turbo still have room.
const GEAR_TOP = [0.24, 0.4, 0.58, 0.8, 1.08, 1.45, 2.1];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mtof = (n) => 440 * 2 ** ((n - 69) / 12);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const noop = () => {};

// ---------- building blocks ----------

// Shared noise buffers (2 s loops) and the freewheel tick loop, made once per context.
const bufferCache = new WeakMap();
function buffersFor(ctx) {
  let b = bufferCache.get(ctx);
  if (b) return b;
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 2);
  let seed = 22222;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const make = () => ctx.createBuffer(1, n, sr);
  const white = make();
  const pink = make();
  const brown = make();
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  const br = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const x = rnd();
    w[i] = x;
    // Paul Kellet's pink filter.
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362;
    b6 = x * 0.115926;
    last = (last + 0.02 * x) / 1.02;
    br[i] = last;
  }
  for (const d of [w, p, br]) seamless(d);
  // Freewheel ratchet: 4 soft clicks in 0.4 s; the loop's playback rate sets the tick rate.
  const tn = Math.floor(sr * 0.4);
  const tick = ctx.createBuffer(1, tn, sr);
  const td = tick.getChannelData(0);
  const amps = [1, 0.75, 0.9, 0.7];
  for (let k = 0; k < 4; k++) {
    const o = Math.floor((k * tn) / 4);
    for (let i = 0; i < sr * 0.008; i++) {
      const tt = i / sr;
      const att = tt < 0.0003 ? tt / 0.0003 : 1;
      td[o + i] = amps[k] * att * Math.exp(-tt / 0.0014) * (0.7 * Math.sin(2 * Math.PI * 2100 * tt) + 0.3 * rnd());
    }
  }
  b = { white, pink, brown, tick };
  bufferCache.set(ctx, b);
  return b;
}

// Makes a noise buffer loop without a jump at the seam, centres it and scales it to ±0.9.
function seamless(x) {
  const n = x.length;
  const d = x[n - 1] - x[0];
  let mean = 0;
  for (let i = 0; i < n; i++) {
    x[i] -= (d * i) / (n - 1);
    mean += x[i];
  }
  mean /= n;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    x[i] -= mean;
    peak = Math.max(peak, Math.abs(x[i]));
  }
  const k = 0.9 / peak;
  for (let i = 0; i < n; i++) x[i] *= k;
}

const curves = new Map();
function softClip(k) {
  if (curves.has(k)) return curves.get(k);
  const c = new Float32Array(1024);
  const norm = Math.tanh(k);
  for (let i = 0; i < c.length; i++) c[i] = Math.tanh(k * ((i / (c.length - 1)) * 2 - 1)) / norm;
  curves.set(k, c);
  return c;
}

// Smoothly moves a continuous parameter. Skips tiny changes so a steady car makes no
// automation events at all.
function ramp(param, v, t, tc = 0.04) {
  const last = param._last;
  if (last !== undefined && Math.abs(v - last) <= Math.abs(last) * 0.003 + 1e-4) return;
  param._last = v;
  param.setTargetAtTime(v, t, tc);
}

// Attack-hold-release envelope that starts and ends at exactly 0 (no clicks).
// Returns the time it is silent again.
function env(param, t, peak, a, h, r) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (h > 0) param.setValueAtTime(peak, t + a + h);
  param.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-6), t + a + h + r);
  param.linearRampToValueAtTime(0, t + a + h + r + 0.008);
  return t + a + h + r + 0.01;
}

// A group of nodes that live and die together. One-shots get a fresh Voice; the engine
// and ambience keep theirs. dispose() stops every source and disconnects every node.
class Voice {
  constructor(ctx, dest, bufs, level = 1) {
    this.ctx = ctx;
    this.bufs = bufs;
    this.rec = null; // Samples, for one-shots that use a recording
    this.nodes = [];
    this.srcs = [];
    this.out = this.gain(level);
    this.out.connect(dest);
  }

  add(n) {
    this.nodes.push(n);
    return n;
  }

  gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return this.add(g);
  }

  osc(type, f, t0, t1) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start(t0);
    if (t1 !== undefined) o.stop(t1);
    this.srcs.push(o);
    return this.add(o);
  }

  noise(kind, t0, t1, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.bufs[kind];
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t0, Math.random() * (s.buffer.duration * 0.9));
    if (t1 !== undefined) s.stop(t1);
    this.srcs.push(s);
    return this.add(s);
  }

  filter(type, f, q = 0.7) {
    const n = this.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return this.add(n);
  }

  shaper(k) {
    const n = this.ctx.createWaveShaper();
    n.curve = softClip(k);
    return this.add(n);
  }

  pan(p = 0) {
    const c = this.ctx;
    const n = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    if (n.pan) n.pan.value = p;
    return this.add(n);
  }

  // A recorded loop (s = samples.get(...)), starting at a random point inside it.
  loop(s, t, rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = s.buf;
    src.loop = true;
    src.loopStart = s.item.at;
    src.loopEnd = s.item.at + s.item.len;
    src.playbackRate.value = rate;
    src.start(t, s.item.at + Math.random() * s.item.len * 0.9);
    this.srcs.push(src);
    return this.add(src);
  }

  // A recorded one-shot, played once from its place in the pack.
  shot(s, t, rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = rate;
    src.start(t, s.item.at, s.item.len);
    this.srcs.push(src);
    return this.add(src);
  }

  dispose() {
    for (const s of this.srcs) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    for (const n of this.nodes) {
      try { n.disconnect(); } catch { /* already gone */ }
    }
    this.srcs.length = 0;
    this.nodes.length = 0;
  }
}

// ---------- recorded samples ----------
// Fetches and decodes the sample packs (one AAC file each, see sound-samples.js) once the
// AudioContext exists. A pack that fails stays missing and its voices keep the synthesised
// sound; nothing waits for this.
const ITEMS = Object.fromEntries(Object.entries(SAMPLE_PACKS).map(([k, p]) => [k, Object.fromEntries(p.items.map((it) => [it.id, it]))]));

function decode(ctx, data) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

class Samples {
  constructor() {
    this.buffers = Object.create(null);
    this.failed = Object.create(null);
    this.state = 'not loaded';
    this.ms = 0;
    this.promise = null;
    this.onPack = noop; // called with the pack id when one is ready
  }

  load(ctx) {
    if (this.promise) return this.promise;
    this.state = 'loading';
    const t0 = performance.now();
    const ids = Object.keys(SAMPLE_PACKS);
    this.promise = Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch(SAMPLE_URL + SAMPLE_PACKS[id].file);
        if (!res.ok) throw new Error(`${SAMPLE_PACKS[id].file}: HTTP ${res.status}`);
        this.buffers[id] = await decode(ctx, await res.arrayBuffer());
      } catch (e) {
        this.failed[id] = String(e?.message ?? e);
        return;
      }
      try { this.onPack(id); } catch (e) { this.failed[`${id} (voice)`] = String(e?.message ?? e); }
    })).then(() => {
      const ok = Object.keys(this.buffers).length;
      this.state = ok === ids.length ? 'ready' : ok ? 'partial' : 'failed';
      this.ms = Math.round(performance.now() - t0);
    });
    return this.promise;
  }

  // { buf, item } for a pack's item, or null while it is missing.
  get(pack, id) {
    const buf = this.buffers[pack];
    const item = ITEMS[pack]?.[id];
    return buf && item ? { buf, item } : null;
  }

  get debug() {
    return { state: this.state, loaded: Object.keys(this.buffers), failed: { ...this.failed }, ms: this.ms };
  }
}

// Oscillator through its own envelope into dest. Returns the oscillator (for pitch moves).
function tone(v, dest, type, f, t, peak, a, h, r) {
  const o = v.osc(type, f, t, t + a + h + r + 0.03);
  const g = v.gain();
  env(g.gain, t, peak, a, h, r);
  o.connect(g).connect(dest);
  return o;
}

// Filtered noise burst. Returns the first filter (for sweeps).
function burst(v, dest, kind, t, peak, a, h, r, type, f, q = 0.7) {
  const s = v.noise(kind, t, t + a + h + r + 0.03);
  const fl = v.filter(type, f, q);
  const g = v.gain();
  env(g.gain, t, peak, a, h, r);
  s.connect(fl).connect(g).connect(dest);
  return fl;
}

// Glockenspiel-like chime: a few inharmonic sine partials with short decays.
function chime(v, dest, f, t, peak, dur) {
  tone(v, dest, 'sine', f, t, peak, 0.002, 0, dur);
  if (f * 2.756 < 12000) tone(v, dest, 'sine', f * 2.756, t, peak * 0.3, 0.002, 0, dur * 0.4);
  if (f * 5.404 < 12000) tone(v, dest, 'sine', f * 5.404, t, peak * 0.1, 0.002, 0, dur * 0.2);
}

// Brassy note: two slightly detuned saws through a filter that opens on the attack.
function brass(v, dest, f, t, dur, peak) {
  const end = t + dur + 0.2;
  const o1 = v.osc('sawtooth', f, t, end);
  const o2 = v.osc('sawtooth', f, t, end);
  o2.detune.value = 9;
  const lp = v.filter('lowpass', 500, 1.2);
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.linearRampToValueAtTime(Math.min(5200, f * 6 + 600), t + 0.035);
  lp.frequency.setTargetAtTime(Math.min(3600, f * 3 + 500), t + 0.05, 0.12);
  const g = v.gain();
  env(g.gain, t, peak, 0.02, dur, 0.15);
  o1.connect(lp);
  o2.connect(lp);
  lp.connect(g).connect(dest);
}

// Short low "thump" (a sine dropping in pitch).
function kick(v, dest, t, f0, f1, peak, r) {
  const o = tone(v, dest, 'sine', f0, t, peak, 0.002, 0.01, r);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + r * 0.8);
}

// ---------- one-shot effects ----------
// Each takes (voice, start time, options) and returns the time it ends.
const SFX = {
  click(v, t) {
    const o = tone(v, v.out, 'sine', 1700, t, 0.4, 0.002, 0, 0.035);
    o.frequency.setValueAtTime(1700, t);
    o.frequency.exponentialRampToValueAtTime(950, t + 0.035);
    return t + 0.06;
  },

  beep(v, t) {
    tone(v, v.out, 'triangle', 659.26, t, 0.32, 0.004, 0.12, 0.1);
    tone(v, v.out, 'sine', 1318.5, t, 0.07, 0.004, 0.1, 0.08);
    return t + 0.26;
  },

  go(v, t) {
    for (const n of [76, 80, 83, 88]) tone(v, v.out, 'triangle', mtof(n), t, 0.11, 0.005, 0.3, 0.35);
    tone(v, v.out, 'sine', mtof(100), t, 0.04, 0.005, 0.2, 0.3);
    chime(v, v.out, mtof(100), t + 0.06, 0.06, 0.5);
    return t + 0.75;
  },

  // Nitro: a burst of gas (a real compressed-air recording once loaded) over a rising whoosh
  // and a soft thump.
  nitro(v, t) {
    const air = v.rec?.get('fx', 'blowoff');
    if (air) {
      const g = v.gain(0.75);
      v.shot(air, t, 1.15).connect(v.filter('highpass', 350)).connect(g).connect(v.out);
    }
    const bp = burst(v, v.out, 'pink', t, air ? 0.3 : 0.85, 0.07, 0.06, 0.45, 'bandpass', 380, 1.3);
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.3);
    bp.frequency.exponentialRampToValueAtTime(1300, t + 0.6);
    kick(v, v.out, t, 110, 48, 0.45, 0.22);
    return t + (air ? 0.82 : 0.65);
  },

  // Nitro can: two bright rising chime notes.
  can(v, t) {
    chime(v, v.out, mtof(84), t, 0.28, 0.35);
    chime(v, v.out, mtof(91), t + 0.075, 0.34, 0.5);
    tone(v, v.out, 'sine', mtof(103), t + 0.075, 0.04, 0.002, 0, 0.2);
    return t + 0.6;
  },

  // ? box: a quick sparkly arpeggio, like an item roulette.
  box(v, t) {
    [72, 76, 79, 84, 88, 91].forEach((n, i) => tone(v, v.out, 'triangle', mtof(n), t + i * 0.045, 0.21, 0.003, 0.02, 0.1));
    chime(v, v.out, mtof(96), t + 0.3, 0.13, 0.4);
    return t + 0.72;
  },

  // Power stingers.
  shield(v, t) {
    const trem = v.gain(0.75);
    const lfo = v.osc('sine', 9, t, t + 1);
    const lg = v.gain(0.25);
    lfo.connect(lg).connect(trem.gain);
    trem.connect(v.out);
    for (const n of [67, 71, 74, 79]) {
      tone(v, trem, 'sine', mtof(n), t, 0.075, 0.07, 0.25, 0.45).detune.value = -6;
      tone(v, trem, 'sine', mtof(n), t, 0.075, 0.07, 0.25, 0.45).detune.value = 6;
    }
    [91, 95, 98, 103].forEach((n, i) => chime(v, v.out, mtof(n), t + 0.02 + i * 0.05, 0.05, 0.35));
    return t + 0.95;
  },

  // Turbo power: a real turbo whistle spooling up fast (synthesised sweep before the
  // recordings load), a rush of air and a thump.
  turbo(v, t) {
    const w = v.rec?.get('fx', 'whistle');
    if (w) {
      const src = v.loop(w, t, 0.45);
      src.playbackRate.setValueAtTime(0.45, t);
      src.playbackRate.exponentialRampToValueAtTime(1.05, t + 0.5);
      src.stop(t + 0.85);
      const g = v.gain();
      env(g.gain, t, 0.45, 0.05, 0.4, 0.3);
      src.connect(g).connect(v.out);
    } else {
      const o = v.osc('sawtooth', 110, t, t + 0.8);
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(520, t + 0.45);
      const lp = v.filter('lowpass', 600, 2);
      lp.frequency.setValueAtTime(600, t);
      lp.frequency.exponentialRampToValueAtTime(4200, t + 0.45);
      const g = v.gain();
      env(g.gain, t, 0.22, 0.02, 0.28, 0.35);
      o.connect(lp).connect(g).connect(v.out);
    }
    const bp = burst(v, v.out, 'pink', t, 0.5, 0.05, 0.2, 0.35, 'bandpass', 500, 1.1);
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(3000, t + 0.45);
    kick(v, v.out, t, 95, 45, 0.45, 0.25);
    return t + 0.8;
  },

  fly(v, t) {
    const o = tone(v, v.out, 'sine', 520, t, 0.2, 0.03, 0.3, 0.32);
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(1560, t + 0.5);
    const o2 = tone(v, v.out, 'triangle', 780, t, 0.06, 0.03, 0.3, 0.3);
    o2.frequency.setValueAtTime(780, t);
    o2.frequency.exponentialRampToValueAtTime(2340, t + 0.5);
    const lfo = v.osc('sine', 13, t, t + 0.75);
    const lg = v.gain(45);
    lfo.connect(lg);
    lg.connect(o.detune);
    lg.connect(o2.detune);
    burst(v, v.out, 'pink', t, 0.3, 0.05, 0.1, 0.4, 'lowpass', 1500);
    return t + 0.8;
  },

  blast(v, t) {
    kick(v, v.out, t, 120, 32, 0.7, 0.7);
    const lp = burst(v, v.out, 'brown', t, 0.7, 0.004, 0.06, 0.9, 'lowpass', 900, 0.8);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 0.9);
    burst(v, v.out, 'white', t, 0.25, 0.002, 0, 0.07, 'highpass', 1500);
    chime(v, v.out, mtof(96), t + 0.08, 0.04, 0.4);
    return t + 1.05;
  },

  // Crash: thump + crunch + crumple + metal clank, plus glass for hard hits.
  crash(v, t, o) {
    const s = clamp(o.strength ?? 0.6, 0, 1);
    const k = 0.4 + 0.6 * s;
    const out = v.pan(clamp(o.pan ?? 0, -1, 1) * 0.5);
    out.connect(v.out);
    kick(v, out, t, 150, 42, 0.8 * k, 0.24 + 0.14 * s);
    // Crunch: band of white noise, top end rolled off so it isn't harsh.
    const soft = v.filter('lowpass', 4200);
    soft.connect(out);
    burst(v, soft, 'white', t, 0.4 * k, 0.002, 0.02 + 0.05 * s, 0.18 + 0.28 * s, 'bandpass', 1100, 0.7);
    // Crumple: brown noise chopped by a fast square LFO.
    const cr = v.noise('brown', t, t + 0.7);
    const cf = v.filter('bandpass', 520, 1);
    const am = v.gain(0.5);
    const lfo = v.osc('square', 26, t, t + 0.7);
    const lg = v.gain(0.5);
    lfo.connect(lg).connect(am.gain);
    const cg = v.gain();
    env(cg.gain, t, 0.55 * k, 0.01, 0.05, 0.22 + 0.25 * s);
    cr.connect(cf).connect(am).connect(cg).connect(out);
    for (const f of [587, 851, 1310]) tone(v, out, 'triangle', f * (1 - 0.12 * s), t + 0.005, 0.07 * k, 0.002, 0, 0.16 + 0.2 * s);
    if (s > 0.5) {
      for (let i = 0; i < 5; i++) tone(v, out, 'sine', rand(2600, 5000), t + 0.03 + i * 0.035 + rand(0, 0.02), 0.035, 0.002, 0, rand(0.08, 0.16));
    }
    return t + 0.6 + 0.4 * s;
  },

  // Smash: the Rocket / shield / turbo ploughing through a car. Punchy and happy, not hurt.
  smash(v, t, o) {
    const s = clamp(o.strength ?? 0.7, 0, 1);
    kick(v, v.out, t, 170, 48, 0.55 + 0.35 * s, 0.2);
    burst(v, v.out, 'white', t, 0.32, 0.002, 0.015, 0.1, 'bandpass', 1700, 0.9);
    const b = tone(v, v.out, 'triangle', 280, t, 0.2, 0.004, 0.04, 0.16);
    b.frequency.setValueAtTime(280, t);
    b.frequency.exponentialRampToValueAtTime(640, t + 0.1);
    const notes = [96, 100, 103, 108];
    for (let i = 0; i < 3; i++) chime(v, v.out, mtof(notes[(Math.random() * 4) | 0]), t + 0.04 + i * 0.04, 0.06, 0.25);
    return t + 0.5;
  },

  // A car whooshing past close by, panned to its side.
  passby(v, t, o) {
    const st = clamp(o.strength ?? 0.6, 0.2, 1);
    const p = clamp(o.pan ?? 0, -1, 1);
    const pan = v.pan(p * 0.5);
    if (pan.pan) {
      pan.pan.setValueAtTime(p * 0.5, t);
      pan.pan.linearRampToValueAtTime(p, t + 0.35);
    }
    pan.connect(v.out);
    const bp = burst(v, pan, 'pink', t, 2 * st, 0.12, 0, 0.32, 'bandpass', 1500, 1.1);
    bp.frequency.setValueAtTime(1500, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.45);
    return t + 0.5;
  },

  // The Rocket leaving the ground: a swelling roar.
  liftoff(v, t) {
    const lp = burst(v, v.out, 'brown', t, 0.95, 0.15, 0.4, 0.8, 'lowpass', 200, 0.9);
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(1800, t + 0.8);
    const o = v.osc('sawtooth', 55, t, t + 1.5);
    o.frequency.setValueAtTime(55, t);
    o.frequency.exponentialRampToValueAtTime(165, t + 0.9);
    const f = v.filter('lowpass', 600);
    const g = v.gain();
    env(g.gain, t, 0.22, 0.1, 0.45, 0.8);
    o.connect(f).connect(g).connect(v.out);
    burst(v, v.out, 'white', t, 0.08, 0.3, 0.3, 0.6, 'highpass', 3000);
    return t + 1.5;
  },

  finish(v, t) {
    const seq = [[67, 0, 0.07], [72, 0.12, 0.07], [76, 0.24, 0.07], [79, 0.36, 0.16], [76, 0.62, 0.07], [79, 0.74, 0.07]];
    for (const [n, at, d] of seq) brass(v, v.out, mtof(n), t + at, d, 0.075);
    for (const n of [72, 76, 79, 84]) brass(v, v.out, mtof(n), t + 0.86, 0.85, 0.06);
    for (const n of [84, 88, 91]) chime(v, v.out, mtof(n + 12), t + 0.86, 0.04, 1.0);
    kick(v, v.out, t, 98, 70, 0.45, 0.3);
    kick(v, v.out, t + 0.86, 98, 65, 0.55, 0.45);
    burst(v, v.out, 'white', t + 0.86, 0.07, 0.005, 0.05, 1.1, 'highpass', 6000);
    return t + 2.1;
  },

  // New best time: a sparkly run up and a ringing chord.
  record(v, t) {
    [84, 86, 88, 91, 93, 96, 98, 100].forEach((n, i) => chime(v, v.out, mtof(n), t + i * 0.055, 0.15, 0.5));
    for (const n of [96, 100, 103]) chime(v, v.out, mtof(n), t + 0.5, 0.11, 0.9);
    return t + 1.5;
  },

  achievement(v, t) {
    [79, 84, 88].forEach((n, i) => chime(v, v.out, mtof(n), t + i * 0.13, 0.19, 0.9));
    for (const n of [67, 72, 76]) tone(v, v.out, 'sine', mtof(n), t + 0.26, 0.045, 0.05, 0.2, 0.5);
    return t + 1.3;
  },

  // Rocket unlocked: arpeggio, a whoosh up and a big bright chord.
  unlock(v, t) {
    [72, 76, 79, 84, 88, 91, 96].forEach((n, i) => chime(v, v.out, mtof(n), t + i * 0.07, 0.13, 0.6));
    const bp = burst(v, v.out, 'pink', t, 0.3, 0.3, 0.1, 0.25, 'bandpass', 300, 1.2);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(4000, t + 0.55);
    for (const n of [72, 76, 79, 84]) brass(v, v.out, mtof(n), t + 0.5, 0.7, 0.055);
    for (const n of [96, 100, 103]) chime(v, v.out, mtof(n), t + 0.5, 0.07, 1.2);
    kick(v, v.out, t + 0.5, 110, 45, 0.5, 0.35);
    return t + 2.05;
  },

  // Bicycle bell: ring-ring.
  bell(v, t) {
    for (const at of [0, 0.16]) {
      const s = t + at;
      tone(v, v.out, 'sine', 2350, s, 0.18, 0.002, 0, 0.7);
      tone(v, v.out, 'sine', 2356, s, 0.11, 0.002, 0, 0.6);
      tone(v, v.out, 'sine', 2350 * 1.53, s, 0.07, 0.002, 0, 0.45);
      tone(v, v.out, 'sine', 2350 * 2.63, s, 0.035, 0.002, 0, 0.3);
      burst(v, v.out, 'white', s, 0.05, 0.002, 0, 0.012, 'highpass', 3000);
    }
    return t + 0.9;
  },

  // Turbo blow-off valve venting as the boost ends (a real compressed-air recording once
  // loaded, a filtered hiss before).
  blowoff(v, t, o) {
    const s = clamp(o.strength ?? 0.8, 0.2, 1);
    const air = v.rec?.get('fx', 'blowoff');
    if (air) {
      const g = v.gain(BLOWOFF_VOL * s);
      v.shot(air, t, rand(0.92, 1.04)).connect(g).connect(v.out);
      return t + 1.0;
    }
    const bp = burst(v, v.out, 'white', t, 0.8 * s, 0.008, 0.08, 0.3, 'bandpass', 3200, 0.8);
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.38);
    return t + 0.45;
  },

  // Clown bulb horn (the Poutine): honk-honk.
  clown(v, t) {
    for (const at of [0, 0.2]) {
      const s = t + at;
      const o = v.osc('sawtooth', 330, s, s + 0.2);
      o.frequency.setValueAtTime(320, s);
      o.frequency.exponentialRampToValueAtTime(410, s + 0.07);
      const bp = v.filter('bandpass', 900, 2.2);
      const lp = v.filter('lowpass', 2600);
      const g = v.gain();
      env(g.gain, s, 0.65, 0.01, 0.08, 0.07);
      o.connect(bp).connect(lp).connect(g).connect(v.out);
      const sq = tone(v, v.out, 'sine', 1200, s, 0.03, 0.01, 0.05, 0.06);
      sq.frequency.setValueAtTime(1200, s);
      sq.frequency.linearRampToValueAtTime(1500, s + 0.1);
    }
    return t + 0.4;
  },
};

// Low-priority sounds are dropped when too many are playing; these never are.
const PRIORITY = new Set(['beep', 'go', 'finish', 'record', 'achievement', 'unlock']);
// Minimum gap between two of the same sound (seconds), so a pile-up isn't a wall of noise.
const GAP = { click: 0.03, passby: 0.12, crash: 0.12, smash: 0.05, can: 0.06, box: 0.1, blowoff: 0.6 };
const STINGERS = new Set(['shield', 'turbo', 'fly', 'blast']);
const UI_SOUNDS = new Set(['click']);

// ---------- horns ----------
// Held horns return { release(t) -> end time }. Bell and clown horns are one-shots.
const HORNS = {
  modelx: ['car', 430], crv: ['car', 415], accord: ['car', 440], is300: ['car', 470], legacy: ['car', 400], carnival: ['car', 350],
  revuelto: ['car', 500], ferrari296: ['car', 490], porsche911: ['car', 455], mclaren750s: ['car', 480],
  bike: ['bell'], ebike: ['bell'], poutine: ['clown'], oilers: ['goal', 220], rogers: ['goal', 165], rocket: ['space', 520],
};

// The release stage sits on its own gain so letting go mid-attack never clicks.
function heldOut(v, t, peak, a) {
  const g = v.gain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  const rel = v.gain(1);
  g.connect(rel).connect(v.out);
  return { g, rel };
}
function releaser(v, rel, r) {
  return (tr) => {
    rel.gain.setValueAtTime(1, tr);
    rel.gain.linearRampToValueAtTime(0, tr + r);
    for (const s of v.srcs) s.stop(tr + r + 0.02);
    return tr + r + 0.03;
  };
}

const HELD = {
  car(v, t, f) {
    const { g, rel } = heldOut(v, t, 0.21, 0.012);
    const sh = v.shaper(1.5);
    const bp = v.filter('bandpass', 620, 0.9);
    const lp = v.filter('lowpass', 2200);
    for (const m of [1, 1.26]) v.osc('sawtooth', f * m, t).connect(sh);
    sh.connect(bp).connect(g);
    sh.connect(lp);
    const lg = v.gain(0.35);
    lp.connect(lg).connect(g);
    return { release: releaser(v, rel, 0.06), min: 0.15 };
  },
  // Arena goal horn (Oilers Jersey, Rogers Place): a big major chord.
  goal(v, t, f) {
    const { g, rel } = heldOut(v, t, 0.2, 0.05);
    const lp = v.filter('lowpass', 1600, 0.9);
    const lfo = v.osc('sine', 5, t);
    const lg = v.gain(7);
    lfo.connect(lg);
    for (const m of [1, 1.26, 1.5]) {
      const o = v.osc('sawtooth', f * m, t);
      lg.connect(o.detune);
      o.connect(lp);
    }
    lp.connect(g);
    return { release: releaser(v, rel, 0.25), min: 0.4 };
  },
  // The Rocket: a sci-fi siren.
  space(v, t, f) {
    const { g, rel } = heldOut(v, t, 0.13, 0.02);
    const o = v.osc('square', f, t);
    const lfo = v.osc('sine', 2.5, t);
    const lg = v.gain(f * 0.45);
    lfo.connect(lg).connect(o.frequency);
    const lp = v.filter('lowpass', 1800);
    o.connect(lp).connect(g);
    return { release: releaser(v, rel, 0.1), min: 0.3 };
  },
};

// ---------- engines ----------
// Synthesised combustion presets (the fallback): idle/red = firing pitch (Hz) at idle and
// redline, harm = pitch ratio of the second oscillator (2 for an inline four, 1.5 for a V6),
// mix = [saw, square, sub], bright = filter opening per Hz, drive = saturation, boxer = Subaru
// rumble depth, dip = level during a gear change (lower = sharper shift).
// rec = the recorded engine, used once its samples have loaded:
//   pack = engine recordings (see ENGINE_SETS), idle/red = rpm range the gearbox drives,
//   lp = tone (low-pass Hz), body/presence = EQ in dB at 180 Hz / 2.5 kHz,
//   turbo = factory turbo whistle on full throttle (0 = none), vol = level.
// Electric and Rocket rec: bed/motor/roar = recorded loop, whine = level of the synthesised
// whine on top (0..1), fk = whine Hz per m/s.
const ENGINES = {
  crv: { voice: 'ice', idle: 32, red: 150, harm: 2, mix: [0.6, 0.26, 0.35], noise: 0.1, bright: 5, q: 1.2, drive: 1.6, boxer: 0, dip: 0.55, vol: 1,
    rec: { pack: 'i4', idle: 850, red: 6500, lp: 4800, body: 2, presence: -2, turbo: 0.35, vol: 1 } },
  accord: { voice: 'ice', idle: 34, red: 168, harm: 2, mix: [0.62, 0.3, 0.3], noise: 0.1, bright: 6, q: 1.8, drive: 2, boxer: 0, dip: 0.5, vol: 1,
    rec: { pack: 'i4', idle: 850, red: 6900, lp: 8500, body: 0, presence: 2.5, turbo: 0.3, vol: 1.05 } },
  is300: { voice: 'ice', idle: 37, red: 190, harm: 1.5, mix: [0.6, 0.38, 0.3], noise: 0.12, bright: 6.5, q: 3, drive: 2.6, boxer: 0, dip: 0.45, vol: 0.95,
    rec: { pack: 'i6', idle: 700, red: 7000, lp: 7500, body: 1.5, presence: 1.5, turbo: 0, vol: 1 } },
  legacy: { voice: 'ice', idle: 28, red: 140, harm: 2, mix: [0.6, 0.25, 0.45], noise: 0.12, bright: 4.5, q: 1.4, drive: 2, boxer: 0.75, dip: 0.5, vol: 1.05,
    rec: { pack: 'b4', idle: 720, red: 6400, lp: 6500, body: 2.5, presence: 0, turbo: 0, vol: 1.05 } },
  carnival: { voice: 'ice', idle: 30, red: 128, harm: 1.5, mix: [0.55, 0.25, 0.35], noise: 0.08, bright: 3.5, q: 0.8, drive: 1.2, boxer: 0, dip: 0.8, vol: 0.9,
    rec: { pack: 'i6', idle: 650, red: 6000, lp: 2400, body: 3, presence: -4, turbo: 0, vol: 0.85 } },
  // Supercars: real engines of their kind, from standing cars revved by hand (no CC0 dyno pull
  // of a supercar exists): a Lamborghini V12 and a Ferrari 360 flat-plane V8 (the McLaren's,
  // and the Ferrari 296's: no CC0 V6 exists). They reach ~4300-4400 rpm, so each red is set
  // where the top loop is pitched up at most ~1.35x; by firing rate (a V12 fires 6 times a
  // turn, a V8 4) the tops still match or beat the stand-ins these cars used before. The 296
  // revs higher and brighter than the McLaren. The 911 idles like a real Porsche flat six and
  // revs on the boxer dyno pull (its rpm counts as a four's: 1740 = a six at 1160).
  revuelto: { voice: 'ice', idle: 40, red: 230, harm: 1.5, mix: [0.6, 0.42, 0.3], noise: 0.12, bright: 7.5, q: 3.2, drive: 3, boxer: 0, dip: 0.4, vol: 1.05,
    rec: { pack: 'v12', idle: 1040, red: 5200, lp: 9500, body: 1, presence: 4, turbo: 0, vol: 1.1 } },
  ferrari296: { voice: 'ice', idle: 40, red: 215, harm: 1.5, mix: [0.6, 0.4, 0.3], noise: 0.12, bright: 7, q: 3, drive: 2.8, boxer: 0, dip: 0.4, vol: 1,
    rec: { pack: 'v8', idle: 1130, red: 6000, lp: 9500, body: 0, presence: 3, turbo: 0.3, vol: 1.05 } },
  porsche911: { voice: 'ice', idle: 36, red: 185, harm: 2, mix: [0.6, 0.3, 0.42], noise: 0.12, bright: 5.5, q: 2, drive: 2.4, boxer: 0.6, dip: 0.45, vol: 1.05,
    rec: { pack: 'f6', idle: 1740, red: 7200, lp: 7000, body: 2, presence: 1.5, turbo: 0.5, vol: 1.1 } },
  mclaren750s: { voice: 'ice', idle: 42, red: 210, harm: 2, mix: [0.62, 0.36, 0.28], noise: 0.12, bright: 7, q: 2.6, drive: 2.6, boxer: 0, dip: 0.42, vol: 1,
    rec: { pack: 'v8', idle: 1130, red: 5400, lp: 7500, body: 2, presence: 0, turbo: 0.45, vol: 1.1 } },
  modelx: { voice: 'ev', f0: 70, fk: 24, cut: 2800, buzz: false, vol: 0.9, rec: { bed: 'ev', whine: 0.3, fk: 12 } },
  ebike: { voice: 'ev', f0: 210, fk: 30, cut: 1800, buzz: true, ticks: true, vol: 0.7, rec: { motor: 'ebike', whine: 0 } },
  bike: { voice: 'bike' },
  rocket: { voice: 'rocket', vol: 1.5, rec: { roar: 'rocket' } },
  poutine: { voice: 'kart', vol: 1.2 },
  oilers: { voice: 'hover', vol: 0.8 },
  rogers: { voice: 'chug', vol: 1 },
};
const NO_TYRES = new Set(['oilers', 'rocket']);
const BIKES = new Set(['bike', 'ebike']);

// Recorded engine types: which pack holds the loops. A set without "off" (lifted throttle)
// loops plays its "on" loops through a low-pass (offLp Hz) when the throttle is up. `idle`
// can borrow another pack's idle with an rpm scale: a four at 1000 rpm fires as often as a
// six at 670 rpm, so it passes for one.
const ENGINE_SETS = {
  i4: { pack: 'i4' }, // Mercedes 190E 2.3-16V inline four on a dyno
  b4: { pack: 'b4', offLp: 1300 }, // Subaru flat four: FR-S dyno pull, WRX idle
  i6: { pack: 'i6', idle: ['i4', 'idle', 4 / 6], offLp: 1300 }, // Supra 2JZ straight six
  v8: { pack: 'v8', offLp: 1300 }, // Ferrari 360 flat-plane V8, standing, revved by hand
  // Porsche flat six: a real Porsche idle; on throttle the boxer dyno pull (no CC0 recording of
  // a flat six revving exists). A six at 1160 rpm fires as often as a four at 1740.
  f6: { pack: 'b4', idle: ['f6', 'idle', 6 / 4], offLp: 1300 },
  v12: { pack: 'v12', offLp: 1300 }, // Lamborghini V12 at a dealer, revved by hand
};
const XF_WIDTH = 0.7; // share of the rpm gap between two loops where both play

// Equal-power crossfade between the two loops either side of rpm (lanes sorted by rpm).
// Near its own rpm each loop plays alone. Writes lane.w; allocates nothing.
function xfade(lanes, rpm) {
  const n = lanes.length;
  for (let i = 0; i < n; i++) lanes[i].w = 0;
  if (rpm <= lanes[0].rpm) {
    lanes[0].w = 1;
    return;
  }
  if (rpm >= lanes[n - 1].rpm) {
    lanes[n - 1].w = 1;
    return;
  }
  let i = 0;
  while (rpm >= lanes[i + 1].rpm) i++;
  const x = Math.log(rpm / lanes[i].rpm) / Math.log(lanes[i + 1].rpm / lanes[i].rpm);
  const u = clamp((x - 0.5) / XF_WIDTH + 0.5, 0, 1);
  lanes[i].w = Math.cos((Math.PI / 2) * u);
  lanes[i + 1].w = Math.sin((Math.PI / 2) * u);
}

// Recorded combustion engine: steady-rpm loops on throttle ("on") and off it ("off"), each
// pitched to the gearbox rpm around the rpm it was recorded at, crossfaded by rpm and by
// throttle, then shaped per car (low-pass, EQ, level).
class RecEngineVoice {
  // True once every pack the engine needs has loaded (its own and any borrowed idle).
  static can(pr, samples) {
    const set = pr.rec?.pack && ENGINE_SETS[pr.rec.pack];
    return Boolean(set && samples?.buffers[set.pack] && (!set.idle || samples.buffers[set.idle[0]]));
  }

  constructor(v, pr, samples) {
    const t = v.ctx.currentTime;
    const rec = (this.rec = pr.rec);
    this.recorded = true;
    const set = ENGINE_SETS[rec.pack];
    const items = SAMPLE_PACKS[set.pack].items;
    this.lp = v.filter('lowpass', rec.lp, 0.7);
    const body = v.filter('lowshelf', 180);
    body.gain.value = rec.body;
    const presence = v.filter('peaking', 2500, 0.9);
    presence.gain.value = rec.presence;
    this.dip = v.gain(1);
    this.level = v.gain(0);
    this.lp.connect(body).connect(presence).connect(this.dip).connect(this.level).connect(v.out);
    this.onBus = v.gain(0);
    this.offBus = v.gain(0);
    this.onBus.connect(this.lp);
    const offItems = items.filter((it) => it.load === 'off' && it.id !== 'idle');
    if (offItems.length) this.offBus.connect(this.lp);
    else this.offBus.connect(v.filter('lowpass', set.offLp, 0.6)).connect(this.lp);
    // One looping source per recording; a source can feed both the on and the off bus.
    this.srcs = [];
    const source = (s, rpm) => {
      const layer = { src: v.loop(s, t), rpm, w: 0, was: 1 };
      this.srcs.push(layer);
      return layer;
    };
    const lane = (layer, bus, list) => {
      const g = v.gain(0);
      layer.src.connect(g).connect(bus);
      list.push({ layer, g, rpm: layer.rpm, w: 0 });
    };
    const [idlePack, idleId, idleScale] = set.idle ?? [set.pack, 'idle', 1];
    const idleS = samples.get(idlePack, idleId);
    const idle = idleS ? source(idleS, idleS.item.rpm * idleScale) : null;
    const onLayers = items.filter((it) => it.load === 'on').map((it) => source(samples.get(set.pack, it.id), it.rpm));
    const offLayers = offItems.length ? offItems.map((it) => source(samples.get(set.pack, it.id), it.rpm)) : onLayers;
    this.on = [];
    this.off = [];
    if (idle) {
      lane(idle, this.onBus, this.on);
      lane(idle, this.offBus, this.off);
    }
    for (const l of onLayers) lane(l, this.onBus, this.on);
    for (const l of offLayers) lane(l, this.offBus, this.off);
    this.on.sort((a, b) => a.rpm - b.rpm);
    this.off.sort((a, b) => a.rpm - b.rpm);
    this.shiftAt = -9;
  }

  set(r, p, t) {
    const rec = this.rec;
    const n = Math.min(r.rpm, 0.97);
    const rpm = rec.idle + (rec.red - rec.idle) * n;
    // During an upshift the driver is off the throttle for a moment.
    const lift = clamp(1 - (t - this.shiftAt) / 0.22, 0, 1);
    const load = r.thr * (1 - 0.9 * lift);
    const a = (Math.PI / 2) * load;
    ramp(this.onBus.gain, Math.sin(a), t, 0.03);
    ramp(this.offBus.gain, Math.cos(a), t, 0.03);
    xfade(this.on, rpm);
    xfade(this.off, rpm);
    const srcs = this.srcs;
    for (let i = 0; i < srcs.length; i++) srcs[i].w = 0;
    for (let k = 0; k < 2; k++) {
      const lanes = k ? this.off : this.on;
      for (let i = 0; i < lanes.length; i++) {
        const l = lanes[i];
        ramp(l.g.gain, l.w, t, 0.03);
        if (l.w > l.layer.w) l.layer.w = l.w;
      }
    }
    // Pitch: only loops that are (or just were) audible need to follow.
    for (let i = 0; i < srcs.length; i++) {
      const s = srcs[i];
      if (s.w > 0 || s.was > 0) ramp(s.src.playbackRate, clamp(rpm / s.rpm, 0.35, 2.5), t, 0.025);
      s.was = s.w;
    }
    const lvl = REC_ENGINE_VOL * rec.vol * (0.4 + 0.6 * n) * (0.68 + 0.32 * load);
    ramp(this.level.gain, lvl, t, 0.05);
    r.state.freq = rpm;
    r.state.level = lvl;
  }

  shift(t) {
    this.shiftAt = t;
    const g = this.dip.gain;
    g.setTargetAtTime(0.72, t, 0.015);
    g.setTargetAtTime(1, t + 0.08, 0.06);
  }
}

class IceVoice {
  constructor(v, pr) {
    const t = v.ctx.currentTime;
    this.pr = pr;
    const f = pr.idle;
    this.a = v.osc('sawtooth', f, t);
    this.b = v.osc('square', f * pr.harm, t);
    this.sub = v.osc('sine', f, t);
    const pre = v.gain(1);
    this.a.connect(v.gain(pr.mix[0])).connect(pre);
    this.b.connect(v.gain(pr.mix[1])).connect(pre);
    // Exhaust breath: noise around the 4th harmonic.
    this.nbp = v.filter('bandpass', f * 4, 1.2);
    this.ng = v.gain(0);
    v.noise('pink', t).connect(this.nbp).connect(this.ng).connect(pre);
    this.lp = v.filter('lowpass', 800, pr.q);
    this.am = v.gain(1);
    this.dip = v.gain(1);
    this.level = v.gain(0);
    pre.connect(v.shaper(pr.drive)).connect(this.lp).connect(this.am);
    this.sub.connect(v.gain(pr.mix[2])).connect(this.am);
    this.am.connect(this.dip).connect(this.level).connect(v.out);
    // A slow random pitch wobble so it sounds like an engine, not a synth.
    const jg = v.gain(7);
    v.noise('brown', t, undefined, 0.5).connect(v.filter('lowpass', 18)).connect(jg);
    jg.connect(this.a.detune);
    jg.connect(this.b.detune);
    if (pr.boxer) {
      // Boxer burble: amplitude wobble at half the firing rate.
      this.lfo = v.osc('triangle', f / 2, t);
      this.am.gain.value = 1 - pr.boxer * 0.5;
      this.lfo.connect(v.gain(pr.boxer * 0.5)).connect(this.am.gain);
    }
  }

  set(r, p, t) {
    const pr = this.pr;
    const f = pr.idle + (pr.red - pr.idle) * r.rpm;
    const thr = r.thr;
    ramp(this.a.frequency, f, t, 0.03);
    ramp(this.b.frequency, f * pr.harm, t, 0.03);
    ramp(this.sub.frequency, f, t, 0.03);
    if (this.lfo) ramp(this.lfo.frequency, f / 2, t, 0.03);
    ramp(this.nbp.frequency, f * 4, t, 0.05);
    ramp(this.lp.frequency, Math.min(9000, 200 + f * pr.bright * (0.45 + 0.8 * thr)), t, 0.05);
    ramp(this.ng.gain, pr.noise * (0.3 + thr), t, 0.06);
    const lvl = pr.vol * (0.2 + 0.18 * r.rpm + thr * (0.24 + 0.38 * r.rpm));
    ramp(this.level.gain, lvl, t, 0.05);
    r.state.freq = f;
    r.state.level = lvl;
  }

  shift(t) {
    const g = this.dip.gain;
    g.setTargetAtTime(this.pr.dip, t, 0.012);
    g.setTargetAtTime(1, t + 0.09, 0.05);
  }
}

// Freewheel ticking while coasting (Bicycle and E-bike).
class Ticker {
  constructor(v, t, dest, vol) {
    this.vol = vol;
    this.src = v.add(v.ctx.createBufferSource());
    this.src.buffer = v.bufs.tick;
    this.src.loop = true;
    this.src.start(t);
    v.srcs.push(this.src);
    this.g = v.gain(0);
    this.src.connect(v.filter('lowpass', 5000)).connect(this.g).connect(dest);
  }

  set(speed, thr, t) {
    const coasting = thr < 0.5 && speed > 0.6;
    ramp(this.src.playbackRate, clamp(speed / 4.5, 0.3, 2.6), t, 0.05);
    ramp(this.g.gain, coasting ? this.vol * Math.min(1, speed / 3) : 0, t, 0.04);
  }
}

// Electric: motor whine that rises with speed (Model X, Cam's E-bike). With its recordings
// loaded, the Model X also plays a real Tesla's drive sound (motors, tyres, road) and keeps
// only a soft whine on top; the E-bike's whine becomes a real brushless motor.
class EvVoice {
  constructor(v, pr, samples) {
    const t = v.ctx.currentTime;
    this.pr = pr;
    const rec = pr.rec;
    const bed = rec?.bed && samples?.get('fx', rec.bed);
    const motor = rec?.motor && samples?.get('fx', rec.motor);
    this.recorded = Boolean(bed || motor);
    this.whineK = this.recorded ? rec.whine : 1;
    this.fk = this.recorded && rec.fk ? rec.fk : pr.fk;
    this.w1 = v.osc(pr.buzz ? 'sawtooth' : 'sine', pr.f0, t);
    this.w2 = v.osc('sine', pr.f0 * 1.5, t);
    this.w2.detune.value = 9;
    this.hum = v.osc('triangle', pr.f0 * 0.5, t);
    const lp = v.filter('lowpass', pr.cut, 0.7);
    this.level = v.gain(0);
    this.w1.connect(v.gain(pr.buzz ? 0.3 : 0.55)).connect(lp);
    this.w2.connect(v.gain(0.2)).connect(lp);
    this.hum.connect(v.gain(0.3)).connect(lp);
    lp.connect(this.level).connect(v.out);
    this.hg = v.gain(0);
    v.noise('white', t).connect(v.filter('highpass', 5000)).connect(this.hg).connect(this.level);
    if (bed) {
      this.bed = v.loop(bed, t);
      this.bedG = v.gain(0);
      this.bed.connect(v.filter('lowpass', 9000)).connect(this.bedG).connect(v.out);
    }
    if (motor) {
      this.motor = v.loop(motor, t);
      this.motorG = v.gain(0);
      this.motor.connect(this.motorG).connect(v.out);
    }
    if (pr.ticks) this.tick = new Ticker(v, t, v.out, 0.35);
  }

  set(r, p, t) {
    const pr = this.pr;
    const f = pr.f0 + this.fk * p.speed;
    ramp(this.w1.frequency, f, t, 0.04);
    ramp(this.w2.frequency, f * 1.5, t, 0.04);
    ramp(this.hum.frequency, f * 0.5, t, 0.04);
    const move = Math.min(1, p.speed / 6);
    const lvl = pr.vol * (0.05 + 0.95 * move) * (0.35 + 0.65 * r.thr);
    ramp(this.level.gain, lvl * this.whineK, t, 0.06);
    ramp(this.hg.gain, 0.05 * r.thr * move, t, 0.06);
    if (this.bed) {
      // Pitch and level of the drive sound follow the speed; full throttle adds motor load.
      const s = clamp(p.speed / Math.max(10, p.top || 45), 0, 2);
      ramp(this.bed.playbackRate, 0.7 + 0.42 * s, t, 0.08);
      ramp(this.bedG.gain, 1.9 * (0.06 + 0.94 * Math.min(1, p.speed / 30)) * (0.55 + 0.45 * r.thr), t, 0.08);
    }
    if (this.motor) {
      ramp(this.motor.playbackRate, clamp(0.45 + p.speed / 32, 0.45, 2.2), t, 0.05);
      ramp(this.motorG.gain, 1.3 * move * (0.2 + 0.8 * r.thr), t, 0.05);
    }
    if (this.tick) this.tick.set(p.speed, r.thr, t);
    r.state.freq = f;
    r.state.level = lvl;
  }
}

// Plain Bicycle: no engine. Freewheel ticks when coasting, a soft chain whirr when pedalling.
class BikeVoice {
  constructor(v) {
    const t = v.ctx.currentTime;
    this.tick = new Ticker(v, t, v.out, 0.55);
    this.wg = v.gain(0);
    v.noise('pink', t).connect(v.filter('bandpass', 2000, 1.5)).connect(this.wg).connect(v.out);
  }

  set(r, p, t) {
    this.tick.set(p.speed, r.thr, t);
    const lvl = 0.3 * r.thr * Math.min(1, p.speed / 8);
    ramp(this.wg.gain, lvl, t, 0.08);
    r.state.freq = 0;
    r.state.level = lvl;
  }
}

// Rocket: a deep noise roar plus sub rumble that swells at lift-off. With its recording
// loaded, a real jet afterburner carries the roar.
class RocketVoice {
  constructor(v, pr, samples) {
    const t = v.ctx.currentTime;
    this.pr = pr;
    const roar = pr.rec?.roar && samples?.get('fx', pr.rec.roar);
    this.recorded = Boolean(roar);
    if (roar) {
      this.roar = v.loop(roar, t);
      this.roarG = v.gain(0);
      this.roar.connect(this.roarG);
    }
    this.lp = v.filter('lowpass', 300, 0.8);
    this.rg = v.gain(0.6);
    v.noise('brown', t).connect(this.lp).connect(this.rg);
    this.cg = v.gain(0);
    v.noise('white', t).connect(v.filter('bandpass', 2500, 0.8)).connect(this.cg);
    this.sg = v.gain(0.2);
    v.osc('sine', 41, t).connect(this.sg);
    v.osc('sine', 61.5, t).connect(this.sg);
    this.tone = v.osc('sawtooth', 55, t);
    this.tg = v.gain(0.12);
    this.tone.connect(v.filter('lowpass', 220)).connect(this.tg);
    this.level = v.gain(0);
    for (const g of [this.rg, this.cg, this.sg, this.tg]) g.connect(this.level);
    if (this.roarG) this.roarG.connect(this.level);
    this.level.connect(v.out);
  }

  set(r, p, t) {
    const s = clamp(p.speed / 90, 0, 1);
    const air = r.air;
    const synth = this.roar ? 0.35 : 1; // the synthesised roar only fills in under the recording
    if (this.roar) {
      ramp(this.roar.playbackRate, 0.78 + 0.22 * s + 0.12 * air + 0.06 * r.thr, t, 0.1);
      ramp(this.roarG.gain, 0.5 + 0.25 * s + 0.3 * air, t, 0.08);
    }
    ramp(this.lp.frequency, 220 + 900 * s + 900 * air + 400 * r.thr, t, 0.08);
    ramp(this.rg.gain, synth * (0.55 + 0.25 * s + 0.35 * air), t, 0.08);
    ramp(this.cg.gain, synth * (0.04 + 0.08 * s + 0.1 * air), t, 0.08);
    ramp(this.sg.gain, 0.2 + 0.4 * air, t, 0.1);
    ramp(this.tone.frequency, 50 + 30 * s + 25 * air, t, 0.1);
    const lvl = this.pr.vol * (0.45 + 0.3 * r.thr + 0.25 * air);
    ramp(this.level.gain, lvl, t, 0.08);
    r.state.freq = 50 + 30 * s + 25 * air;
    r.state.level = lvl;
  }
}

// Poutine: a kazoo-ish go-kart with a wobbly vibrato and a gravy bubble.
class KartVoice {
  constructor(v, pr) {
    const t = v.ctx.currentTime;
    this.pr = pr;
    this.o = v.osc('square', 75, t);
    const vib = v.osc('sine', 7.5, t);
    vib.connect(v.gain(28)).connect(this.o.detune);
    const mix = v.gain(1);
    this.o.connect(v.filter('bandpass', 650, 3)).connect(v.gain(0.9)).connect(mix);
    this.o.connect(v.filter('bandpass', 1300, 4)).connect(v.gain(0.6)).connect(mix);
    this.o.connect(v.filter('lowpass', 400)).connect(v.gain(0.35)).connect(mix);
    const am = v.gain(0.85);
    v.osc('sine', 4.5, t).connect(v.gain(0.15)).connect(am.gain);
    this.level = v.gain(0);
    mix.connect(am).connect(this.level).connect(v.out);
  }

  set(r, p, t) {
    const f = 75 + p.speed * 5.5;
    ramp(this.o.frequency, f, t, 0.04);
    const lvl = this.pr.vol * (0.25 + 0.4 * r.thr + 0.35 * r.thr * Math.min(1, p.speed / 30));
    ramp(this.level.gain, lvl, t, 0.05);
    r.state.freq = f;
    r.state.level = lvl;
  }
}

// Oilers Jersey: a hover hum with an arena-organ tone and a soft air cushion.
class HoverVoice {
  constructor(v, pr) {
    const t = v.ctx.currentTime;
    this.pr = pr;
    const trem = v.gain(0.88);
    const lfo = v.osc('sine', 6, t);
    lfo.connect(v.gain(0.12)).connect(trem.gain);
    const det = v.gain(9);
    lfo.connect(det);
    this.oscs = [[1, 0.5], [2, 0.28], [3, 0.16], [4, 0.08]].map(([m, a]) => {
      const o = v.osc('sine', 98 * m, t);
      det.connect(o.detune);
      o.connect(v.gain(a)).connect(trem);
      return [o, m];
    });
    this.ag = v.gain(0.2);
    v.noise('pink', t).connect(v.filter('bandpass', 500, 0.7)).connect(this.ag);
    this.level = v.gain(0);
    trem.connect(v.filter('lowpass', 2500)).connect(this.level);
    this.ag.connect(this.level);
    this.level.connect(v.out);
  }

  set(r, p, t) {
    const f = 98 + p.speed * 3.6;
    for (const [o, m] of this.oscs) ramp(o.frequency, f * m, t, 0.06);
    ramp(this.ag.gain, 0.18 + 0.3 * Math.min(1, p.speed / 40), t, 0.1);
    const lvl = this.pr.vol * (0.35 + 0.4 * r.thr + 0.25 * Math.min(1, p.speed / 30));
    ramp(this.level.gain, lvl, t, 0.06);
    r.state.freq = f;
    r.state.level = lvl;
  }
}

// Rogers Place: a slow, heavy chug-a-chug.
class ChugVoice {
  constructor(v, pr) {
    const t = v.ctx.currentTime;
    this.pr = pr;
    this.o = v.osc('sawtooth', 26, t);
    this.sub = v.osc('sine', 26, t);
    this.lp = v.filter('lowpass', 300, 1.2);
    const am = v.gain(0.65);
    this.chug = v.osc('sine', 2.2, t);
    this.chug.connect(v.gain(0.35)).connect(am.gain);
    this.o.connect(this.lp).connect(am);
    this.sub.connect(v.gain(0.5)).connect(am);
    v.noise('pink', t).connect(v.filter('lowpass', 250)).connect(v.gain(0.25)).connect(am);
    this.level = v.gain(0);
    am.connect(this.level).connect(v.out);
  }

  set(r, p, t) {
    const f = 26 + p.speed * 2.2;
    ramp(this.o.frequency, f, t, 0.06);
    ramp(this.sub.frequency, f, t, 0.06);
    ramp(this.chug.frequency, 2.2 + p.speed * 0.28, t, 0.1);
    ramp(this.lp.frequency, 300 + 450 * r.thr + f * 2, t, 0.06);
    const lvl = this.pr.vol * (0.3 + 0.2 * Math.min(1, p.speed / 30) + 0.5 * r.thr);
    ramp(this.level.gain, lvl, t, 0.06);
    r.state.freq = f;
    r.state.level = lvl;
  }
}

const VOICES = { ice: IceVoice, ev: EvVoice, bike: BikeVoice, rocket: RocketVoice, kart: KartVoice, hover: HoverVoice, chug: ChugVoice };

// True when a vehicle's recorded voice can be built now (its samples have loaded).
function recordedReady(pr, S) {
  if (!S || !pr.rec) return false;
  if (pr.rec.pack) return RecEngineVoice.can(pr, S);
  const id = pr.rec.bed || pr.rec.motor || pr.rec.roar;
  return Boolean(id && S.get('fx', id));
}

// The continuous sounds of driving: engine (with gearbox), wind, tyre squeal, the turbo
// whistle (nitro hiss before the recordings load). Built once per context; update() only
// moves parameters, it allocates nothing.
class Rig {
  constructor(ctx, dest, bufs, samples = null) {
    this.ctx = ctx;
    this.bufs = bufs;
    this.samples = samples;
    this.useRec = true;
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0;
    this.engineBus.connect(dest);
    const amb = (this.amb = new Voice(ctx, dest, bufs));
    const t = ctx.currentTime;
    // Wind: pink noise, band rising with speed.
    this.windF = amb.filter('bandpass', 400, 0.6);
    this.windG = amb.gain(0);
    amb.noise('pink', t).connect(this.windF).connect(this.windG).connect(amb.out);
    // Tyre squeal: two narrow, wobbling noise bands.
    const sq = amb.noise('white', t);
    this.sqG = amb.gain(0);
    this.wob = amb.osc('sine', 4.3, t);
    const wg = amb.gain(70);
    this.wob.connect(wg);
    for (const [f, q, g] of [[1850, 13, 2.2], [2900, 16, 1.5]]) {
      const bp = amb.filter('bandpass', f, q);
      wg.connect(bp.detune);
      sq.connect(bp).connect(amb.gain(g)).connect(this.sqG);
    }
    this.sqG.connect(amb.out);
    // Nitro / turbo hiss while boosting.
    this.hissF = amb.filter('bandpass', 1300, 0.8);
    this.hissG = amb.gain(0);
    amb.noise('white', t).connect(this.hissF).connect(amb.filter('lowpass', 5000)).connect(this.hissG).connect(amb.out);
    this.fx = null; // recorded whistle and squeal, see attachFx()

    this.voice = null;
    this.voiceV = null;
    this.vehicle = null;
    this.gear = 0;
    this.rpm = 0;
    this.thr = 0;
    this.air = 0;
    this.spool = 0;
    this.boostHi = 0;
    this.boLock = false;
    this.blowoff = 0; // > 0: Sound plays a blow-off of this strength, then clears it
    this.ice = false;
    this.turboK = 0;
    this.state = { vehicle: null, voice: null, source: 'synth', active: false, gear: 0, rpm: 0, freq: 0, level: 0, speed: 0, throttle: 0, wind: 0, squeal: 0, hiss: 0, whistle: 0 };
  }

  get rec() {
    return this.useRec ? this.samples : null;
  }

  // Recorded tyre squeal and turbo whistle, once the effects pack has loaded.
  attachFx() {
    const S = this.samples;
    const w = S?.get('fx', 'whistle');
    const sq = S?.get('fx', 'squeal');
    if (this.fx || !w || !sq) return;
    const amb = this.amb;
    const t = this.ctx.currentTime;
    const whistle = amb.loop(w, t, 0.6);
    const whistleG = amb.gain(0);
    whistle.connect(whistleG).connect(amb.out);
    const squeal = amb.loop(sq, t);
    const squealG = amb.gain(0);
    if (squeal.detune) this.wob.connect(amb.gain(25)).connect(squeal.detune); // tyres wobble a little
    squeal.connect(squealG).connect(amb.out);
    this.fx = { whistle, whistleG, squeal, squealG };
  }

  // Picks the voice again when recordings arrive or are switched on/off (keeps the gear).
  refresh() {
    this.attachFx();
    if (this.vehicle) this.setVehicle(this.vehicle, true);
  }

  setVehicle(id, keepGear = false) {
    const pr = ENGINES[id] ?? ENGINES.crv;
    const S = this.rec;
    const want = recordedReady(pr, S);
    if (this.vehicle === id && this.voice && (!keepGear || Boolean(this.voice.recorded) === want)) return;
    const Kind = pr.voice === 'ice' && want ? RecEngineVoice : VOICES[pr.voice];
    const t = this.ctx.currentTime;
    const old = this.voiceV;
    if (old) {
      old.out.gain.setTargetAtTime(0, t, 0.05);
      setTimeout(() => old.dispose(), 400);
    }
    this.vehicle = id;
    this.voiceV = new Voice(this.ctx, this.engineBus, this.bufs);
    if (old) {
      this.voiceV.out.gain.value = 0;
      this.voiceV.out.gain.setTargetAtTime(1, t, 0.05);
    }
    this.voice = new Kind(this.voiceV, pr, S);
    if (!keepGear) {
      this.gear = 0;
      this.rpm = 0;
    }
    this.ice = Boolean(pr.rec?.pack);
    this.turboK = pr.rec?.turbo ?? 0;
    this.state.vehicle = id;
    this.state.voice = pr.voice;
    this.state.source = this.voice.recorded ? 'recorded' : 'synth';
  }

  // Simulated gearbox: gear from speed, rpm within the gear, a level dip on each upshift.
  gearbox(dt, p, t) {
    const top = Math.max(10, p.top || 45);
    let g = this.gear;
    let target;
    if (!p.racing) {
      g = 0;
      target = this.thr * 0.7; // revving on the start line
    } else {
      const v = p.speed;
      while (g < GEAR_TOP.length - 1 && v / (top * GEAR_TOP[g]) > 0.93) g++;
      while (g > 0 && v / (top * GEAR_TOP[g - 1]) < 0.6) g--;
      target = v / (top * GEAR_TOP[g]);
      if (g === 0 && v < 7) target = Math.max(target, this.thr * 0.42); // clutch slip at launch
      target = clamp(target, 0, 1);
    }
    if (g > this.gear && p.racing && this.voice?.shift) this.voice.shift(t);
    this.gear = g;
    this.rpm += (target - this.rpm) * Math.min(1, dt * 9);
  }

  update(dt, p, t) {
    const st = this.state;
    const active = Boolean(p.active);
    this.thr += ((active && p.throttle ? 1 : 0) - this.thr) * Math.min(1, dt * 8);
    this.air += ((active && p.airborne ? 1 : 0) - this.air) * Math.min(1, dt * 1.5);
    this.gearbox(dt, p, t);
    this.voice?.set(this, p, t);
    ramp(this.engineBus.gain, active ? ENGINE_VOL : 0, t, active ? 0.08 : 0.35);

    const sp = active ? p.speed : 0;
    const wind = active ? Math.min(1, (sp / 60) ** 2) * 0.55 + (p.flying ? 0.3 : 0) : 0;
    ramp(this.windG.gain, wind * WIND_VOL, t, 0.15);
    ramp(this.windF.frequency, 350 + Math.min(sp, 90) * 22, t, 0.2);

    let squeal = 0;
    if (active && !NO_TYRES.has(this.vehicle) && !p.flying && sp > 5) {
      if (p.drifting) squeal = 0.8;
      else if (p.brake && sp > 16) squeal = Math.min(1, (sp - 16) / 25);
      if (BIKES.has(this.vehicle)) squeal *= 0.45;
    }
    const fx = this.useRec ? this.fx : null;
    ramp(this.sqG.gain, fx ? 0 : squeal * SQUEAL_VOL, t, 0.05);
    if (this.fx) {
      ramp(this.fx.squealG.gain, fx ? squeal * REC_SQUEAL_VOL : 0, t, 0.05);
      ramp(this.fx.squeal.playbackRate, 0.9 + 0.15 * Math.min(1, sp / 60), t, 0.1);
    }

    // Boost: nitro or the turbo power spool the turbo up (a car with a factory turbo also
    // spools a little on full throttle at high rpm). When the boost drops away, the blow-off
    // valve vents (Sound plays it).
    const boosting = active && (p.boost || p.turbo);
    this.spool += ((boosting ? 1 : 0) - this.spool) * Math.min(1, dt * (boosting ? 2.2 : 6));
    const n = this.rpm;
    const factory = active ? this.turboK * this.thr * clamp((n - 0.35) / 0.55, 0, 1) : 0;
    const boost = Math.max(this.spool, factory);
    const whistle = this.ice && fx ? boost : 0;
    if (this.fx) {
      ramp(this.fx.whistleG.gain, WHISTLE_VOL * whistle * (0.35 + 0.65 * n), t, 0.04);
      ramp(this.fx.whistle.playbackRate, 0.5 + 0.5 * boost * (0.6 + 0.4 * n), t, 0.06);
    }
    if (this.boLock) {
      // One blow-off per boost: wait until it has died down.
      if (boost < 0.15) this.boLock = false;
      this.boostHi = boost;
    } else if (this.ice && this.boostHi > 0.55 && boost < this.boostHi - 0.3) {
      this.blowoff = this.boostHi;
      this.boLock = true;
      this.boostHi = boost;
    } else {
      this.boostHi = Math.max(boost, this.boostHi - dt * 0.4);
    }

    // The synthesised boost hiss stays for rides without recordings (and before they load).
    const synthHiss = !(fx && (this.ice || this.voice?.recorded));
    const hiss = !active || !synthHiss ? 0 : p.turbo ? 1 : p.boost ? 0.7 : 0;
    ramp(this.hissG.gain, hiss * HISS_VOL, t, hiss ? 0.05 : 0.15);
    ramp(this.hissF.frequency, 1100 + Math.min(sp, 90) * 18, t, 0.1);

    st.active = active;
    st.gear = this.gear + 1;
    st.rpm = this.rpm;
    st.speed = p.speed;
    st.throttle = this.thr;
    st.wind = wind;
    st.squeal = squeal;
    st.hiss = hiss;
    st.whistle = whistle;
  }

  dispose() {
    this.voiceV?.dispose();
    this.amb.dispose();
    this.engineBus.disconnect();
  }
}

// Master chain: volume → gentle limiter → speakers.
function buildMaster(ctx, volume, limit = true) {
  const master = ctx.createGain();
  master.gain.value = volume;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -8;
  lim.knee.value = 6;
  lim.ratio.value = 12;
  lim.attack.value = 0.003;
  lim.release.value = 0.2;
  if (limit) master.connect(lim).connect(ctx.destination);
  else master.connect(ctx.destination);
  const bus = (v) => {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(master);
    return g;
  };
  return { master, lim, sfx: bus(1), ui: bus(UI_VOL), drive: bus(1) };
}

// ---------- the game-facing object ----------
class Sound {
  constructor() {
    this.ctx = null;
    this.failed = false; // no Web Audio here
    this.vehicle = 'modelx';
    this.counts = Object.create(null);
    this.errors = [];
    this.voices = [];
    this.lastAt = Object.create(null);
    this.lastBoxAt = -9;
    this.clock = 0;
    this.wasBoost = false;
    this.boostEnd = -9;
    this.horn = null;
    this.hornTimer = 0;
    this.suspendToken = 0;
    this.buttons = [];
    this.dropped = 0;
    this.skipped = 0;
    this.samples = new Samples();
    this.useRec = true;
    this.muted = false;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage unavailable */ }
    if (typeof window === 'undefined') return;
    this.onGesture = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.addEventListener(ev, this.onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => this.applyState());
  }

  get supported() {
    return typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  // Live state for the dev hook and the sound studio. engine.source says whether the engine
  // playing is 'recorded' or 'synth'; samples.state is 'not loaded', 'loading', 'ready',
  // 'partial' or 'failed'.
  get debug() {
    return {
      muted: this.muted, state: this.ctx?.state ?? (this.failed ? 'unsupported' : 'not started'), counts: { ...this.counts },
      voices: this.voices.length, dropped: this.dropped, skipped: this.skipped, horn: Boolean(this.horn),
      engine: this.rig ? { ...this.rig.state } : null, samples: this.samples.debug, useRecordings: this.useRec, errors: this.errors.slice(),
    };
  }

  // false = synthesised engines and effects only (to compare in the sound studio).
  get useRecordings() {
    return this.useRec;
  }

  set useRecordings(on) {
    this.useRec = Boolean(on);
    if (!this.rig) return;
    this.rig.useRec = this.useRec;
    try { this.rig.refresh(); } catch (e) { this.fail(e); }
  }

  fail(e) {
    if (this.errors.length < 20) this.errors.push(String(e?.message ?? e));
    if (import.meta.env?.DEV) console.warn('sound:', e);
  }

  count(name) {
    this.counts[name] = (this.counts[name] || 0) + 1;
  }

  // Creates the context on the first gesture (browsers only allow sound after one).
  unlock() {
    if (this.muted || this.failed) return;
    try {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().catch(noop);
      if (this.ctx?.state === 'running') {
        for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.removeEventListener(ev, this.onGesture, { capture: true });
      }
    } catch (e) {
      this.fail(e);
    }
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      this.failed = true;
      return;
    }
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      try { this.ctx = new AC(); } catch { this.failed = true; return; }
    }
    this.bufs = buffersFor(this.ctx);
    this.bus = buildMaster(this.ctx, this.muted ? 0 : MASTER_VOL);
    this.rig = new Rig(this.ctx, this.bus.drive, this.bufs, this.samples);
    this.rig.useRec = this.useRec;
    this.rig.setVehicle(this.vehicle);
    // The recordings load in the background; each voice switches over when its pack is in.
    this.samples.onPack = () => this.rig.refresh();
    this.samples.load(this.ctx);
    this.ctx.onstatechange = () => {
      if (this.ctx.state === 'running') this.unlock();
    };
  }

  // Running only when unmuted and the tab is visible; otherwise fade out and suspend.
  applyState() {
    const c = this.ctx;
    if (!c) return;
    try {
      const run = !this.muted && !document.hidden;
      const t = c.currentTime;
      const token = ++this.suspendToken;
      if (run) {
        if (c.state !== 'running') c.resume().catch(noop);
        this.bus.master.gain.cancelScheduledValues(t);
        this.bus.master.gain.setTargetAtTime(MASTER_VOL, t, 0.03);
      } else {
        this.bus.master.gain.cancelScheduledValues(t);
        this.bus.master.gain.setTargetAtTime(0, t, 0.02);
        this.hornStop();
        setTimeout(() => {
          if (token === this.suspendToken && c.state === 'running') c.suspend().catch(noop);
        }, 150);
      }
    } catch (e) {
      this.fail(e);
    }
  }

  get ready() {
    return Boolean(this.ctx) && this.ctx.state === 'running' && !this.muted;
  }

  setMuted(m) {
    this.muted = Boolean(m);
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* storage unavailable */ }
    if (!this.muted) this.unlock();
    this.applyState();
    for (const b of this.buttons) this.paintButton(b);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  paintButton(b) {
    b.textContent = this.muted ? '🔇' : '🔊';
    b.title = this.muted ? 'Sound off (M)' : 'Sound on (M)';
    b.setAttribute('aria-label', this.muted ? 'Turn sound on' : 'Turn sound off');
    b.setAttribute('aria-pressed', String(this.muted));
  }

  // A 🔊/🔇 button that toggles the sound.
  bindButton(b) {
    if (!b) return;
    this.buttons.push(b);
    this.paintButton(b);
    b.addEventListener('click', () => {
      this.toggleMute();
      b.blur(); // so Space/Enter while driving don't toggle it again
    });
  }

  setVehicle(id) {
    this.vehicle = id;
    this.hornStop();
    try { this.rig?.setVehicle(id); } catch (e) { this.fail(e); }
  }

  // One-shot effect. Counted even when muted or without Web Audio.
  play(name, o = {}) {
    this.count(name);
    if (!this.ready) return;
    try {
      const fn = SFX[name];
      if (!fn) throw new Error(`unknown sound ${name}`);
      const now = this.ctx.currentTime;
      if (now - (this.lastAt[name] ?? -9) < (GAP[name] ?? 0.03)) {
        this.skipped++;
        return;
      }
      if (this.voices.length >= MAX_VOICES && !PRIORITY.has(name)) {
        this.dropped++;
        return;
      }
      this.lastAt[name] = now;
      let t = now + 0.01;
      if (name === 'box') this.lastBoxAt = t;
      // A power stinger waits for the ? box arpeggio to land first.
      if (STINGERS.has(name) && t - this.lastBoxAt < 0.3) t = this.lastBoxAt + 0.3;
      const v = new Voice(this.ctx, UI_SOUNDS.has(name) ? this.bus.ui : this.bus.sfx, this.bufs);
      v.rec = this.useRec ? this.samples : null;
      this.track(v, fn(v, t, o));
    } catch (e) {
      this.fail(e);
    }
  }

  // Keeps a one-shot until it has finished, then frees all its nodes.
  track(v, end) {
    this.voices.push(v);
    const ms = Math.max(0, end - this.ctx.currentTime) * 1000 + 200;
    setTimeout(() => {
      v.dispose();
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
    }, ms);
  }

  hornStart() {
    this.count('horn');
    if (this.horn || !this.ready) return;
    try {
      const [kind, f] = HORNS[this.vehicle] ?? HORNS.crv;
      if (SFX[kind]) {
        const v = new Voice(this.ctx, this.bus.sfx, this.bufs);
        this.track(v, SFX[kind](v, this.ctx.currentTime + 0.01, {}));
        return;
      }
      const t = this.ctx.currentTime + 0.01;
      const v = new Voice(this.ctx, this.bus.sfx, this.bufs);
      this.horn = { v, h: HELD[kind](v, t, f), t };
      this.hornTimer = setTimeout(() => this.hornStop(), 6000); // never stuck on
    } catch (e) {
      this.fail(e);
    }
  }

  hornStop() {
    const horn = this.horn;
    if (!horn) return;
    this.horn = null;
    clearTimeout(this.hornTimer);
    try {
      const end = horn.h.release(Math.max(this.ctx.currentTime + 0.005, horn.t + horn.h.min));
      this.track(horn.v, end);
    } catch (e) {
      this.fail(e);
    }
  }

  // Once per frame. p: { active, racing, speed, throttle, brake, boost, turbo, airborne, flying, drifting, top }.
  update(dt, p) {
    this.clock += dt;
    // One whoosh per boost: a new press, not the flicker of a nearly empty tank.
    if (p.active && p.boost && !this.wasBoost && this.clock - this.boostEnd > 0.35) this.play('nitro');
    if (this.wasBoost && !p.boost) this.boostEnd = this.clock;
    this.wasBoost = Boolean(p.active && p.boost);
    if (!this.rig || this.ctx.state !== 'running') return;
    try {
      this.rig.update(dt, p, this.ctx.currentTime);
      if (this.rig.blowoff) {
        const s = this.rig.blowoff;
        this.rig.blowoff = 0;
        this.play('blowoff', { strength: s });
      }
    } catch (e) {
      this.fail(e);
    }
  }
}

export const sound = new Sound();

// Internals for the sound studio's offline checks (sound-studio.html).
export const soundLab = { SFX, HELD, HORNS, ENGINES, ENGINE_SETS, SAMPLE_PACKS, Voice, Rig, Samples, buffersFor, buildMaster, MASTER_VOL, UI_SOUNDS, GEAR_TOP };
