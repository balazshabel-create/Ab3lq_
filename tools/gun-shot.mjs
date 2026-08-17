/**
 * gun-shot.mjs — photograph the gun the hunter sees.
 *
 *   node tools/gun-shot.mjs
 *
 * The viewmodel is the one object in the game that cannot be photographed from
 * the turntable: it lives on the camera rather than in the world, at a scale
 * where a millimetre of model is a centimetre of screen. It is also the thing
 * one player looks at for a whole round, so it is worth its own script.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const vite = spawn('npx', ['vite', '--port', '5196', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 30000);
  vite.stdout.on('data', (chunk) => {
    if (String(chunk).includes('localhost:5196')) {
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

await page.goto('http://localhost:5196/tools/model-view.html?viewmodel=1', { waitUntil: 'load' });
await page.waitForFunction('window.__modelReady === true', { timeout: 30000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/gun-viewmodel.png` });
console.log(`wrote ${OUT}/gun-viewmodel.png`);

await browser.close();
vite.kill();
process.exit(0);
