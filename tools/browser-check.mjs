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

/*
 * Failures are collected rather than thrown, so one broken assertion does not hide
 * the rest of the run. Declared up here because some checks happen mid-walkthrough
 * (they need a particular screen to be up) and the report is printed at the end.
 */
const failures = [];
function fail(reason) {
  failures.push(reason);
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
// Filled slots only: the open ones are placeholders, and counting them would
// report a full lobby in a solo round.
const lobbyPlayers = await page.locator('.mm-slot:not(.empty)').count();
const readySlots = await page.locator('.mm-slot.ready').count();
const speciesCards = await page.locator('.species-card').count();
log('lobby', `${lobbyPlayers} players (${readySlots} ready), ${speciesCards} species listed`);
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/03-lobby.png` });

/*
 * Open one codex entry, then start.
 *
 * The species cards used to be a picker; they are a reference now — nobody
 * chooses their animal — so this clicks one only to prove the detail panel
 * still populates, and `force` because at two frames a second Playwright's
 * actionability check decides the element is never "stable".
 */
await page.locator('.species-card').nth(1).click({ force: true });
await page.waitForTimeout(300);
await page.click('#screen-lobby .btn:has-text("Start now")', { force: true });

// --- Role card -------------------------------------------------------------
/*
 * Sixty seconds, not twenty. The role screen appears on the first round-status
 * packet, which is fast — but on a software rasteriser the frame that carries it
 * can be several seconds behind the click, and a timeout here reads as "the
 * round never started" when the truth is only that the machine is slow.
 */
await page.waitForSelector('#screen-role.active', { timeout: 60_000 });
// The card fades in over 0.6s from opacity 0. Screenshotting the instant the
// screen goes active caught it mid-fade and wrote out a blank frame, which made
// the artefact this whole check exists for impossible to see by eye.
await page.waitForFunction(
  () => {
    const card = document.querySelector('.role-card');
    return card !== null && Number.parseFloat(getComputedStyle(card).opacity) > 0.98;
  },
  { timeout: 5000 },
);
const roleInfo = await page.evaluate(() => {
  const card = document.querySelector('.role-card');
  return {
    title: card?.querySelector('.role-title')?.textContent ?? '',
    isHunter: card?.classList.contains('hunter') ?? false,
    weakness: card?.querySelector('.role-weakness strong')?.textContent ?? '',
  };
});
log('role dealt', `${roleInfo.title} | ${roleInfo.weakness}`);

/*
 * The role card was reported rendering twice — a ghost copy offset sideways and
 * clipped, after the embedding panel was resized. So: resize with the card up and
 * check the card is still exactly one element, centred in the *new* viewport.
 *
 * Be honest about what this can and cannot catch. The duplicate was a stale
 * compositor layer, and a screenshot forces a fresh paint, so no pixel assertion
 * here would reproduce it. What is testable is that the DOM holds a single card
 * and that its layout follows the resize — plus the blend-layer sweep further
 * down, which asserts the property that caused it is gone.
 */
const resizeCheck = await (async () => {
  await page.setViewportSize({ width: 1180, height: 780 });
  /*
   * Wait for the layout to settle rather than allowing a fixed 250 ms.
   *
   * A resize is handled on the next frame, and this scene renders at a handful of
   * frames a second under SwiftShader — so as the world got denser, 250 ms stopped
   * being long enough and the card was measured against the *old* viewport width.
   * That reported a 590 px offset and read exactly like the ghosting regression
   * this check exists to catch, which is the worst kind of false positive.
   *
   * Polling until two consecutive reads agree measures the settled layout at any
   * frame rate.
   */
  const measure = () =>
    page.evaluate(() => {
      const cards = document.querySelectorAll('.role-card');
      const box = cards[0]?.getBoundingClientRect();
      return {
        count: cards.length,
        // Width matters as much as the offset: see below.
        width: box ? box.width : 0,
        offCentre: box ? Math.abs((box.left + box.right) / 2 - window.innerWidth / 2) : 999,
      };
    });

  /*
   * Keep the last reading in which the card was actually laid out.
   *
   * The round's intro countdown runs while this polls, so the card can vanish
   * mid-measurement — and a reading taken after it goes is all zeros. Holding the
   * last displayed sample means a card that was correctly centred and then simply
   * got dismissed still passes on the evidence it did produce, rather than
   * silently skipping the assertion.
   */
  let lastShown = null;
  let previous = await measure();
  if (previous.width > 0) lastShown = previous;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(150);
    const current = await measure();
    if (current.width > 0) {
      if (lastShown && Math.abs(current.offCentre - lastShown.offCentre) < 0.5) return current;
      lastShown = current;
    }
    previous = current;
  }
  return lastShown ?? previous;
})();
if (resizeCheck.count !== 1) {
  fail(`the role card is in the DOM ${resizeCheck.count} times — expected exactly 1`);
}
/*
 * Only assert centring on a card that is actually laid out.
 *
 * A hidden element's `getBoundingClientRect` is all zeros, so its computed centre
 * is 0 and the offset comes out as half the viewport width — a stable, confident,
 * completely meaningless 590 px that reads exactly like the ghosting regression
 * this check was written to catch. By the time the resize runs the round may
 * already have started and switched away from the role screen, which is not a bug
 * and must not be reported as one. Zero width means "nothing to measure".
 */
if (resizeCheck.width <= 0) {
  log('resize', 'role card not displayed here — centring not checked');
} else {
  if (resizeCheck.offCentre > 2) {
    fail(`after a resize the role card sits ${resizeCheck.offCentre.toFixed(0)}px off centre`);
  }
  log('resize', `card still single and centred (±${resizeCheck.offCentre.toFixed(1)}px)`);
}
await page.screenshot({ path: `${outDir}/04-role-card.png` });
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForTimeout(250);

// --- The round itself ------------------------------------------------------
// Generous: this runs against software-rasterised GL on a machine that may also
// be building, and the intro countdown is real simulation time.
await page.waitForSelector('#screen-hud.active', { timeout: 90_000 });
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

/*
 * A horizon shot.
 *
 * The default camera looks down at your own animal, which is right for playing
 * and useless for reviewing the scene — it frames a patch of ground and nothing
 * else. The interesting questions (does the jungle read as a jungle, does the
 * backdrop join up, are the mountains there) are all answered by looking level.
 *
 * Driven through the camera rig rather than by synthesising mouse movement, which
 * goes through pointer-lock deltas and sensitivity and lands somewhere different
 * on every run.
 */
await page.evaluate(() => {
  const rig = window.__jj?.renderer?.cameraRig;
  if (!rig) return;
  // addLook takes deltas; -0.5 rad of pitch from the default 0.38 puts the
  // camera slightly below level, looking out at the trees.
  rig.addLook(0, -0.62);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/07-horizon.png` });

