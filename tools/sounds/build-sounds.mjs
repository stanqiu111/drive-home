// Builds the game's recorded sounds: downloads the CC0 recordings listed in sources.mjs
// (Freesound preview MP3s, no account needed), cuts steady-rpm engine loops out of them the
// way racing games do, and writes
//   public/sounds/*.m4a   one AAC file per pack, every loop padded so it can loop seamlessly
//   src/sound-samples.js  where each loop sits in its file, its rpm and length
// Run: node tools/sounds/build-sounds.mjs        (macOS: needs /usr/bin/afconvert)
// Downloads and work files go to tools/cache/sounds/ (gitignored).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readWav, writeWav, filter4, resample, trackCycle, flatten, evenOut, makeLoop, seamRank, normalize, rmsDb, peakOf } from './lib.mjs';
import { SOURCES, PACKS, FX } from './sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, 'tools/cache/sounds');
const OUT = path.join(ROOT, 'public/sounds');
const SR = 32000; // engine and effect content stays below 14 kHz
const PAD = 0.12; // periodic padding around each loop (s): any loop-length window inside loops cleanly
const GAP = 0.1; // silence around one-shots (s)
const BITRATE = 96000;
const AFCONVERT = '/usr/bin/afconvert';

if (!fs.existsSync(AFCONVERT)) {
  console.error('This tool needs macOS afconvert (/usr/bin/afconvert) to decode MP3 and encode AAC.');
  process.exit(1);
}
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

async function source(key) {
  const s = SOURCES[key];
  const mp3 = path.join(CACHE, `${s.id}.mp3`);
  const wav = path.join(CACHE, `${s.id}.wav`);
  if (!fs.existsSync(mp3)) {
    const r = await fetch(s.preview, { headers: { 'User-Agent': 'DriveHome sound builder' } });
    if (!r.ok) throw new Error(`download failed ${r.status}: ${s.preview}`);
    fs.writeFileSync(mp3, Buffer.from(await r.arrayBuffer()));
    console.log(`downloaded ${key} (${s.title} by ${s.author})`);
  }
  if (!fs.existsSync(wav)) execFileSync(AFCONVERT, ['-f', 'WAVE', '-d', 'LEI16', mp3, wav]);
  return wav;
}

const loaded = new Map();
async function load(key) {
  if (!loaded.has(key)) {
    const { x, sr } = readWav(await source(key));
    let y = filter4(x, sr, 'highpass', 18);
    y = filter4(y, sr, 'lowpass', 14000);
    loaded.set(key, resample(y, sr, SR));
  }
  return loaded.get(key);
}

function pad(body, n) {
  const out = new Float32Array(body.length + 2 * n);
  for (let i = 0; i < out.length; i++) out[i] = body[(((i - n) % body.length) + body.length) % body.length];
  return out;
}

// Concatenates pieces into one sprite; returns the sprite and each piece's start (s).
function sprite(pieces) {
  const total = pieces.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  const starts = [];
  for (const p of pieces) {
    out.set(p, at);
    starts.push(at / SR);
    at += p.length;
  }
  return { out, starts };
}

function encode(name, x) {
  const wav = path.join(CACHE, `${name}.wav`);
  const m4a = path.join(OUT, name);
  writeWav(wav, SR, x);
  execFileSync(AFCONVERT, [wav, m4a, '-f', 'm4af', '-d', 'aac', '-b', String(BITRATE)]);
  return fs.statSync(m4a).size;
}

const manifest = {};
const r1 = (v, d = 1e6) => Math.round(v * d) / d;

