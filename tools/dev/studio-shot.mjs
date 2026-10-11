// Screenshot of a dev page that sets window.ready (car-studio.html, landmark-studio.html).
//   node tools/dev/studio-shot.mjs "http://localhost:5173/car-studio.html?id=crv" out.png
// Prints the page's window.info. Needs Google Chrome and the puppeteer-core dev dependency.
import puppeteer from 'puppeteer-core';

const [url, out = 'studio.png'] = process.argv.slice(2);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.setViewport({ width: 1800, height: 1030 });
p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto(url, { waitUntil: 'load' });
await p.waitForFunction('window.ready === true', { timeout: 60000 });
console.log(JSON.stringify(await p.evaluate(() => window.info)));
await p.screenshot({ path: out });
await b.close();
