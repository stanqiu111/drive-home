// Performance measurements in headless Chrome on the real graphics chip (see "Performance"
// in CLAUDE.md for the targets). Run one at a time, on a quiet machine, and repeat anything
// that matters: other programs on the computer change the numbers.
//
//   npm run dev  (or: npm run build && npx vite preview --port 4174), then:
//   node tools/dev/perf.mjs switch [options]   map switching in the menu, by real clicks
//   node tools/dev/perf.mjs drive  [options]   a scripted 40 s drive: gas, nitro, crashes,
//                                              all four power-ups, four spots along the route
//   node tools/dev/perf.mjs firsts [options]   the first nitro, crash, smoke, power-ups and
//                                              finish of a session: slow frames, shaders built
// Options:
//   --port 5173        dev server (drive and firsts need it: they use window.__game);
//                      switch also works on a production preview (--port 4174)
//   --maps a,b         maps to use (drive: home,sherwood,refinery,snowvalley; firsts: home)
//   --throttle 4       slow the processor down 4x (a busy or older machine)
//   --dpr 2 --width 1440 --height 900   screen to emulate (default: the Retina MacBook Air)
//   --monitor 2560x1440  drive: after loading, move the window to a 1x monitor this size
//   --uncapped         no 60 Hz limit: frame times then show how much headroom is left
//   --seconds 40       drive length
//   --out file.jsonl   also append the results there; --label name tags them
// Output: one JSON line per result. Frame times are the gaps between frames (ms): p50, p95,
// p99, max, and how many were over 20 ms and 33 ms; cpu = the game's own work per frame,
// gpu = graphics chip time per frame (timer query), draws = draw calls per frame, ktris =
// thousands of triangles per frame, links = shaders built during frames (should be 0).
// switch: loadMs = click to map shown, longestTask = longest freeze of the page (ms, tasks
// over 50 ms only), maxFrameGap = longest gap between drawn frames (the menu draws at 30 fps,
// so 33 is normal).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const args = process.argv.slice(2);
const mode = args[0] || 'drive';
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const PORT = opt('port', '5173');
const THROTTLE = Number(opt('throttle', '1'));
const DPR = Number(opt('dpr', '2'));
const W = Number(opt('width', '1440'));
const H = Number(opt('height', '900'));
const OUT = opt('out', null);
const LABEL = opt('label', '');
const SECONDS = Number(opt('seconds', '40'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const r1 = (v) => Math.round(v * 10) / 10;
function emit(obj) {
  const line = JSON.stringify({ label: LABEL, port: PORT, throttle: THROTTLE, dpr: DPR, ...obj });
  console.log(line);
  if (OUT) fs.appendFileSync(OUT, `${line}\n`);
}

// Runs in the page before any game code: per-frame CPU and GPU time, draw calls, triangles,
// shaders linked, long tasks. Math.random is seeded so traffic is repeatable.
function instrument() {
  let seed = 1234567;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const C = { draws: 0, tris: 0, links: 0, linkMs: 0 };
  const P = WebGL2RenderingContext.prototype;
  const wrap = (name, fn) => {
    const orig = P[name];
    P[name] = function (...a) { fn(a); return orig.apply(this, a); };
  };
  wrap('drawArrays', (a) => { C.draws++; if (a[0] === 4) C.tris += a[2] / 3; });
  wrap('drawElements', (a) => { C.draws++; if (a[0] === 4) C.tris += a[1] / 3; });
  wrap('drawArraysInstanced', (a) => { C.draws++; if (a[0] === 4) C.tris += (a[2] / 3) * a[3]; });
  wrap('drawElementsInstanced', (a) => { C.draws++; if (a[0] === 4) C.tris += (a[1] / 3) * a[4]; });
  wrap('linkProgram', () => { C.links++; });
  const gpp = P.getProgramParameter;
  P.getProgramParameter = function (...a) {
    const t0 = performance.now();
    const r = gpp.apply(this, a);
    C.linkMs += performance.now() - t0;
    return r;
  };
  let gl = null;
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = gc.call(this, type, ...rest);
    if (this.id === 'game' && type === 'webgl2' && ctx) gl = ctx;
    return ctx;
  };
  const perf = { frames: [], recording: false, long: [], pending: [] };
  window.__perf = perf;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.long.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* no long task API */ }
  const raf = window.requestAnimationFrame.bind(window);
  let ext;
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (gl && ext === undefined) ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') || null;
    const c0 = { ...C };
    let query = null;
    if (ext && perf.recording) {
      query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    }
    const a = performance.now();
    try {
      cb(t);
    } finally {
      const rec = {
        t, cpu: performance.now() - a, draws: C.draws - c0.draws, tris: C.tris - c0.tris, links: C.links - c0.links, linkMs: C.linkMs - c0.linkMs, gpu: null,
      };
      if (query) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        perf.pending.push([query, rec]);
      }
      // Only frames that drew something count (other rAF users don't render).
      if (perf.recording && rec.draws > 0) perf.frames.push(rec);
      while (perf.pending.length) {
        const [qq, rr] = perf.pending[0];
        if (!gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) break;
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) rr.gpu = gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(qq);
        perf.pending.shift();
      }
    }
  });
}

