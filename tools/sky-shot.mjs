/**
 * sky-shot.mjs — photograph the sky dome on its own, in each weather.
 *
 *   node tools/sky-shot.mjs [weathers...]
 *
 * Writes screenshots/sky-<weather>.png. The point is iteration speed: the sky
 * is a shader, and a shader is tuned by looking at it twenty times.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const weathers = process.argv.slice(2);
if (weathers.length === 0) weathers.push('clear', 'cloudy', 'storm');

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
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message.slice(0, 300)));

for (const w of weathers) {
  await page.goto(`http://localhost:5196/tools/sky-view.html?weather=${w}&hour=15&pitch=0.7`, {
    waitUntil: 'load',
  });
  await page.waitForFunction('window.__skyReady === true', { timeout: 60000 });
  await page.screenshot({ path: `${OUT}/sky-${w}.png` });
  console.log(`wrote ${OUT}/sky-${w}.png`);
}

await browser.close();
vite.kill();
process.exit(0);
