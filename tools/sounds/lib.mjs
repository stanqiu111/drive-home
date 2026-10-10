// Audio helpers for tools/sounds/build-sounds.mjs: WAV read/write, filters, resampling,
// engine-cycle tracking, pitch flattening and seamless loops. Node only, no dependencies.
import fs from 'node:fs';

export function readWav(path) {
  const b = fs.readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`not a wav: ${path}`);
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { tag: b.readUInt16LE(body), ch: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
      if (fmt.tag === 0xfffe) fmt.tag = b.readUInt16LE(body + 24);
    } else if (id === 'data') {
      data = b.subarray(body, body + size);
    }
    off = body + size + (size & 1);
  }
  const { ch, sr, bits, tag } = fmt;
  const n = Math.floor(data.length / (ch * (bits / 8)));
  const x = new Float32Array(n); // mixed down to mono
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) {
      const o = (i * ch + c) * (bits / 8);
      if (tag === 3 && bits === 32) s += data.readFloatLE(o);
      else if (bits === 16) s += data.readInt16LE(o) / 32768;
      else if (bits === 24) s += (((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)) << 8) >> 8) / 8388608;
      else throw new Error(`unsupported wav: ${bits} bits`);
    }
    x[i] = s / ch;
  }
  return { x, sr };
}

export function writeWav(path, sr, x) {
  const n = x.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(path, b);
}

// RBJ biquad (lowpass / highpass), applied twice for a 4th-order slope.
export function filter4(x, sr, type, f0) {
  let y = x;
  for (let pass = 0; pass < 2; pass++) {
    const w0 = (2 * Math.PI * f0) / sr;
    const cs = Math.cos(w0);
    const al = Math.sin(w0) / (2 * Math.SQRT1_2);
    const lp = type === 'lowpass';
    const b0 = lp ? (1 - cs) / 2 : (1 + cs) / 2;
    const b1 = lp ? 1 - cs : -(1 + cs);
    const a0 = 1 + al;
    const a1 = -2 * cs;
    const a2 = 1 - al;
    const out = new Float32Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = (b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = y[i]; y2 = y1; y1 = v; out[i] = v;
    }
    y = out;
  }
  return y;
}

// Windowed-sinc read at a fractional position; `cut` < 1 lowers the cutoff (for downsampling).
function sincAt(x, pos, taps, cut = 1) {
  const i0 = Math.floor(pos);
  const span = Math.ceil(taps / cut);
  let s = 0;
  let ws = 0;
  for (let j = i0 - span + 1; j <= i0 + span; j++) {
    if (j < 0 || j >= x.length) continue;
    const t = (j - pos) * cut;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const w = sinc * (0.5 + 0.5 * Math.cos((Math.PI * t) / taps));
    s += x[j] * w;
    ws += w;
  }
  return ws ? s / ws : 0;
}

export function resample(x, from, to) {
  if (from === to) return x;
  const ratio = to / from;
  const y = new Float32Array(Math.floor(x.length * ratio));
  const cut = Math.min(1, ratio) * 0.95;
  for (let i = 0; i < y.length; i++) y[i] = sincAt(x, i / ratio, 24, cut);
  return y;
}

// Normalised autocorrelation of x[s0, s0+win) with itself at fractional lag L.
function acfAt(x, s0, win, L) {
  const Li = Math.floor(L);
  const fr = L - Li;
  let num = 0, e1 = 0, e2 = 0;
  for (let i = 0; i < win; i++) {
    const a = x[s0 + i];
    const b = x[s0 + i + Li] * (1 - fr) + x[s0 + i + Li + 1] * fr;
    num += a * b;
    e1 += a * a;
    e2 += b * b;
  }
  return num / Math.sqrt(e1 * e2 + 1e-12);
}

// Tracks the engine cycle (two crank turns, so rpm = 120 / period) from t0 outwards, staying
// within `tol` of the previous estimate. The waveform repeats exactly once per cycle, which
// makes this robust for any cylinder count.
export function trackCycle(x, sr, { t0, rpm, tStart, tEnd, hop = 0.005, cycles = 3, tol = 0.05, search = 0.1 }) {
  const est = (tc, T, range) => {
    const win = Math.max(64, Math.floor(cycles * T * sr));
    const s0 = Math.floor(tc * sr - win / 2 - (T * sr) / 2);
    if (s0 < 0 || s0 + win + T * sr * (1 + range) + 2 >= x.length) return null;
    const lo = T * (1 - range) * sr;
    const hi = T * (1 + range) * sr;
    const step = Math.max(0.25, (hi - lo) / 400);
    let best = -2;
    let bl = lo;
    for (let L = lo; L <= hi; L += step) {
      const r = acfAt(x, s0, win, L);
      if (r > best) { best = r; bl = L; }
    }
    let a = bl - step;
    let b = bl + step;
    for (let it = 0; it < 20; it++) {
      const m1 = a + (b - a) / 3;
      const m2 = b - (b - a) / 3;
      if (acfAt(x, s0, win, m1) > acfAt(x, s0, win, m2)) b = m2;
      else a = m1;
    }
    const L = (a + b) / 2;
    return { T: L / sr, r: acfAt(x, s0, win, L) };
  };
  const first = est(t0, 120 / rpm, search);
  const pts = [{ t: t0, ...first }];
  for (const dir of [1, -1]) {
    let T = first.T;
    for (let t = t0 + dir * hop; dir > 0 ? t <= tEnd : t >= tStart; t += dir * hop) {
      const e = est(t, T, tol);
      if (!e) break;
      T = e.T;
      pts.push({ t, ...e });
    }
  }
  pts.sort((a, b) => a.t - b.t);
  // Smooth (log period, weighted by correlation) over +-30 ms.
  return pts.map((p) => {
    let s = 0;
    let n = 0;
    for (const q of pts) {
      if (Math.abs(q.t - p.t) <= 0.03) {
        const k = Math.max(0.05, q.r);
        s += Math.log(q.T) * k;
        n += k;
      }
    }
    return { t: p.t, T: Math.exp(s / n), r: p.r };
  });
}