async function open(map) {
  const extra = args.includes('--uncapped') ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...extra],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (['error', 'warn', 'warning'].includes(m.type())) errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  await page.evaluateOnNewDocument((m) => {
    localStorage.setItem('driveHome.prefs', JSON.stringify({ map: m, car: 'modelx', colors: {} }));
    localStorage.setItem('driveHome.muted', '0');
  }, map);
  await page.evaluateOnNewDocument(instrument);
  const cdp = await page.target().createCDPSession();
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const l = document.getElementById('loading');
    return l && !l.classList.contains('show') && document.getElementById('start').classList.contains('show') && document.querySelector('[data-map]');
  }, { timeout: 180000, polling: 100 });
  return { browser, page, errors, loadMs: Date.now() - t0 };
}

// Frame statistics between two page times.
function stats(frames, from = -Infinity, to = Infinity) {
  const f = frames.filter((x) => x.t >= from && x.t <= to);
  const iv = [];
  for (let i = 1; i < f.length; i++) iv.push(f[i].t - f[i - 1].t);
  const cpu = f.map((x) => x.cpu);
  const gpu = f.map((x) => x.gpu).filter((x) => x != null);
  const avg = (key) => f.reduce((a, x) => a + x[key], 0) / Math.max(1, f.length);
  return {
    frames: f.length,
    fps: r1((f.length - 1) / ((f[f.length - 1]?.t - f[0]?.t) / 1000)),
    p50: r1(q(iv, 0.5)), p95: r1(q(iv, 0.95)), p99: r1(q(iv, 0.99)), max: r1(Math.max(...iv)),
    over20: iv.filter((x) => x > 20).length, over33: iv.filter((x) => x > 33.5).length,
    cpu50: r1(q(cpu, 0.5)), cpu95: r1(q(cpu, 0.95)),
    gpu50: r1(q(gpu, 0.5)), gpu95: r1(q(gpu, 0.95)),
    draws: Math.round(avg('draws')), ktris: Math.round(avg('tris') / 1000),
    links: f.reduce((a, x) => a + x.links, 0),
  };
}

// ---------- map switching in the menu (real clicks) ----------
async function runSwitch() {
  const maps = opt('maps', 'burger,beachclub,noodle,windermere,sherwood,snowvalley,refinery,home').split(',');
  const { browser, page, errors, loadMs } = await open('home');
  emit({ test: 'initial-load', map: 'home', ms: loadMs });
  await page.evaluate(() => { window.__perf.recording = true; });
  await sleep(1500);
  for (const map of maps) {
    await sleep(800);
    const t0 = await page.evaluate(() => performance.now());
    await page.click(`#map-list [data-map="${map}"]`);
    await page.waitForFunction(() => !document.getElementById('loading').classList.contains('show'), { timeout: 180000, polling: 'raf' });
    const tDone = await page.evaluate(() => performance.now());
    await sleep(1500); // the frames right after the new map appears
    const res = await page.evaluate((t0, tDone) => {
      const P = window.__perf;
      const long = P.long.filter(([s, d]) => s + d >= t0 && s <= tDone + 1500);
      const frames = P.frames.filter((f) => f.t >= t0 && f.t <= tDone + 1500);
      let gap = frames.length ? frames[0].t - t0 : 0;
      for (let i = 1; i < frames.length; i++) gap = Math.max(gap, frames[i].t - frames[i - 1].t);
      return {
        loadMs: tDone - t0,
        longest: Math.max(0, ...long.map((l) => l[1])),
        longSum: long.reduce((a, l) => a + l[1], 0),
        gap,
        links: frames.reduce((a, f) => a + f.links, 0),
      };
    }, t0, tDone);
    emit({ test: 'switch', map, loadMs: Math.round(res.loadMs), longestTask: Math.round(res.longest), longTaskSum: Math.round(res.longSum), maxFrameGap: Math.round(res.gap), links: res.links });
  }
  if (errors.length) emit({ test: 'errors', errors: errors.slice(0, 20) });
  await browser.close();
}

// ---------- scripted drive ----------
async function startRace(page) {
  await page.click('#start .go-btn');
  await page.waitForFunction(() => window.__game?.S.mode === 'race', { timeout: 20000, polling: 50 });
}

// Steer into the nearest car ahead (a crash, or a smash with a power-up).
function crashAttempt(page) {
  return page.evaluate(() => {
    const g = window.__game;
    const ahead = g.traffic.cars.filter((c) => c.active && !c.flying && c.s > g.S.s + 8 && c.s < g.S.s + 160).sort((a, b) => a.s - b.s);
    if (ahead.length) g.S.x = ahead[0].lat;
  });
}