// --- Verify the frame is not blank ----------------------------------------
// A renderer that throws still leaves a canvas, so the real question is whether
// anything was drawn into it. Reading the pixels back through WebGL does not
// work here: the renderer runs with preserveDrawingBuffer disabled (the right
// choice for performance), so the buffer is already cleared by the time any
// script outside the render call could sample it. Decoding Playwright's
// screenshot instead measures exactly what a player would see.
/*
 * Regression guard for the ghosted interface.
 *
 * `mix-blend-mode` and `backdrop-filter` both force an element into its own
 * composited layer — and a blend mode drags its whole stacking context into a
 * composited blend group. In an embedded webview those groups do not reliably
 * invalidate when the host frame is resized, which is what left a second, offset
 * copy of the role card on screen. This asserts none of the interface asks for one
 * again. Unlike a pixel check it tests the cause directly, which is the only part
 * of this that a headless screenshot cannot see.
 */
const compositedLayers = await page.evaluate(() => {
  const offenders = [];
  for (const node of document.querySelectorAll('#ui-root *, #ui-root')) {
    const s = getComputedStyle(node);
    const label = `${node.tagName.toLowerCase()}.${node.className || '(no class)'}`;
    if (s.mixBlendMode && s.mixBlendMode !== 'normal') {
      offenders.push(`${label} → mix-blend-mode: ${s.mixBlendMode}`);
    }
    const bf = s.backdropFilter || s.webkitBackdropFilter;
    if (bf && bf !== 'none') offenders.push(`${label} → backdrop-filter: ${bf}`);
  }
  return offenders;
});
if (compositedLayers.length > 0) {
  fail(`${compositedLayers.length} UI element(s) force a compositing layer: ${compositedLayers.join('; ')}`);
}
log('compositing layers', compositedLayers.length === 0 ? 'none — no ghosting risk' : 'FOUND');

const shotBuffer = await page.screenshot({ clip: { x: 500, y: 250, width: 600, height: 400 } });
const pixelCheck = analysePng(shotBuffer);
log('distinct colours', String(pixelCheck.uniqueColors));
log('avg brightness', pixelCheck.averageBrightness.toFixed(1));
log('colour spread', pixelCheck.spread.toFixed(1));

await browser.close();

// --- Report ---------------------------------------------------------------
console.log('');

const numeric = (value) => Number.parseFloat(String(value ?? '0'));
/*
 * At least two actors in the snapshot: you, and something else.
 *
 * This asked for five, from when the world held 220 AI animals. The population is
 * now 5 in total and snapshots are interest-managed — only actors near the player
 * are sent — so three is a perfectly healthy reading and the old threshold turned
 * a deliberate design change into a failure. What is still worth asserting is that
 * the stream is not empty and not solipsistic: a snapshot containing only the
 * local player would mean interest management or the spawn pass is broken.
 */
if (numeric(stats.snapshot) < 2) failures.push(`only ${stats.snapshot} actors in the snapshot`);
/*
 * Every animal the client knows about is being drawn.
 *
 * The overlay reports this as "drawn/wanted", so the meaningful assertion is that
 * the two agree and that neither is zero — a renderer dropping animals it has
 * snapshots for is the failure worth catching. Asking for an absolute count of
 * three encoded the old population of 220; at a population of five, with
 * interest-managed snapshots, two nearby animals is a normal reading.
 */
/*
 * The overlay reports "drawn/known".
 *
 * `drawn < known` is not a fault by itself: the renderer caps how many animals it
 * will draw per preset (`maxVisibleAnimals`, 45/90/150), and now that the world
 * carries ~190 ambient creatures — fish, ants, butterflies, birds — that cap is
 * legitimately binding. Demanding drawn === known reported the LOD budget doing
 * its job as a bug.
 *
 * What is still worth asserting is that animals are being drawn at all, and that
 * the renderer is drawing up to its own cap rather than silently losing them
 * somewhere below it.
 */
const animalsStat = String(stats.animals ?? '');
const [drawnRaw, wantedRaw] = animalsStat.split('/');
const drawn = numeric(drawnRaw);
const known = wantedRaw === undefined ? drawn : numeric(wantedRaw);
if (drawn < 1) {
  failures.push('no animals drawn at all');
} else if (drawn < known && drawn < 40) {
  // Below the smallest preset's cap and still not drawing everything it knows.
  failures.push(`only ${drawn} of ${known} known animals were drawn, well under any LOD cap`);
}
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