export function periodAt(track, t) {
  if (t <= track[0].t) return track[0].T;
  const last = track[track.length - 1];
  if (t >= last.t) return last.T;
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (track[m].t <= t) lo = m;
    else hi = m;
  }
  const a = track[lo];
  const b = track[hi];
  return a.T + ((b.T - a.T) * (t - a.t)) / (b.t - a.t);
}

// Resamples `cycles + extra` engine cycles centred on tc so the period is constant (the
// period at tc): a short piece of a sweep becomes a steady-rpm piece.
export function flatten(x, sr, track, tc, cycles, extra) {
  const Tc = periodAt(track, tc);
  const total = cycles + extra;
  const t0 = Math.max(0, tc - total * Tc - 0.05);
  const t1 = Math.min(x.length / sr, tc + total * Tc + 0.05);
  const dt = 0.0005;
  const ts = [];
  const ph = [];
  let p = 0;
  for (let t = t0; t <= t1 + dt; t += dt) {
    ts.push(t);
    ph.push(p);
    p += dt / periodAt(track, t + dt / 2);
  }
  const phaseAt = (t) => {
    const i = Math.min(ts.length - 2, Math.max(0, Math.floor((t - t0) / dt)));
    return ph[i] + ((t - ts[i]) / dt) * (ph[i + 1] - ph[i]);
  };
  const timeAt = (target) => {
    let lo = 0;
    let hi = ph.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ph[m] <= target) lo = m;
      else hi = m;
    }
    return ts[lo] + ((ts[hi] - ts[lo]) * (target - ph[lo])) / (ph[hi] - ph[lo]);
  };
  const start = phaseAt(tc) - total / 2;
  const n = Math.round(total * Tc * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = sincAt(x, timeAt(start + i / sr / Tc) * sr, 24);
  return { out, T: Tc, L: Math.round(cycles * Tc * sr), X: Math.round(extra * Tc * sr) };
}

// Evens out slow level changes (a sweep getting louder, an exhaust resonance, a car circling
// the mic) so a loop doesn't pulse each time it repeats: divides by the RMS envelope measured
// over `win` samples (keep it longer than an engine cycle so the firing beat stays), to the
// power k (1 = fully even).
export function evenOut(x, win, k = 1) {
  const n = x.length;
  const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + x[i] * x[i];
  const total = Math.sqrt(sq[n] / n) + 1e-12;
  const h = Math.max(1, Math.floor(win / 2));
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h);
    const b = Math.min(n, i + h);
    const e = Math.sqrt((sq[b] - sq[a]) / (b - a)) + 1e-12;
    y[i] = x[i] * (total / e) ** k;
  }
  return y;
}

// Loop of exactly L samples whose end flows into its start: the X samples after the loop are
// crossfaded over its first X samples. power = true for noise (equal power), false for
// phase-aligned engine cycles (equal gain).
export function makeLoop(src, L, X0, power = false) {
  const X = Math.min(X0, src.length - L);
  const body = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    if (i >= X) {
      body[i] = src[i];
      continue;
    }
    const u = (i + 0.5) / X;
    const wIn = power ? Math.sin((Math.PI / 2) * u) : 0.5 - 0.5 * Math.cos(Math.PI * u);
    const wOut = power ? Math.cos((Math.PI / 2) * u) : 1 - wIn;
    body[i] = src[i] * wIn + src[i + L] * wOut;
  }
  return body;
}

// Share of in-loop sample steps bigger than the step across the seam: ~0 means a click.
export function seamRank(body) {
  const seam = Math.abs(body[0] - body[body.length - 1]);
  let bigger = 0;
  for (let i = 1; i < body.length; i++) if (Math.abs(body[i] - body[i - 1]) > seam) bigger++;
  return bigger / (body.length - 1);
}

export function rmsDb(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / x.length + 1e-20);
}

export function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

// Scales to a target RMS, but never above `maxPeak` (linear).
export function normalize(x, targetDb, maxPeak = 0.89) {
  let k = 10 ** ((targetDb - rmsDb(x)) / 20);
  const p = peakOf(x);
  if (p * k > maxPeak) k = maxPeak / p;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * k;
  return y;
}
