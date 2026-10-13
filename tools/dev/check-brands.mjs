// Brand road check: nothing from brand-sites.js (gas station canopies, forecourts, pylons,
// price signs, portals) may stand on the driven road. Like the landmark check, every
// triangle of the brand/sign meshes is sampled and tested against the road edges, from
// 0.05 m to 4.5 m above the surface; what lies before the start or past the finish doesn't
// count (no road goes on there). Also reports console errors.
//   npm run dev   (in another terminal), then:
//   node tools/dev/check-brands.mjs [port=5173] [map,map,...]   (default: every map)
// Exit code 1 if anything stands on the road. Needs Google Chrome and puppeteer-core.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [port = '5173', list] = process.argv.slice(2);
const maps = list ? list.split(',') : JSON.parse(fs.readFileSync(path.join(ROOT, 'public/maps/index.json'), 'utf8')).map((m) => m.id);

const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
let bad = 0;
for (const map of maps) {
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 720 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await p.evaluateOnNewDocument((id) => {
    localStorage.setItem('driveHome.prefs', JSON.stringify({ map: id, car: 'modelx', colors: {} }));
    localStorage.setItem('driveHome.muted', '1');
  }, map);
  await p.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__game?.S.mode === 'menu' && !document.getElementById('loading').classList.contains('show'), { timeout: 180000 });
  const res = await p.evaluate(() => {
    const g = window.__game;
    const route = g.route;
    const CELL = 20;
    const grid = new Map();
    for (let i = 0; i < route.n; i++) {
      const k = `${Math.floor(route.x[i] / CELL)},${Math.floor(route.z[i] / CELL)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    const f = {};
    const routeAt = (x, z) => {
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      let best = -1;
      let bd = 40 * 40;
      for (let a = -2; a <= 2; a++) {
        for (let c = -2; c <= 2; c++) {
          for (const i of grid.get(`${cx + a},${cz + c}`) ?? []) {
            const d = (route.x[i] - x) ** 2 + (route.z[i] - z) ** 2;
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      if (best < 0) return null;
      const f0 = route.frame(best * route.step, f);
      const along = best * route.step + (x - f0.x) * f0.tx + (z - f0.z) * f0.tz;
      if (along < 0 || along > route.length) return null; // before the start or past the finish
      route.frame(along, f);
      return { s: along, lat: -(x - f.x) * f.tz + (z - f.z) * f.tx, left: f.left, right: f.right, y: f.y };
    };
    const W = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]];
    const signs = g.world.group.getObjectByName('signs');
    if (!signs) return { tris: 0, hits: [], nHits: 0, missing: true };
    signs.updateMatrixWorld(true);
    const hits = [];
    let tris = 0;
    const v = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const e = new Float32Array(16);
    signs.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      const idx = o.geometry.index;
      const n = idx ? idx.count : pos.count;
      o.matrixWorld.toArray(e);
      const at = (j, out) => {
        const x = pos.getX(j);
        const y = pos.getY(j);
        const z = pos.getZ(j);
        out[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
        out[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        out[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      };
      for (let t = 0; t + 2 < n; t += 3) {
        tris++;
        for (let q = 0; q < 3; q++) at(idx ? idx.getX(t + q) : t + q, v[q]);
        for (const w of W) {
          const x = v[0][0] * w[0] + v[1][0] * w[1] + v[2][0] * w[2];
          const y = v[0][1] * w[0] + v[1][1] * w[1] + v[2][1] * w[2];
          const z = v[0][2] * w[0] + v[1][2] * w[1] + v[2][2] * w[2];
          const r = routeAt(x, z);
          if (!r || y < r.y + 0.05 || y > r.y + 4.5) continue;
          if (r.lat > r.left - 0.1 && r.lat < r.right + 0.1) {
            hits.push([Math.round(r.s), +r.lat.toFixed(1), +(y - r.y).toFixed(1)]);
            break;
          }
        }
      }
    });
    return { tris, hits: hits.slice(0, 10), nHits: hits.length };
  });
  if (res.nHits || errors.length || res.missing) bad++;
  console.log(`${map.padEnd(12)}${res.missing ? 'no brand meshes found' : `${res.tris} triangles checked, ${res.nHits} on the driven road`}${res.nHits ? ` (s, lat, height: ${JSON.stringify(res.hits)})` : ''}${errors.length ? ` ERRORS ${JSON.stringify(errors.slice(0, 3))}` : ''}`);
  await p.close();
}
await b.close();
process.exitCode = bad ? 1 : 0;
