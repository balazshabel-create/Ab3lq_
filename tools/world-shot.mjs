/**
 * world-shot.mjs — photograph a named feature of the generated world.
 *
 *   node tools/world-shot.mjs [baseUrl] [subject] [preset]
 *   subjects: bridge | river | underwater
 *
 * ## Why this exists
 *
 * Everything else that looks at the world does it by playing a round, which on a
 * software rasteriser is minutes per frame and lands the camera wherever your
 * animal happened to spawn. But the menu already renders the whole world with a
 * free orbit camera pointed at a riverbank — so the world can be photographed
 * without a round existing at all, by moving that anchor to something specific.
 *
 * The world generator is deterministic, so "the first bridge on seed N" is a
 * stable address for a place, and a change to bridges can be reviewed by taking
 * the same photograph before and after.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173';
const subject = process.argv[3] ?? 'bridge';
const preset = process.argv[4] ?? 'low';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const DENSITY = { high: [1, 70], medium: [0.65, 46], low: [0.3, 28] }[preset];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message.slice(0, 300)));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE:', m.text().slice(0, 300));
});

await page.addInitScript(
  ([name, density, distance]) => {
    localStorage.setItem(
      'jungle-jukebox.graphics.v1',
      JSON.stringify({ preset: name, foliageDensity: density, grassDistance: distance }),
    );
  },
  [preset, DENSITY[0], DENSITY[1]],
);

const radius = process.argv[5];
await page.goto(radius ? `${base}?r=${radius}` : base, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__jj?.terrain, null, { timeout: 120_000 });
await page.waitForSelector('#screen-menu.active', { timeout: 120_000 });
console.log('world generated');

// Hide the menu chrome: this is a photograph of the world, not of the UI.
await page.addStyleTag({ content: '#ui-root { display: none !important; }' });

const info = await page.evaluate((what) => {
  const game = window.__jj;
  const terrain = game.terrain;
  const rig = game.renderer.cameraRig;

  if (what === 'bridge') {
    const deck = terrain.decks[0];
    if (!deck) return { error: 'no bridges in this world' };
    // Stand off to the side of the span so the towers and cables are in profile.
    const offX = -deck.dirZ;
    const offZ = deck.dirX;
    const radius = Number(new URLSearchParams(location.search).get('r') ?? '') || deck.halfLength * 1.5 + 26;
    rig.setFreeAnchor(deck.x + offX * 6, deck.z + offZ * 6, radius);
    return { span: deck.halfLength * 2, deckY: deck.y };
  }

  if (what === 'underwater') {
    const river = terrain.rivers[0];
    const p = river.points[Math.floor(river.points.length / 2)];
    rig.setFreeAnchor(p.x, p.z, 16);
    return { depth: terrain.waterLevel - terrain.heightAt(p.x, p.z) };
  }

  if (what === 'trees') {
    /*
     * The densest cluster of tall trees, so the shot is of a canopy rather than
     * of whichever sapling happened to be near the river.
     */
    const trees = game.content.trees;
    let best = trees[0];
    let bestScore = -1;
    for (const t of trees) {
      if (t.height < 14) continue;
      let near = 0;
      for (const o of trees) {
        const d = Math.hypot(o.x - t.x, o.z - t.z);
        if (d < 22) near += o.height;
      }
      if (near > bestScore) {
        bestScore = near;
        best = t;
      }
    }
    const radius = Number(new URLSearchParams(location.search).get('r') ?? '') || 34;
    rig.setFreeAnchor(best.x, best.z, radius);
    return { at: [Math.round(best.x), Math.round(best.z)], height: best.height, neighbours: bestScore };
  }

  const river = terrain.rivers[0];
  const p = river.points[Math.floor(river.points.length / 3)];
  rig.setFreeAnchor(p.x, p.z, 48);
  return { width: river.width };
}, subject);
console.log('subject:', JSON.stringify(info));

// The orbit camera drifts, so give it a moment to settle and the foliage a
// moment to stream in before the shutter.
await page.waitForTimeout(9000);

// Report what the camera actually ended up looking at. A washed-out frame has
// several possible causes — fog, the water shader, an underwater misdetection —
// and they are indistinguishable by eye but trivial to tell apart from numbers.
const diag = await page.evaluate(() => {
  const game = window.__jj;
  const cam = game.renderer.camera;
  const scene = game.renderer.scene ?? null;
  return {
    camera: [cam.position.x.toFixed(1), cam.position.y.toFixed(1), cam.position.z.toFixed(1)],
    waterLevel: game.terrain.waterLevel,
    cameraOverWater: game.terrain.isWater(cam.position.x, cam.position.z),
    groundUnderCamera: game.terrain.heightAt(cam.position.x, cam.position.z).toFixed(1),
    fog: scene && scene.fog ? { color: `#${scene.fog.color.getHexString()}`, density: scene.fog.density } : null,
    weather: { fog: game.state.world.fog, rain: game.state.world.rain },
  };
});
console.log('diag:', JSON.stringify(diag));

await page.screenshot({ path: `${OUT}/world-${subject}.png` });
console.log(`wrote ${OUT}/world-${subject}.png`);

await browser.close();
process.exit(0);
