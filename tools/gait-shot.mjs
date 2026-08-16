/**
 * gait-shot.mjs — photograph one stride, frame by frame.
 *
 *   node tools/gait-shot.mjs jaguar 1        # species, gait
 *
 * Writes screenshots/gait-<species>-<gait>-<n>.png for eight points across a
 * single stride, and a contact sheet is then just looking at them in order.
 *
 * A live animation cannot be reviewed here — the software rasteriser runs at a
 * frame every second or two — so the cycle has to be sampled instead. Eight
 * stills in stride order answer the only questions that matter: are the
 * footfalls in the right sequence, does each foot leave the ground, and does
 * the body do anything while they do.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const species = process.argv[2] ?? 'jaguar';
const gait = process.argv[3] ?? '1';
const turn = process.argv[4] ?? '0';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const vite = spawn('npx', ['vite', '--port', '5194', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 30000);
  vite.stdout.on('data', (chunk) => {
    if (String(chunk).includes('localhost:5194')) {
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
const page = await browser.newPage({ viewport: { width: 640, height: 420 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message.slice(0, 300)));

for (let frame = 0; frame < 8; frame++) {
  const url =
    `http://localhost:5194/tools/gait-view.html?species=${species}` +
    `&gait=${gait}&turn=${turn}&frame=${frame}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__gaitReady === true', { timeout: 60000 });
  await page.screenshot({ path: `${OUT}/gait-${species}-${gait}-${frame}.png` });
}
console.log(`wrote ${OUT}/gait-${species}-${gait}-0..7.png`);

await browser.close();
vite.kill();
process.exit(0);
