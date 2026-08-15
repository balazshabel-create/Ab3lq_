/**
 * tree-shot.mjs — screenshot each tree variant, alone and as a stand.
 *
 *   node tools/tree-shot.mjs [variants...]
 *
 * Writes screenshots/tree-<variant>.png (one tree) and tree-<variant>-stand.png
 * (five of them), because a canopy either closes or it does not and a single
 * specimen cannot tell you which.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const variants = process.argv.slice(2);
if (variants.length === 0) variants.push('0', '1', '2');

const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const vite = spawn('npx', ['vite', '--port', '5197', '--strictPort'], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
vite.stderr.on('data', (c) => process.stderr.write(c));

let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  try {
    const res = await fetch('http://localhost:5197/tools/tree-view.html');
    ready = res.ok;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!ready) {
  vite.kill();
  throw new Error('vite did not start');
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message.slice(0, 300)));

for (const v of variants) {
  for (const [suffix, count] of [['', 1], ['-stand', 5]]) {
    await page.goto(
      `http://localhost:5197/tools/tree-view.html?variant=${v}&detail=2&count=${count}`,
      { waitUntil: 'load' },
    );
    await page.waitForFunction('window.__treeReady === true', { timeout: 60000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/tree-${v}${suffix}.png` });
    console.log(`wrote ${OUT}/tree-${v}${suffix}.png`);
  }
}

await browser.close();
vite.kill();
process.exit(0);
