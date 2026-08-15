/**
 * PostProcessing.ts — the composer chain.
 *
 * Until now the game rendered straight to the canvas with nothing after it, which
 * is why bright things never looked bright: a sun glint on the river, a lightning
 * flash, sky showing through a gap in the canopy all clipped flat at white and
 * stopped there. Bloom is what makes a highlight read as *light* rather than as a
 * white pixel, and it is the single largest perceptual difference available here
 * for the cost.
 *
 * ## Why the chain is shaped like this
 *
 * `RenderPass → UnrealBloomPass → (SMAA) → OutputPass`
 *
 * The order matters and the reason is colour space. Bloom has to run on **linear**
 * light — the whole point is that a value of 4.0 blooms four times as hard as 1.0,
 * and once you have converted to sRGB for display everything above 1.0 has already
 * been thrown away. So:
 *
 *  • the composer's render targets are `HalfFloatType`, so values above 1 survive;
 *  • `RenderPass` draws the scene into one of them, in linear light;
 *  • bloom extracts and blurs what is over the threshold, still linear;
 *  • `OutputPass` — last, always — applies tone mapping and the sRGB conversion.
 *
 * This is also why the renderer's own `toneMapping` is left set: `OutputPass` reads
 * it and applies it at the end of the chain instead. Tone mapping in the middle
 * would compress the highlights before bloom ever saw them.
 *
 * ## Anti-aliasing
 *
 * The WebGL context's MSAA does nothing once you render into a composer target, so
 * turning the composer on would silently *lose* the anti-aliasing the settings
 * screen says is enabled. SMAA replaces it in the chain, and only when the setting
 * asks for it — it costs two extra full-screen passes.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { GraphicsSettings } from '../Graphics/QualitySettings';

/**
 * Bloom strength per quality level.
 *
 * ## The threshold is the number that matters, and 1.0 is wrong
 *
 * The obvious threshold for "brighter than white" is 1.0, and it produced a jungle
 * where *everything* glowed — the ground went neon and the whole frame lifted by a
 * quarter. The reason is that this scene's lighting is scaled for three.js's
 * Lambert BRDF, which divides by π, so daylight intensities sit near 3.14 rather
 * than near 1. In the composer's linear HDR target an ordinary sunlit leaf is
 * therefore already well above 1.0, long before tone mapping brings it back down.
 * A threshold of 1.0 does not select highlights in this scene; it selects the
 * scene.
 *
 * 2.4 sits above the lit-surface range and below the things that genuinely are
 * light sources: the specular sparkle on the water (3.4× the sun colour), a
 * lightning flash, the sun disc, the storm wall. Those glow; the leaf litter does
 * not, which matters because the game depends on reading animal shapes in dappled
 * shade and an over-bloomed frame destroys exactly that.
 */
const BLOOM = {
  low: { strength: 0, radius: 0, threshold: 1 },
  medium: { strength: 0.42, radius: 0.5, threshold: 2.4 },
  high: { strength: 0.58, radius: 0.66, threshold: 2.25 },
} as const;