async function runDrive() {
  const maps = opt('maps', 'home,sherwood,refinery,snowvalley').split(',');
  for (const map of maps) {
    const { browser, page, errors } = await open(map);
    await sleep(1000);
    const mon = opt('monitor', null);
    if (mon) {
      const [mw, mh] = mon.split('x').map(Number);
      await page.setViewport({ width: mw, height: mh, deviceScaleFactor: 1 });
      await sleep(1000);
    }
    await startRace(page);
    const tStart = await page.evaluate(() => { window.__perf.recording = true; window.__perf.frames = []; return performance.now(); });
    await page.keyboard.down('ArrowUp');
    const seg = (SECONDS * 1000) / 4;
    const powers = ['turbo', 'shield', 'blast', 'fly'];
    for (let k = 0; k < 4; k++) {
      // Four spots along the route: the start, then 22%, 44% and 66% of the way.
      if (k > 0) {
        await page.evaluate((frac) => {
          const g = window.__game;
          g.S.s = Math.max(8, g.route.length * frac);
          g.S.x = g.route.laneLat(0, g.S.s);
        }, k * 0.22);
      }
      await sleep(seg * 0.2);
      await page.keyboard.down('ShiftLeft');
      await sleep(seg * 0.2);
      await page.keyboard.up('ShiftLeft');
      await crashAttempt(page);
      await sleep(seg * 0.25);
      await page.evaluate((p) => window.__game.activatePower(p), powers[k]);
      await crashAttempt(page);
      await sleep(seg * 0.35);
    }
    await page.keyboard.up('ArrowUp');
    const tEnd = await page.evaluate(() => performance.now());
    const data = await page.evaluate(() => {
      const c = document.getElementById('game');
      return { frames: window.__perf.frames, sounds: window.__game.sound.debug.counts, crashes: window.__game.S.crashes, smashed: window.__game.S.smashed, canvas: `${c.width}x${c.height}` };
    });
    emit({ test: 'drive', map, canvas: data.canvas, ...stats(data.frames, tStart, tEnd), crashes: data.crashes, smashed: data.smashed, sounds: data.sounds });
    if (errors.length) emit({ test: 'errors', map, errors: errors.slice(0, 20) });
    await browser.close();
  }
}

// ---------- first-time hitches ----------
async function runFirsts() {
  const maps = opt('maps', 'home').split(',');
  for (const map of maps) {
    const { browser, page, errors } = await open(map);
    await sleep(1000);
    await page.evaluate(() => { window.__perf.recording = true; window.__perf.frames = []; });
    await startRace(page);
    await page.keyboard.down('ArrowUp');
    await sleep(2500);
    const events = [];
    const mark = async (name, fn) => {
      const t0 = await page.evaluate(() => performance.now());
      await fn();
      await sleep(1500);
      const r = await page.evaluate((t0) => {
        const f = window.__perf.frames.filter((x) => x.t >= t0 - 1);
        let worst = 0;
        for (let i = 1; i < f.length; i++) worst = Math.max(worst, f[i].t - f[i - 1].t);
        return { worst, links: f.reduce((a, x) => a + x.links, 0) };
      }, t0);
      events.push({ event: name, worstFrame: Math.round(r.worst), shadersBuilt: r.links });
    };
    await mark('nitro', async () => { await page.keyboard.down('ShiftLeft'); await sleep(600); await page.keyboard.up('ShiftLeft'); });
    await mark('crash', () => crashAttempt(page));
    // Drift smoke: arrive at the sharpest corner far too fast.
    await mark('drift-smoke', () => page.evaluate(() => {
      const g = window.__game;
      const r = g.route;
      let best = 200;
      for (let s = 200; s < r.length - 300; s += 10) if (r.vmaxAt(s) < r.vmaxAt(best)) best = s;
      g.S.s = best - 30;
      g.S.x = r.laneLat(0, g.S.s);
      g.S.speed = 55;
    }));
    await mark('shield', () => page.evaluate(() => window.__game.activatePower('shield')));
    await mark('smash', () => crashAttempt(page));
    await mark('turbo', () => page.evaluate(() => window.__game.activatePower('turbo')));
    await mark('fly', () => page.evaluate(() => window.__game.activatePower('fly')));
    await mark('blast', () => page.evaluate(() => window.__game.activatePower('blast')));
    await page.keyboard.up('ArrowUp');
    await mark('finish', () => page.evaluate(() => window.__game.finish()));
    await sleep(4000);
    emit({ test: 'firsts', map, events, sounds: await page.evaluate(() => window.__game.sound.debug.counts) });
    if (errors.length) emit({ test: 'errors', map, errors: errors.slice(0, 20) });
    await browser.close();
  }
}

if (mode === 'switch') await runSwitch();
else if (mode === 'drive') await runDrive();
else if (mode === 'firsts') await runFirsts();
else console.log('Usage: node tools/dev/perf.mjs switch|drive|firsts [--port 5173] [--maps a,b] [--throttle 4] (see the top of this file)');
