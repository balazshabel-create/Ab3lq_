/**
 * env-probe.mjs — report what the gun's materials actually got.
 *
 *   node tools/env-probe.mjs
 *
 * Black metal in a screenshot has at least three causes — no environment map, a
 * map that failed to prefilter, or lighting a conductor cannot respond to — and
 * they look identical. This prints the material state (metalness, roughness,
 * which maps are attached) so the question is answered with data instead of
 * another round trip through the renderer. It is how the first environment,
 * built from a hand-packed DataTexture, was shown to be *present and wrong*
 * rather than missing.
 *
 * Renders tools/probe-gun.html, which builds the viewmodel exactly as the game
 * does.
 */

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const vite = spawn('npx', ['vite', '--port', '5195', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 30000);
  vite.stdout.on('data', (chunk) => {
    if (String(chunk).includes('localhost:5195')) {
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
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));

await page.goto('http://localhost:5195/tools/probe-gun.html', { waitUntil: 'load' });
await page.waitForFunction('window.__probe !== undefined', { timeout: 30000 });
console.log(JSON.stringify(await page.evaluate(() => window.__probe), null, 2));

await browser.close();
vite.kill();
process.exit(0);
