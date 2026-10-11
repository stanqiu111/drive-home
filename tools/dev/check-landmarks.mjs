// Landmark road check on every map: no landmark model may stand on the driven road
// (see "Road structures" in CLAUDE.md). The check is slow, so the game only runs it when
// opened with ?checkLandmarks; this script does that for each map and prints the result.
//   npm run dev   (in another terminal), then:
//   node tools/dev/check-landmarks.mjs [port=5173] [map,map,...]
// Exits with code 1 when a landmark is on the road. Needs Google Chrome and puppeteer-core.
import puppeteer from 'puppeteer-core';

const [port = '5173', list] = process.argv.slice(2);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const index = await (await fetch(`http://localhost:${port}/maps/index.json`)).json();
const maps = list ? list.split(',') : index.map((m) => m.id);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
let bad = 0;
for (const map of maps) {
  const page = await browser.newPage();
  const warnings = [];
  let summary = null;
  page.on('console', (m) => {
    const text = m.text();
    if (text.startsWith('Landmark check')) summary = text;
    else if (/^Landmark \S+ stands on the driven road/.test(text)) warnings.push(text);
  });
  page.on('pageerror', (e) => warnings.push(`page error: ${e.message}`));
  await page.evaluateOnNewDocument((m) => localStorage.setItem('driveHome.prefs', JSON.stringify({ map: m, car: 'modelx' })), map);
  await page.goto(`http://localhost:${port}/?checkLandmarks`, { waitUntil: 'domcontentloaded' });
  const t0 = Date.now();
  while (!summary && Date.now() - t0 < 180000) await new Promise((r) => setTimeout(r, 200));
  console.log(`${map.padEnd(11)} ${summary ?? 'no result (timed out)'}`);
  for (const w of warnings) console.log(`  ${w}`);
  if (!summary || warnings.length) bad++;
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
