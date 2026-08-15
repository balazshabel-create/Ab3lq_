/**
 * quick-shot.mjs — click into a round and screenshot the HUD, loudly.
 *
 * browser-check.mjs is a pass/fail smoke test and stops at the first timeout
 * without saying what the page thought was wrong. This one mirrors every console
 * message and page error out to the terminal first, which is what you want when
 * something in the round-start flow has broken and you do not yet know what.
 */

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173';
const out = process.argv[3] ?? 'screenshots';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

/*
 * Pin the graphics preset before any page script runs.
 *
 * Left to auto-detect, the client picks a preset from the GPU it thinks it has,
 * and under SwiftShader that guess is optimistic enough that a single frame can
 * take seconds — which turns "screenshot the HUD" into a twenty-minute wait and
 * looks exactly like a hang. The preset argument makes the cost explicit.
 */
const preset = process.argv[4] ?? 'low';
const DENSITY = { high: [1, 70], medium: [0.65, 46], low: [0.3, 28] }[preset];
await page.addInitScript(
  ([name, density, distance]) => {
    localStorage.setItem(
      'jungle-jukebox.graphics.v1',
      JSON.stringify({ preset: name, foliageDensity: density, grassDistance: distance }),
    );
  },
  [preset, DENSITY[0], DENSITY[1]],
);
page.on('console', (m) => console.log(`  [${m.type()}]`, m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 400)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#screen-menu.active', { timeout: 60_000 });
console.log('menu up');

await page.click('#screen-menu .btn:has-text("Play")', { force: true, timeout: 60_000 });
await page.waitForSelector('#screen-lobby.active', { timeout: 60_000 });
console.log('lobby up');

await page.click('#screen-lobby .btn:has-text("Start Round")', { force: true, timeout: 60_000 });
console.log('start clicked');

for (let i = 0; i < 90; i++) {
  const active = await page.evaluate(() =>
    [...document.querySelectorAll('.screen.active')].map((n) => n.id).join(','),
  );
  const clock = await page.evaluate(() => {
    const t = document.querySelector('.role-countdown, .round-timer');
    return t ? t.textContent : '(none)';
  });
  console.log(`  t+${i}s active=[${active}] clock=${clock}`);
  if (active.includes('screen-hud')) break;
  await page.waitForTimeout(1000);
}

await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/hud.png` });
console.log(`wrote ${out}/hud.png`);

await browser.close();
process.exit(0);
