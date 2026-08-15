/**
 * foot-shot.mjs — close-ups of one animal's front foot.
 *
 *   node tools/foot-shot.mjs crocodile turtle tiger
 *
 * Feet are the one part of these models that is too small to judge from the
 * turntable framing: at the distance that shows a silhouette a toe is a couple
 * of pixels. This drives the same page with `zoom` and `at`, from two angles,
 * and writes screenshots/foot-<species>-<n>.png.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const species = process.argv.slice(2);
if (species.length === 0) species.push('crocodile');

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
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

for (const s of species) {
  // Ask the page where this animal's front foot actually is rather than
  // guessing from the silhouette: the plans put their limbs in different places.
  await page.goto(`http://localhost:5198/tools/model-view.html?species=${s}&detail=1`, {
    waitUntil: 'load',
  });
  await page.waitForFunction('window.__modelReady === true', { timeout: 30000 });
  const foot = await page.evaluate(() => window.__footTarget);
  // Zoom by how big the animal is: seven times on a tortoise puts the camera
  // twenty centimetres away, inside the shell.
  const size = await page.evaluate(() => window.__modelSize ?? 1);
  const zoom = size > 1.5 ? 7 : 3;
  const at = foot ? `${foot[0]},${foot[1]},${foot[2]}` : '0,0.1,0';
  for (const [i, angle] of [0.9, 2.4].entries()) {
    await page.goto(
      `http://localhost:5198/tools/model-view.html?species=${s}&detail=1&zoom=${zoom}&angle=${angle}&at=${at}`,
      { waitUntil: 'load' },
    );
    await page.waitForFunction('window.__modelReady === true', { timeout: 30000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/foot-${s}-${i}.png` });
    console.log(`wrote ${OUT}/foot-${s}-${i}.png`);
  }
}

await browser.close();
vite.kill();
process.exit(0);
