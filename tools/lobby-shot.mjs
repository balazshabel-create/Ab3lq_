/**
 * lobby-shot.mjs — photograph the matchmaking flow.
 *
 * The lobby is the second screen every player sees and the only one that is
 * pure interface, so it is worth looking at directly rather than catching a
 * glimpse of it on the way into a round. This walks the three states that
 * differ visually — the multiplayer dialog, the lobby waiting, and the lobby
 * counting down after Ready — and writes one image each.
 *
 *     node tools/lobby-shot.mjs http://localhost:4173 screenshots
 */

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173';
const out = process.argv[3] ?? 'screenshots';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// The lowest preset: nothing here is about the 3D behind the panel, and a
// software rasteriser building a full jungle turns a screenshot into a wait.
await page.addInitScript(() => {
  localStorage.setItem(
    'jungle-jukebox.graphics.v1',
    JSON.stringify({ preset: 'low', foliageDensity: 0.3, grassDistance: 28 }),
  );
});
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 400)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#screen-menu.active', { timeout: 60_000 });

// 1. The matchmaking dialog, in its "join by code" mode where it is fullest.
await page.click('#screen-menu .btn:has-text("Multiplayer")', { force: true });
await page.waitForTimeout(500);
await page.click('.mm-mode:has-text("Room code")', { force: true });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/mm-dialog.png` });
console.log(`wrote ${out}/mm-dialog.png`);

// The searching state is transient by design — it lives only as long as a
// socket takes to fail — so it gets photographed on the way past.
await page.click('.online-dialog .btn-primary', { force: true });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/mm-searching.png` });
console.log(`wrote ${out}/mm-searching.png`);

// Whatever the connection did, get back to a usable menu.
await page.waitForSelector('#screen-menu.active', { timeout: 30_000 });
const dialog = await page.$('.online-dialog .btn:has-text("Cancel")');
if (dialog) await dialog.click({ force: true });

// 2. The lobby, waiting.
await page.click('#screen-menu .btn:has-text("Play")', { force: true, timeout: 60_000 });
await page.waitForSelector('#screen-lobby.active', { timeout: 120_000 });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/lobby.png` });
console.log(`wrote ${out}/lobby.png`);

// 3. The lobby, counting down. Caught in the first second, because three
//    seconds later the round has taken the screen.
await page.click('#screen-lobby .btn-ready', { force: true });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/lobby-countdown.png` });
console.log(`wrote ${out}/lobby-countdown.png`);

await browser.close();
process.exit(0);
