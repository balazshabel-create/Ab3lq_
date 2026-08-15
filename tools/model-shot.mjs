/**
 * model-shot.mjs — screenshot one or more animal models from the turntable page.
 *
 *   node tools/model-shot.mjs hunter tiger crocodile
 *
 * Starts the Vite dev server itself, so there is nothing to remember to run
 * first. Writes screenshots/model-<species>.png.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const species = process.argv.slice(2);
if (species.length === 0) species.push('hunter');

const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

/** Wait for Vite to print its address, or give up. */
const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 30000);
  vite.stdout.on('data', (chunk) => {
    if (String(chunk).includes('localhost:5199')) {
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

for (const s of species) {
  const angles = [0, 1.9];
  for (let i = 0; i < angles.length; i++) {
    await page.goto(`http://localhost:5199/tools/model-view.html?species=${s}&angle=${angles[i]}`, {
      waitUntil: 'load',
    });
    await page.waitForFunction('window.__modelReady === true', { timeout: 30000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/model-${s}-${i}.png` });
    console.log(`wrote ${OUT}/model-${s}-${i}.png`);
  }
}

await browser.close();
vite.kill();
process.exit(0);
