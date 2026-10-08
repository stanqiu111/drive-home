// Screenshots along a route, for checking road lines, landmarks and the world by eye.
//   npm run dev   (in another terminal), then:
//   node tools/dev/shots.mjs <map> <s,s,...> [port=5173] [prefix=shot]
// For each route position s (metres) it saves <prefix>_<map>_<s>_chase.png (driver's view,
// car 30 m before s) and <prefix>_<map>_<s>_high.png (22 m up, looking down the road).
// Needs Google Chrome and the puppeteer-core dev dependency (npm install).
import puppeteer from 'puppeteer-core';

const [map = 'home', list = '500', port = '5173', prefix = 'shot'] = process.argv.slice(2);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await p.evaluateOnNewDocument((map) => localStorage.setItem('driveHome.prefs', JSON.stringify({ map, car: 'modelx' })), map);
await p.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__game && window.__game.S.mode === 'menu', { timeout: 90000 });
await p.evaluate(() => { document.getElementById('start').classList.remove('show'); window.__game.startRace(); });
await new Promise((r) => setTimeout(r, 3500));
for (const s of list.split(',').map(Number)) {
  await p.evaluate((s) => {
    const g = window.__game;
    g.cam = null;
    g.S.s = Math.max(5, s - 30);
    g.S.x = g.route.laneLat(g.route.lanes(g.S.s) - 1, g.S.s);
    g.S.speed = 0.5;
  }, s);
  await new Promise((r) => setTimeout(r, 1200));
  await p.screenshot({ path: `${prefix}_${map}_${s}_chase.png` });
  await p.evaluate((s) => {
    const g = window.__game;
    const a = g.route.toWorld(Math.max(0, s - 45), 0, 22);
    const c = g.route.toWorld(s + 25, 0, 0);
    g.cam = { pos: [a.x, a.y, a.z], look: [c.x, c.y, c.z], fov: 60 };
  }, s);
  await new Promise((r) => setTimeout(r, 900));
  await p.screenshot({ path: `${prefix}_${map}_${s}_high.png` });
}
const fps = await p.evaluate(() => new Promise((res) => {
  let n = 0;
  const t = performance.now();
  const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else res(n / 2); };
  requestAnimationFrame(f);
}));
console.log('fps', fps);
await b.close();