for (const [packId, pack] of Object.entries(PACKS)) {
  const pieces = [];
  const items = [];
  for (const lp of pack.loops) {
    const x = await load(lp.src);
    const track = trackCycle(x, SR, { t0: lp.t, rpm: lp.rpm, tStart: lp.range[0], tEnd: lp.range[1], ...(lp.track || {}) });
    const { out, T, L, X } = flatten(x, SR, track, lp.t, lp.cycles, lp.extra);
    // Even out level drift over 3+ engine cycles, then loop.
    const even = evenOut(out, Math.round(Math.max(3 * T, 0.12) * SR), 1);
    const body = normalize(makeLoop(even, L, X, false), -18);
    const n = Math.round(PAD * SR);
    pieces.push(pad(body, n));
    const rpm = 120 / T;
    items.push({ id: lp.id, load: lp.load, rpm: r1(rpm, 10), len: r1(L / SR), pad: n / SR });
    console.log(`${packId}.${lp.id}: ${rpm.toFixed(0)} rpm, ${(L / SR).toFixed(3)} s (${lp.cycles} cycles), seam ${seamRank(body).toFixed(2)}, peak ${(20 * Math.log10(peakOf(body))).toFixed(1)} dB`);
  }
  const { out, starts } = sprite(pieces);
  items.forEach((it, i) => {
    it.at = r1(starts[i] + it.pad);
    delete it.pad;
  });
  const bytes = encode(pack.file, out);
  manifest[packId] = { file: pack.file, items };
  console.log(`  -> public/sounds/${pack.file} ${(out.length / SR).toFixed(2)} s, ${(bytes / 1024).toFixed(0)} KB`);
}

{
  const pieces = [];
  const items = [];
  for (const f of FX.items) {
    let x = await load(f.src);
    if (f.hp) x = filter4(x, SR, 'highpass', f.hp);
    if (f.lp) x = filter4(x, SR, 'lowpass', f.lp);
    const s0 = Math.round(f.t0 * SR);
    const L = Math.round(f.len * SR);
    if (f.oneShot) {
      const body = x.slice(s0, s0 + L);
      const fi = Math.round(f.fadeIn * SR);
      const fo = Math.round(f.fadeOut * SR);
      for (let i = 0; i < fi; i++) body[i] *= i / fi;
      for (let i = 0; i < fo; i++) body[L - 1 - i] *= (i / fo) ** 2;
      const g = Math.round(GAP * SR);
      const piece = new Float32Array(L + 2 * g);
      piece.set(normalize(body, f.db), g);
      pieces.push(piece);
      items.push({ id: f.id, len: r1(L / SR), skip: GAP, oneShot: true });
    } else {
      let src = x.subarray(s0, s0 + L + Math.round(f.xf * SR));
      if (f.even) src = evenOut(src, Math.round(f.even[0] * SR), f.even[1]);
      const body = normalize(makeLoop(src, L, Math.round(f.xf * SR), true), f.db);
      pieces.push(pad(body, Math.round(PAD * SR)));
      items.push({ id: f.id, len: r1(L / SR), skip: PAD });
      console.log(`fx.${f.id}: ${(L / SR).toFixed(2)} s loop, seam ${seamRank(body).toFixed(2)}, rms ${rmsDb(body).toFixed(1)} dB`);
    }
  }
  const { out, starts } = sprite(pieces);
  items.forEach((it, i) => {
    it.at = r1(starts[i] + it.skip);
    delete it.skip;
  });
  const bytes = encode(FX.file, out);
  manifest.fx = { file: FX.file, items };
  console.log(`  -> public/sounds/${FX.file} ${(out.length / SR).toFixed(2)} s, ${(bytes / 1024).toFixed(0)} KB`);
}

const obj = (o) => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : v}`).join(', ')} }`;
const packs = Object.entries(manifest).map(([id, p]) => `  ${id}: {\n    file: '${p.file}',\n    items: [\n${p.items.map((it) => `      ${obj(it)},`).join('\n')}\n    ],\n  },`);
const js = `// Generated by tools/sounds/build-sounds.mjs from the recordings in tools/sounds/sources.mjs.
// Don't edit by hand: change sources.mjs and run the tool again.
// Each pack is one AAC file in public/sounds/. For a loop, \`at\` is where it starts (s), \`len\`
// its length (s) and \`rpm\` the engine speed it was recorded at; the file holds a copy of the
// loop's end before \`at\` and of its start after it, so it loops cleanly from \`at\` to \`at + len\`.
export const SAMPLE_RATE = ${SR};
export const SAMPLE_PACKS = {
${packs.join('\n')}
};
`;
fs.writeFileSync(path.join(ROOT, 'src/sound-samples.js'), js);
console.log('wrote src/sound-samples.js');