export class PostProcessing {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private smaa: SMAAPass | null = null;
  private gtao: GTAOPass | null = null;
  private renderPass: RenderPass | null = null;
  private outputPass: OutputPass | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private camera: THREE.Camera;
  private settings: GraphicsSettings;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: GraphicsSettings,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.settings = settings;
    this.rebuild();
  }

  /** Is the chain doing anything, or should the caller just render directly? */
  get active(): boolean {
    return this.composer !== null;
  }

  private wantsBloom(): boolean {
    const level = this.settings.effectsQuality;
    if (level === 'off') return false;
    return (BLOOM[level as 'low' | 'medium' | 'high'] ?? BLOOM.low).strength > 0;
  }

  private rebuild(): void {
    this.dispose();
    /*
     * No bloom means no composer at all, not a composer with a disabled pass.
     * A pass-through chain still costs a full-screen copy and an extra
     * framebuffer, and on the machines that pick the LOW preset that is exactly
     * the cost they are trying to avoid.
     */
    if (!this.wantsBloom()) return;

    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    /*
     * Let EffectComposer build its own targets.
     *
     * It already creates them as HalfFloatType — which is the load-bearing detail
     * here, since at 8 bits per channel everything above white is clipped before
     * bloom ever sees it — and, critically, it sizes them by the *drawing buffer*,
     * multiplying by the renderer's pixel ratio.
     *
     * Supplying a hand-built target instead was a mistake worth recording: the
     * composer treats a provided target's dimensions as final and sets its own
     * pixel ratio to 1, so on any display with a ratio above 1 the chain rendered
     * at CSS resolution into a canvas expecting more, and the frame came out as a
     * smeared gradient with no scene in it at all.
     */
    this.composer = new EffectComposer(this.renderer);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    /*
     * --- Ambient occlusion ---------------------------------------------------
     *
     * The single largest perceptual upgrade available to this scene, and the one
     * thing no amount of geometry or lighting tuning was going to fix.
     *
     * The problem it solves: every object here is lit by a sun plus a hemisphere
     * term, and a hemisphere light has no idea what is next to what. A tuft of
     * grass, the tree trunk behind it and the log lying across both all receive
     * the same sky contribution, so nothing ever darkens where it meets something
     * else — and contact is exactly what the eye uses to read depth. It is why a
     * dense jungle could still look like objects floating in front of each other
     * rather than a place with things standing in it.
     *
     * GTAO rather than SSAO: it is a ground-truth-derived estimator, so it
     * produces horizon-correct occlusion instead of the grey halo SSAO puts
     * around every silhouette — which on a screen made almost entirely of thin
     * overlapping foliage would have been far worse than no AO at all.
     *
     * HIGH only. It renders a depth+normal prepass, so it costs roughly a second
     * geometry pass, and the machines on MEDIUM are already spending their budget
     * on the foliage itself.
     */
    const effects = this.settings.effectsQuality;
    if (effects === 'high') {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      /*
       * Tuned for a scene at this scale. The defaults assume something
       * room-sized: a 0.25 m radius over a jungle occludes nothing but the gap
       * between one blade of grass and the next, which is invisible and costs the
       * same. A metre and a half catches what actually matters — the base of a
       * trunk, the underside of a bush, the hollow a log sits in.
       */
      ao.updateGtaoMaterial({
        radius: 1.5,
        distanceExponent: 1.4,
        thickness: 1.2,
        // Deliberately short of full strength. The rainforest floor is already
        // the darkest thing on screen and the game depends on reading animal
        // shapes in it; AO that bottoms out turns cover into a black hole.
        scale: 0.85,
        samples: 16,
      });
      ao.blendIntensity = 0.72;
      this.composer.addPass(ao);
      this.gtao = ao;
    }

    const level = this.settings.effectsQuality as 'low' | 'medium' | 'high';
    const cfg = BLOOM[level] ?? BLOOM.low;
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      cfg.strength,
      cfg.radius,
      cfg.threshold,
    );
    this.composer.addPass(this.bloom);

    /*
     * SMAA whenever anti-aliasing is asked for.
     *
     * Not optional once the composer is in play: the WebGL context's own MSAA
     * applies to the default framebuffer, and the scene no longer renders there.
     * Switching post-processing on without this would silently turn off the
     * anti-aliasing the settings screen still claims is enabled.
     */
    if (this.settings.antiAliasing) {
      this.smaa = new SMAAPass(size.x, size.y);
      this.composer.addPass(this.smaa);
    }

    // Always last: tone mapping and the conversion to sRGB for display.
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  render(): void {
    this.composer?.render();
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    if (this.renderPass) this.renderPass.camera = camera;
    // GTAO holds its own camera reference for the depth/normal prepass, so it
    // has to be told too or the AO would be computed from the previous view.
    if (this.gtao) this.gtao.camera = camera;
  }

  setSize(width: number, height: number): void {
    this.composer?.setSize(width, height);
    this.bloom?.setSize(width, height);
    this.gtao?.setSize(width, height);
  }

  setSettings(settings: GraphicsSettings): void {
    const previous = this.settings;
    this.settings = settings;
    if (
      settings.effectsQuality !== previous.effectsQuality ||
      settings.antiAliasing !== previous.antiAliasing
    ) {
      this.rebuild();
    }
  }

  dispose(): void {
    // The composer owns its read/write targets and disposes both.
    this.composer?.dispose();
    this.bloom?.dispose();
    this.smaa?.dispose();
    this.gtao?.dispose();
    this.outputPass?.dispose();
    this.composer = null;
    this.bloom = null;
    this.smaa = null;
    this.gtao = null;
    this.renderPass = null;
    this.outputPass = null;
  }
}
