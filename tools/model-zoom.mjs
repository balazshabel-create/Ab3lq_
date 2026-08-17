/**
 * model-zoom.mjs — one framed close-up of a model.
 *
 *   node tools/model-zoom.mjs tiger 3 0.4,0.9,0 1.9
 *
 * model-shot.mjs answers "does the animal read right"; this answers "what is
 * that shape on its shoulder", which needs the camera in close and pointed at
 * a spot rather than at the animal. Arguments: species, zoom, look-at point,
 * turntable angle.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [species = 'tiger', zoom = '3', at = '0,0.5,0', angle = '1.9'] = process.argv.slice(2);
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const vite = spawn('npx', ['vite', '--port', '5198', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 30000);
  vite.stdout.on('data', (chunk) => {
    if (String(chunk).includes('localhost:5198')) {
      clearTimeout(timer);
      resolve(true);
    }
  });
});
if (!ready) {
  vite.kill();
  throw new Error('vite did not start');
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

const url =
  `http://localhost:5198/tools/model-view.html?species=${species}` +
  `&zoom=${zoom}&at=${at}&angle=${angle}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__modelReady === true', { timeout: 30000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/zoom-${species}.png` });
console.log(`wrote ${OUT}/zoom-${species}.png`);

await browser.close();
vite.kill();
process.exit(0);
