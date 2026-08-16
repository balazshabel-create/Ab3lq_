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
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE:', m.text().slice(0, 300));
});

await page.goto(`http://localhost:5198/tools/hud-view.html?${query}`, { waitUntil: 'load' });
await page.waitForFunction('window.__hudReady === true', { timeout: 30000 });
await page.waitForTimeout(700);
// Crop to the dial rather than the whole screen: the corner is 160 px of a
// 1440 px frame, and reading it out of a full screenshot is guesswork.
await page.locator('.vitals').screenshot({ path: `${OUT}/hud-dial.png` });
await page.screenshot({ path: `${OUT}/hud-panel.png` });
/*
 * The crosshair is 26 px in the middle of the frame and cannot be judged from
 * the full screenshot at all, so it gets its own crop — clipped generously and
 * scaled up, because what matters is whether the ticks survive their outline.
 */
const centre = { x: 720 - 60, y: 405 - 60, width: 120, height: 120 };
// The score readout and whatever is floating out of it, top left.
await page.screenshot({ path: `${OUT}/hud-score.png`, clip: { x: 0, y: 0, width: 260, height: 200 } });
await page.screenshot({ path: `${OUT}/hud-crosshair.png`, clip: centre });
console.log(`wrote ${OUT}/hud-panel.png, hud-dial.png and hud-crosshair.png`);

await browser.close();
vite.kill();
process.exit(0);
