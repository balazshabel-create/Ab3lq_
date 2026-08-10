/**
 * tools/browser-check.mjs — does the game actually run?
 *
 * Loads the built client in headless Chromium, walks it from the main menu into
 * a live round, and asserts on what it finds: no console errors, a real WebGL
 * context, animals being drawn, a role dealt, the HUD running. Then it takes
 * screenshots so the visual result can be inspected.
 *
 * This is the check that a typecheck and a unit test cannot give you: whether
 * the thing a player opens works.
 *
 * Usage: node tools/browser-check.mjs [baseUrl] [outDir]
 */

import { chromium } from 'playwright';
import { existsSync, globSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/**
 * Decode a PNG far enough to measure what is in it.
 *
 * Node has no image decoder and pulling in a dependency for one assertion is not
 * worth it, so this walks the IDAT chunks, inflates them, and reverses the
 * per-scanline filters. Enough to answer "is this frame actually a rendered
 * jungle, or a black rectangle?".
 */
function analysePng(buffer) {
  // Header: 8-byte signature, then length/type/data/crc chunks.
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4;
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (depth ${bitDepth}, colour type ${colorType})`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);

  // Reverse the scanline filters (PNG spec, section 9.2).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x];
      const a = x >= channels ? pixels[dst + x - channels] : 0;
      const b = y > 0 ? pixels[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[dst - stride + x - channels] : 0;
      let out;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + a;
          break;
        case 2:
          out = value + b;
          break;
        case 3:
          out = value + ((a + b) >> 1);
          break;
        case 4: {
          // Paeth predictor.
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          out = value + pred;
          break;
        }
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
      pixels[dst + x] = out & 0xff;
    }
  }

  // Quantise to a 5-bit-per-channel palette so anti-aliasing noise does not
  // inflate the "distinct colours" count into meaninglessness.
  const unique = new Set();
  let sum = 0;
  let min = 255;
  let max = 0;
  const count = width * height;
  for (let i = 0; i < count; i++) {
    const p = i * channels;
    const r = pixels[p];
    const g = pixels[p + 1];
    const b = pixels[p + 2];
    unique.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    const luma = (r + g + b) / 3;
    sum += luma;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }

  return {
    width,
    height,
    uniqueColors: unique.size,
    averageBrightness: sum / count,
    spread: max - min,
  };
}

const baseUrl = process.argv[2] ?? 'http://localhost:4173';
const outDir = process.argv[3] ?? 'screenshots';
mkdirSync(outDir, { recursive: true });

const errors = [];
const warnings = [];

/**
 * Find the pre-installed Chromium rather than downloading one. The full browser
 * is preferred over headless_shell because the latter has no GPU stack at all.
 */
function findChromium() {
  const candidates = [
    ...globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome'),
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  // Fall back to whatever Playwright resolves on its own.
  return undefined;
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: [
    // Headless Chromium needs to be told to give us a real GL implementation.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error') errors.push(text);
  else if (msg.type() === 'warning') warnings.push(text);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

function log(step, detail = '') {
  console.log(`  ${step.padEnd(34)} ${detail}`);
}

console.log(`\nLoading ${baseUrl}\n`);
await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });

// --- WebGL available at all? ------------------------------------------------
const webgl = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown renderer';
});
log('webgl renderer', webgl ?? 'NONE');
if (!webgl) {
  console.error('\nFAILED: no WebGL context available in this browser.');
  await browser.close();
  process.exit(1);
}

// --- Wait for the loading screen to finish ---------------------------------
await page.waitForFunction(
  () => document.querySelector('.loading-screen')?.classList.contains('hidden') === true,
  { timeout: 90_000 },
);
log('world generated', 'loading screen dismissed');

// The menu should be showing, over a live 3D jungle.
await page.waitForSelector('#screen-menu.active', { timeout: 15_000 });
log('main menu', 'visible');
await page.waitForTimeout(2500); // let the menu world settle and animate
await page.screenshot({ path: `${outDir}/01-main-menu.png` });

// --- Settings screen -------------------------------------------------------
await page.click('#screen-menu .btn:has-text("Settings")');
await page.waitForSelector('#screen-settings.active', { timeout: 10_000 });
const presetCount = await page.locator('.preset-btn').count();
const settingCount = await page.locator('.setting').count();
log('settings screen', `${presetCount} presets, ${settingCount} options`);
await page.screenshot({ path: `${outDir}/02-settings.png` });
await page.click('#screen-settings .btn:has-text("Close")');

// --- Into a solo round -----------------------------------------------------
await page.waitForSelector('#screen-menu.active', { timeout: 10_000 });
await page.click('#screen-menu .btn-primary');
await page.waitForSelector('#screen-lobby.active', { timeout: 60_000 });
const lobbyPlayers = await page.locator('.player-row').count();
const speciesCards = await page.locator('.species-card').count();
log('lobby', `${lobbyPlayers} players, ${speciesCards} species to pick`);
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/03-lobby.png` });

// Pick a species, then start.
await page.locator('.species-card').nth(1).click();
await page.waitForTimeout(300);
await page.click('#screen-lobby .btn:has-text("Start Round")');

