/**
 * tools/scene-probe.mjs — look at the rendered world at a *chosen* quality preset.
 *
 * ## Why this exists alongside browser-check.mjs
 *
 * `browser-check.mjs` answers "does the game work?" and lets the client
 * auto-detect its graphics preset, which is right for a smoke test and wrong for
 * judging how the world looks. Auto-detection can land on LOW, and LOW renders
 * foliage at 30% density — so a screenshot from it says nothing about what a
 * player on a real GPU sees, while looking exactly like a screenshot that does.
 * Several rounds of grass tuning were spent on frames whose density was never in
 * question. This pins the preset before the first script runs.
 *
 * It also reports numbers instead of leaving everything to the eye: instances per
 * prop kind answers "are there any flower spikes at all" without squinting at a
 * frame where they might simply be behind a tree.
 *
 * ## The shots
 *
 * The default in-game camera is no use for reviewing anything — it frames a patch
 * of ground behind your own animal. So the probe drives the camera rig to three
 * useful places: hard down (a portrait of your animal), level (the horizon, where
 * the jungle either reads as a jungle or does not), and then a slow pan, because
 * one unlucky spawn inside a log should not decide whether a vegetation change
 * worked.
 *
 * Usage: node tools/scene-probe.mjs [baseUrl] [preset] [outDir]
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173';
const preset = process.argv[3] ?? 'high';
const outDir = process.argv[4] ?? 'screenshots';
mkdirSync(outDir, { recursive: true });

/*
 * Mirrors the presets in src/Graphics/QualitySettings.ts.
 *
 * Duplicated rather than imported because this script drives a *built* bundle
 * over HTTP and has no module graph in common with it. Only the two fields that
 * change what the vegetation looks like are set; everything else in the stored
 * settings falls back to the preset the game loads by name.
 */
const PRESET_OVERRIDES = {
  high: { foliageDensity: 1, grassDistance: 70 },
  medium: { foliageDensity: 0.65, grassDistance: 46 },
  low: { foliageDensity: 0.3, grassDistance: 28 },
};
if (!PRESET_OVERRIDES[preset]) {
  console.error(`unknown preset "${preset}" (expected high, medium or low)`);
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

let failures = 0;
page.on('console', (m) => {
  if (m.type() === 'error') {
    failures++;
    console.log('  [console error]', m.text());
  }
});
/*
 * An uncaught exception is NOT a console message in Playwright. Without this
 * listener a renderer that throws on its first frame is indistinguishable from a
 * slow machine — the probe just times out somewhere later with no clue why, which
 * cost a diagnosis once already.
 */
page.on('pageerror', (e) => {
  failures++;
  console.log('  [page error]', e.message, '\n', e.stack);
});

// Written before any page script runs, under the key the game loads from, so the
// renderer builds at this density from its very first frame rather than
// rebuilding partway through.
await page.addInitScript(
  ([name, overrides]) => {
    localStorage.setItem(
      'jungle-jukebox.graphics.v1',
      JSON.stringify({ preset: name, ...overrides }),
    );
  },
  [preset, PRESET_OVERRIDES[preset]],
);

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__jj, null, { timeout: 30000 });
await page.click('#screen-menu .btn-primary');
await page.waitForTimeout(500);
await page.click('#screen-lobby .btn:has-text("Start Round")');
await page.waitForFunction(() => window.__jj?.state?.actorId > 0, null, { timeout: 30000 });

/*
 * Wait out the role card, which holds the screen for a countdown after the round
 * has already been dealt.
 *
 * The signal is `body.playing`, which main.ts sets only for the in-round screen.
 * Two earlier attempts at this were wrong in instructive ways: Playwright's
 * `state: 'hidden'` never resolves because the screens stay in the DOM and are
 * switched by class, and watching `#screen-role.active` timed out against rounds
 * that were demonstrably running (the failure screenshot showed a live HUD and a
 * ticking clock).
 *
 * Polled on a timer rather than on rAF as well. Under SwiftShader this scene can
 * drop to a few frames a second, and a rAF-driven predicate inherits that — a
 * timer does not care how slow the renderer is.
 */
try {
  await page.waitForFunction(() => document.body.classList.contains('playing'), null, {
    timeout: 90000,
    polling: 500,
  });
} catch (err) {
  await page.screenshot({ path: `${outDir}/probe-stuck.png` });
  console.log('never reached the in-round screen; wrote probe-stuck.png');
  throw err;
}
// Let the streamed grass chunks and the foliage batches settle.
await page.waitForTimeout(6000);

const stats = await page.evaluate(() => {
  const g = window.__jj;
  const r = g?.renderer;
  const grass = r?.grass;
  const settings = r?.settings;
  const content = g?.content;
  return {
    species: g?.state?.species ?? null,
    settings: settings
      ? {
          preset: settings.preset,
          foliageDensity: settings.foliageDensity,
          grassDistance: settings.grassDistance,
        }
      : 'unreadable',
    grassChunks: grass?.visibleChunks ?? null,
    grassInstances: grass?.totalInstances ?? null,
    foliageInstances: r?.foliage?.totalInstances ?? null,
    // Visible instances per PropKind (see src/World/WorldGen.ts for the enum), so
    // "did the flower spikes make it into the world" is a number, not a squint.
    visibleByKind: (r?.foliage?.batchList ?? []).reduce((acc, b) => {
      if (!b.mesh.visible) return acc;
      acc[b.kind] = (acc[b.kind] ?? 0) + b.mesh.count;
      return acc;
    }, {}),
    // Placed cosmetic props, which is the count worldgen decided on rather than
    // the count currently in front of the camera.
    cosmeticProps: (content?.cosmetic ?? []).reduce((acc, p) => {
      acc[p.kind] = (acc[p.kind] ?? 0) + 1;
      return acc;
    }, {}),
    trees: content?.trees?.length ?? null,
    bushes: content?.bushes?.length ?? null,
  };
});
console.log(JSON.stringify(stats, null, 2));

/*
 * A portrait of the player's own animal.
 *
 * The rig keeps the animal centred whatever the pitch, so pitching hard down
 * frames the model from above — the one camera that reliably shows the animal
 * rather than a tree trunk. Driven through the rig rather than by synthesising
 * mouse movement, which goes through pointer-lock deltas and sensitivity and
 * lands somewhere different on every run.
 */
await page.evaluate(() => window.__jj?.renderer?.cameraRig?.addLook(0, 0.85));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/probe-animal.png` });

// Back up and past level, out to the trees.
await page.evaluate(() => window.__jj?.renderer?.cameraRig?.addLook(0, -1.47));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/probe-horizon-${preset}.png` });

for (let i = 1; i <= 3; i++) {
  await page.evaluate(() => window.__jj?.renderer?.cameraRig?.addLook(1.6, 0));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/probe-pan-${i}.png` });
}

await browser.close();

console.log(
  `\n${failures === 0 ? 'OK' : `${failures} error(s)`} — wrote probe-animal.png, ` +
    `probe-horizon-${preset}.png and 3 pan shots to ${outDir}/`,
);
process.exit(failures === 0 ? 0 : 1);
