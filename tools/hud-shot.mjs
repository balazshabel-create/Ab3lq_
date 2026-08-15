/**
 * hud-shot.mjs — screenshot the HUD on its own.
 *
 *   node tools/hud-shot.mjs [query]
 *
 * Starts Vite, loads tools/hud-view.html, writes screenshots/hud-panel.png.
 * No WebGL, so it takes about a second even on a software rasteriser — which is
 * the whole point: checking a HUD change by playing a round costs minutes here.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const query = process.argv[2] ?? '';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const vite = spawn('npx', ['vite', '--port', '5198', '--strictPort'], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
vite.stderr.on('data', (c) => process.stderr.write(c));

let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  try {
    const res = await fetch('http://localhost:5198/tools/hud-view.html');
    ready = res.ok;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!ready) {
  vite.kill();
  throw new Error('vite did not start');
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE:', m.text().slice(0, 300));
});

await page.goto(`http://localhost:5198/tools/hud-view.html?${query}`, { waitUntil: 'load' });
await page.waitForFunction('window.__hudReady === true', { timeout: 30000 });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/hud-panel.png` });
console.log(`wrote ${OUT}/hud-panel.png`);

await browser.close();
vite.kill();
process.exit(0);
