/**
 * world-shot.mjs — photograph a named feature of the generated world.
 *
 *   node tools/world-shot.mjs [baseUrl] [subject] [preset]
 *   subjects: bridge | river | lake | trees | sky | underwater
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
// Extra query the page reads for itself: `r` is the orbit radius, `weather` the
// clear-weather override. Both live in the URL because the page evaluates them.
const query = [
  radius ? `r=${radius}` : '',
  process.env.WEATHER ? `weather=${process.env.WEATHER}` : '',
  process.env.FOG === 'off' ? 'fog=off' : '',
  process.env.HIDE ? `hide=${process.env.HIDE}` : '',
  // Same world every time, so before-and-after shots are of the same place.
  process.env.SEED ? `seed=${process.env.SEED}` : '',
]
  .filter(Boolean)
  .join('&');
await page.goto(query ? `${base}?${query}` : base, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__jj?.terrain, null, { timeout: 120_000 });
await page.waitForSelector('#screen-menu.active', { timeout: 120_000 });
console.log('world generated');

// Hide the menu chrome: this is a photograph of the world, not of the UI.
await page.addStyleTag({ content: '#ui-root { display: none !important; }' });

const info = await page.evaluate((what) => {
  const game = window.__jj;
  const terrain = game.terrain;
  const rig = game.renderer.cameraRig;

  /*
   * `?weather=clear` lies to the renderer for the duration of the photograph.
   *
   * Writing clear weather into the world state does not survive — the
   * simulation rewrites it every tick and the renderer reads it immediately
   * afterwards — so the lie goes in at the two places that consume it: the sky
   * (which owns the fog) and the effects renderer (which owns the rain). Half
   * the world's frames are a downpour, and reviewing the water through one is
   * reviewing the fog.
   */
  function clearWeather() {
    const sky = game.renderer.sky;
    const skyUpdate = sky.update.bind(sky);
    sky.update = (hour, _weather, _rain, _fog, pos, settings) =>
      skyUpdate(hour, 'clear', 0, 0, pos, settings);
    const fx = game.renderer.effects;
    const fxUpdate = fx.update.bind(fx);
    fx.update = (...args) => {
      const a = args.slice();
      a[4] = 0;
      return fxUpdate(...a);
    };
  }
  if (new URLSearchParams(location.search).get('weather') === 'clear') clearWeather();

  /*
   * `?weather=rain` is the opposite filter: hold the world in a downpour, so
   * the rain can be photographed without waiting for the weather to come round
   * to it.
   */
  if (new URLSearchParams(location.search).get('weather') === 'rain') {
    const sky = game.renderer.sky;
    const skyUpdate = sky.update.bind(sky);
    sky.update = (hour, _weather, _rain, _fog, pos, settings) =>
      skyUpdate(hour, 'rain', 1, 0.1, pos, settings);
    const fx = game.renderer.effects;
    const fxUpdate = fx.update.bind(fx);
    fx.update = (...args) => {
      const a = args.slice();
      a[4] = 1;
      return fxUpdate(...a);
    };
  }

  /*
   * `?fog=off` thins the scene fog to almost nothing, every frame.
   *
   * The jungle's humidity haze is deliberate and it is what the game looks
   * like, but it is also opaque enough at forty metres to hide whatever a
   * close-up is meant to show. This is a photographer's filter, not a setting.
   */
  if (new URLSearchParams(location.search).get('fog') === 'off') {
    /*
     * Nail the density shut rather than assigning it: the renderer recomputes
     * fog every frame from the view distance and the weather, so any value
     * written here lasts until the next frame and no longer.
     */
    const fog = game.renderer.scene.fog;
    Object.defineProperty(fog, 'density', { get: () => 0.0012, set: () => {} });
  }

  /*
   * `?hide=storm-wall,water` takes named objects out of shot.
   *
   * It is a translucent cylinder the size of the playable area, and from inside
   * it — which is where every photograph is taken from — it lays a pale sheet
   * across whatever is behind it. That is correct in play and ruins a
   * photograph of anything else.
   */
  const hidden = (new URLSearchParams(location.search).get('hide') ?? '')
    .split(',')
    .filter(Boolean);
  if (hidden.length > 0) {
    const hide = () => {
      game.renderer.scene.traverse((o) => {
        if (hidden.some((name) => o.name === name || o.name.startsWith(name))) o.visible = false;
      });
    };
    hide();
    // Re-applied: the renderer turns some of these back on every frame.
    setInterval(hide, 200);
  }

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

  if (what === 'lake') {
    const lake = terrain.lakes[0];
    if (!lake) return { error: 'no lake in this world' };
    /*
     * Taken from above, with the rig switched off.
     *
     * The orbit camera sits thirty metres up and looks at a point six metres
     * over the ground, which from any useful distance means looking *through*
     * two hundred metres of canopy. A lake is a shape on the floor of the
     * world; it has to be photographed from above it.
     */
    const radius = Number(new URLSearchParams(location.search).get('r') ?? '') || lake.radius * 1.9;
    rig.setFreeAnchor(lake.x, lake.z, radius);
    rig.update = () => {};
    const cam = game.renderer.camera;
    cam.position.set(lake.x + radius * 0.7, terrain.waterLevel + radius * 0.75, lake.z + radius * 0.7);
    cam.lookAt(lake.x, terrain.waterLevel, lake.z);
    return {
      at: [Math.round(lake.x), Math.round(lake.z)],
      radius: Math.round(lake.radius),
      depth: +(terrain.waterLevel - terrain.heightAt(lake.x, lake.z)).toFixed(1),
    };
  }

  if (what === 'sky') {
    // The sky shot is always of the clouds, so it clears the weather by default
    // — pass WEATHER=keep to photograph the sky the world actually has.
    if (!new URLSearchParams(location.search).get('weather')) clearWeather();
    /*
     * Point the camera up. The free camera exists to orbit a place on the
     * ground and always looks down at it, so photographing the sky means taking
     * the camera off it: with the rig's update neutered, whatever transform is
     * set here survives every frame.
     */
    const river = terrain.rivers[0];
    const p = river.points[Math.floor(river.points.length / 3)];
    rig.setFreeAnchor(p.x, p.z, 20);
    rig.update = () => {};
    const cam = game.renderer.camera;
    cam.position.set(p.x, terrain.surfaceAt(p.x, p.z) + 3, p.z);
    cam.lookAt(p.x + 40, cam.position.y + 55, p.z);
    return { lookingUp: true, at: [Math.round(p.x), Math.round(p.z)] };
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