// --- Role card -------------------------------------------------------------
await page.waitForSelector('#screen-role.active', { timeout: 20_000 });
const roleInfo = await page.evaluate(() => {
  const card = document.querySelector('.role-card');
  return {
    title: card?.querySelector('.role-title')?.textContent ?? '',
    isHunter: card?.classList.contains('hunter') ?? false,
    weakness: card?.querySelector('.role-weakness strong')?.textContent ?? '',
  };
});
log('role dealt', `${roleInfo.title} | ${roleInfo.weakness}`);
await page.screenshot({ path: `${outDir}/04-role-card.png` });

// --- The round itself ------------------------------------------------------
await page.waitForSelector('#screen-hud.active', { timeout: 40_000 });
log('round started', 'HUD active');

// Let the round run so animals spawn, the sun moves and the HUD ticks.
await page.waitForTimeout(4000);

// Drive the player around a little, so movement and the camera are exercised.
await page.mouse.move(800, 450);
for (const key of ['KeyW', 'KeyD']) {
  await page.keyboard.down(key);
}
await page.waitForTimeout(2500);
for (const key of ['KeyW', 'KeyD']) {
  await page.keyboard.up(key);
}
// Whistle — the signature mechanic.
await page.keyboard.press('KeyQ');
await page.waitForTimeout(1200);

// Turn on the debug overlay and read the real renderer stats out of it.
await page.keyboard.press('F3');
await page.waitForTimeout(1500);

const stats = await page.evaluate(() => {
  const text = document.querySelector('.debug-overlay')?.textContent ?? '';
  const read = (key) => {
    const match = text.match(new RegExp(`${key}\\s+([^\\n]+)`));
    return match ? match[1].trim() : null;
  };
  const hud = {
    health: document.querySelectorAll('.stat-fill.health').length,
    timer: document.querySelector('.round-timer')?.textContent ?? '',
    whistle: document.querySelector('.whistle-time')?.textContent ?? '',
    role: document.querySelector('.role-badge')?.textContent ?? '',
  };
  return {
    fps: read('fps'),
    draws: read('draws'),
    tris: read('tris'),
    animals: read('animals'),
    foliage: read('foliage'),
    snapshot: read('snapshot'),
    phase: read('phase'),
    weather: read('weather'),
    hud,
  };
});

log('fps', stats.fps ?? '?');
log('draw calls', stats.draws ?? '?');
log('triangles', stats.tris ?? '?');
log('animals drawn', stats.animals ?? '?');
log('foliage batches', stats.foliage ?? '?');
log('snapshot actors', stats.snapshot ?? '?');
log('phase', stats.phase ?? '?');
log('weather', stats.weather ?? '?');
log('hud timer', stats.hud.timer);
log('hud whistle', stats.hud.whistle);
log('hud role', stats.hud.role);

await page.keyboard.press('F3');
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/05-in-round.png` });

// Let time pass so dusk starts and the whistle timer visibly runs down.
await page.waitForTimeout(6000);
await page.screenshot({ path: `${outDir}/06-in-round-later.png` });

// --- Verify the frame is not blank ----------------------------------------
// A renderer that throws still leaves a canvas, so the real question is whether
// anything was drawn into it. Reading the pixels back through WebGL does not
// work here: the renderer runs with preserveDrawingBuffer disabled (the right
// choice for performance), so the buffer is already cleared by the time any
// script outside the render call could sample it. Decoding Playwright's
// screenshot instead measures exactly what a player would see.
const shotBuffer = await page.screenshot({ clip: { x: 500, y: 250, width: 600, height: 400 } });
const pixelCheck = analysePng(shotBuffer);
log('distinct colours', String(pixelCheck.uniqueColors));
log('avg brightness', pixelCheck.averageBrightness.toFixed(1));
log('colour spread', pixelCheck.spread.toFixed(1));

await browser.close();

// --- Report ---------------------------------------------------------------
console.log('');
const failures = [];

const numeric = (value) => Number.parseFloat(String(value ?? '0'));
if (numeric(stats.snapshot) < 5) failures.push(`only ${stats.snapshot} actors in the snapshot`);
if (numeric(stats.animals) < 3) failures.push(`only ${stats.animals} animals drawn`);
if (numeric(stats.draws) < 10) failures.push(`only ${stats.draws} draw calls — the world is not rendering`);
// This runs on SwiftShader (software rasterisation), so the frame rate here says
// nothing about real hardware. It is only checked to catch a hard hang.
if (numeric(stats.fps) < 3) failures.push(`renderer appears stalled: ${stats.fps} fps`);
if (!stats.hud.timer.includes(':')) failures.push('HUD timer not running');
if (pixelCheck.uniqueColors < 40) {
  failures.push(`frame is nearly flat (${pixelCheck.uniqueColors} colours) — probably a blank screen`);
}
if (pixelCheck.averageBrightness < 4) {
  failures.push(`frame is essentially black (brightness ${pixelCheck.averageBrightness.toFixed(1)})`);
}

// Ignore the noise every headless GL stack produces.
const realErrors = errors.filter(
  (e) =>
    !/WebGL.*deprecated|Automatic fallback|SwiftShader|GroupMarkerNotSet|not supported in this browser/i.test(e),
);
if (realErrors.length > 0) {
  failures.push(`${realErrors.length} console error(s)`);
}

if (realErrors.length > 0) {
  console.log('Console errors:');
  for (const e of realErrors.slice(0, 12)) console.log(`  ✗ ${e}`);
  console.log('');
}

if (failures.length > 0) {
  console.error('FAILED:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log(`OK — the game boots, deals a role, runs a round and renders.`);
console.log(`Screenshots written to ${outDir}/`);
process.exit(0);
