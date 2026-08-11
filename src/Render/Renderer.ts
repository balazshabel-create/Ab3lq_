/**
 * Renderer.ts — the scene, the camera and the frame loop's draw half.
 *
 * Owns the WebGL renderer and composes the individual systems (sky, terrain,
 * water, foliage, animals, effects). It consumes snapshots and never touches the
 * simulation, which is what allows the same renderer to display a locally hosted
 * world and a remote one.
 */

import * as THREE from 'three';
import { Terrain } from '../World/Terrain';
import type { WorldContent } from '../World/WorldGen';
import { Weather } from '../Core/Types';
import type { Snapshot } from '../Networking/Protocol';
import type { GraphicsSettings } from '../Graphics/QualitySettings';
import { TerrainMesh } from './TerrainMesh';
import { WaterSystem, buildWaterDepthTexture } from './WaterSystem';
import { SkySystem } from './SkySystem';
import { FoliageRenderer } from './FoliageRenderer';
import { GrassField } from './GrassField';
import { BackdropSystem } from './BackdropSystem';
import { StormRenderer, type StormCircle } from './StormRenderer';
import { AnimalRenderer } from './AnimalRenderer';
import { EffectsRenderer, type FlySwarmInput } from './EffectsRenderer';
import { PostProcessing } from './PostProcessing';
import { CameraRig } from '../Player/CameraRig';
import { SpatialGrid } from '../Systems/SpatialGrid';
import { BACKDROP_RADIUS, WATER_LEVEL } from '../Systems/Config';
import { clamp01, lerp } from '../Systems/Noise';

/** A prop treated as a vertical cylinder the camera cannot pass through. */
interface CameraBlocker {
  id: number;
  pos: { x: number; z: number };
  radius: number;
  baseY: number;
  topY: number;
}

export interface RenderWorldState {
  hour: number;
  weather: Weather;
  rain: number;
  fog: number;
  wind: number;
  waterLevel: number;
  /** Lightning flash, 0..1. */
  lightning: number;
  /**
   * The storm circle, straight from the authority, or null outside a round.
   *
   * Passed through rather than recomputed so the drawn wall and the wall that
   * does damage are the same circle — see StormZone.ts.
   */
  zone: StormCircle | null;
}

/**
 * Camera far plane.
 *
 * Has to clear the backdrop's mountains, which stand kilometres out — a far
 * plane sized only for the view distance would clip them away entirely. The
 * near plane stays at 10 cm: a 24-bit depth buffer handles a 0.1–5500 m range
 * with millimetre precision in the near field, so the wide range costs nothing.
 */
function farPlaneFor(settings: GraphicsSettings): number {
  return Math.max(settings.viewDistance * 3, BACKDROP_RADIUS * 1.3);
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraRig: CameraRig;

  readonly sky: SkySystem;
  readonly terrainMesh: TerrainMesh;
  readonly water: WaterSystem;
  readonly foliage: FoliageRenderer;
  readonly grass: GrassField;
  readonly backdrop: BackdropSystem;
  readonly storm: StormRenderer;
  readonly animals: AnimalRenderer;
  readonly effects: EffectsRenderer;
  readonly post: PostProcessing;

  private terrain: Terrain;
  /** Public so the verification tools can read the live preset values. */
  settings: GraphicsSettings;
  private swarms: FlySwarmInput[] = [];
  private wakes: { x: number; z: number; speed: number; radius: number }[] = [];
  private splashes: { x: number; z: number; strength: number }[] = [];
  /**
   * Water level as of the last frame, used by the water test and the ripples.
   * A flash flood raises it, so it cannot be read from the constant.
   */
  private waterLevel = WATER_LEVEL;
  private time = 0;
  private canvas: HTMLCanvasElement;
  /** Extra FOV added by the "Bad Eye" weakness vignette, etc. */
  private fovModifier = 1;
  private frameTimes: number[] = [];
  private lightningFlash = 0;
  /** 0..1 how deep into the storm the camera is, for the HUD overlay. */
  private stormIntensity = 0;
  /** The colour of the water from inside it — fog, and the scene background. */
  private readonly underwaterColor = new THREE.Color(0x16362c);
  /** Props the camera must not end up inside. */
  private cameraBlockers = new SpatialGrid<CameraBlocker>(16);

  constructor(
    canvas: HTMLCanvasElement,
    terrain: Terrain,
    content: WorldContent,
    settings: GraphicsSettings,
  ) {
    this.canvas = canvas;
    this.terrain = terrain;
    this.settings = settings;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.antiAliasing,
      powerPreference: 'high-performance',
      // Needed for screenshots and for the menu's canvas capture.
      preserveDrawingBuffer: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.resolutionScale * 2));
    this.renderer.shadowMap.enabled = settings.shadowQuality !== 'off';
    this.renderer.shadowMap.type =
      settings.shadowQuality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    /*
     * Accumulate render stats manually.
     *
     * `renderer.info` resets itself on every `render()` call, and a post-processing
     * chain calls render once per pass — so the debug overlay ended up reporting
     * the single full-screen quad of the last pass and declaring that the world
     * was not being drawn. Resetting once per frame instead makes the counters
     * cover the whole frame, passes included.
     */
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    // Exponential fog: the jungle should close in around you, and it is also
    // what hides the view-distance boundary.
    this.scene.fog = new THREE.FogExp2(0xb8cfe0, 0.006);

    this.camera = new THREE.PerspectiveCamera(
      72,
      canvas.clientWidth / Math.max(1, canvas.clientHeight),
      0.1,
      farPlaneFor(settings),
    );
    this.cameraRig = new CameraRig(this.camera, terrain);

    this.sky = new SkySystem(this.scene, settings);
    this.terrainMesh = new TerrainMesh(terrain, settings.terrainSegments);
    this.scene.add(this.terrainMesh.mesh);

    const depthMap = buildWaterDepthTexture((x, z) => terrain.heightAt(x, z), 256);
    this.water = new WaterSystem(depthMap, settings);
    this.scene.add(this.water.mesh);

    this.foliage = new FoliageRenderer(this.scene, content, settings);
    this.grass = new GrassField(this.scene, terrain, settings);
    this.backdrop = new BackdropSystem(this.scene, terrain, settings);
    this.storm = new StormRenderer(this.scene, settings);
    this.animals = new AnimalRenderer(this.scene, settings);
    this.effects = new EffectsRenderer(this.scene, settings);
    this.post = new PostProcessing(this.renderer, this.scene, this.camera, settings);

    this.buildCameraBlockers(content);
    this.cameraRig.setBlockerTest((x, y, z) => this.isBlocked(x, y, z));

    // The animal renderer needs to know who is in the water so it can play the
    // swimming animation; the terrain lives here, so the test is supplied here.
    // Terrain-following bodies need the ground height under each end of an
    // animal, so a long one does not bury its snout in a hillside.
    this.animals.setGroundSampler((x, z) => terrain.surfaceAt(x, z));

    this.animals.setWaterTest((x, z, y) => {
      if (!terrain.isWater(x, z)) return false;
      // Also require the animal to actually be down at the surface, so a monkey
      // in a tree overhanging the river is not treated as swimming.
      return y <= this.waterLevel + 0.6;
    });

    this.resize();
  }

  /**
   * Index the props big enough to swallow the camera.
   *
   * Only the chunky ones: pushing the camera out of every fern would make it
   * jitter constantly, and you can see straight through a fern anyway.
   */
  private buildCameraBlockers(content: WorldContent): void {
    const blockers: CameraBlocker[] = [];
    let id = 1;
    for (const tree of content.trees) {
      // The trunk only. The canopy sits well above the camera's working height.
      blockers.push({
        id: id++,
        pos: { x: tree.x, z: tree.z },
        radius: tree.radius + 0.35,
        baseY: tree.y,
        topY: tree.y + tree.branchHeight,
      });
    }
    for (const rock of content.rocks) {
      if (rock.scale < 1.2) continue;
      blockers.push({
        id: id++,
        pos: { x: rock.x, z: rock.z },
        radius: rock.scale * 0.8,
        baseY: rock.y - 1,
        topY: rock.y + rock.scale * 1.1,
      });
    }
    for (const hut of content.huts) {
      blockers.push({
        id: id++,
        pos: { x: hut.x, z: hut.z },
        radius: 2.6 * hut.scale,
        baseY: hut.y,
        topY: hut.y + 5.2 * hut.scale,
      });
    }
    for (const cave of content.caves) {
      blockers.push({
        id: id++,
        pos: { x: cave.x, z: cave.z },
        radius: 2.6 * cave.scale,
        baseY: cave.y - 1,
        topY: cave.y + 3 * cave.scale,
      });
    }
    this.cameraBlockers.rebuild(blockers);
  }

  /**
   * Is the camera below the water surface?
   *
   * Both tests matter. The height test alone would trigger inside a valley whose
   * floor happens to be below the water line but which holds no water, and the
   * `isWater` test alone would trigger whenever a crocodile stood in the shallows
   * with the camera comfortably in the air above it. A small margin below the
   * surface stops the whole screen flickering between the two states while an
   * animal bobs on a wave right at the water line.
   */
  private isCameraUnderwater(): boolean {
    const p = this.camera.position;
    if (p.y > this.waterLevel - 0.12) return false;
    return this.terrain.isWater(p.x, p.z);
  }

  /** Is there solid scenery at this point? */
  private isBlocked(x: number, y: number, z: number): boolean {
    let blocked = false;
    this.cameraBlockers.forEachInRadius(x, z, 4, (b) => {
      if (blocked) return;
      if (y < b.baseY || y > b.topY) return;
      const dx = x - b.pos.x;
      const dz = z - b.pos.z;
      if (dx * dx + dz * dz <= b.radius * b.radius) blocked = true;
    });
    return blocked;
  }

  /** Ingest a snapshot. */
  applySnapshot(snapshot: Snapshot): void {
    this.animals.applySnapshot(snapshot.actors);
    this.effects.updateTracks(snapshot.tracks, (x, z) => this.terrain.surfaceAt(x, z));
    this.effects.updateNoisePings(
      snapshot.noises,
      (x, z) => this.terrain.surfaceAt(x, z),
      this.time,
    );
    if (snapshot.noises.length > 0) {
      // Colour the rings by the loudest noise, which is the most informative.
      let loudest = snapshot.noises[0];
      for (const n of snapshot.noises) if (n.volume > loudest.volume) loudest = n;
      this.effects.setPingTone(loudest.kind);
    }
  }

  setLocalActor(id: number): void {
    this.animals.setLocalActor(id);
    this.cameraRig.setTarget(id);
  }

  /** Sight multiplier from the player's weakness (Bad Eye narrows the view). */
  setSightModifier(scale: number): void {
    this.fovModifier = clamp01(scale);
  }

  /**
   * Draw one frame.
   *
   * `dt` is real elapsed time; nothing here is simulated, so a dropped frame
   * only means less smooth interpolation, never a gameplay difference.
   */
  render(dt: number, world: RenderWorldState): void {
    this.renderer.info.reset();
    this.time += dt;
    this.waterLevel = world.waterLevel;

    // --- Camera ----------------------------------------------------------
    this.cameraRig.update(dt, this.animals);
    const cameraPos = this.camera.position;

    // --- Sky and lighting ------------------------------------------------
    const skyState = this.sky.update(
      world.hour,
      world.weather,
      world.rain,
      world.fog,
      cameraPos,
      this.settings,
    );

    /*
     * --- Under the water --------------------------------------------------
     *
     * Only crocodilians can submerge, so for most of the roster this never
     * happens — but when it does the whole frame has to change, because the point
     * of diving is that you *stop being able to see the world above* and the
     * world above stops being able to see you.
     *
     * Three changes do all of it:
     *   • fog becomes twenty times denser and green, so visibility drops to about
     *     twelve metres and everything beyond it dissolves into silt;
     *   • the sky dome and the distant backdrop are hidden, and the scene
     *     background becomes murky water, so there is no sky above the surface to
     *     see through it;
     *   • the water shader switches to its from-below branch — a rippling ceiling
     *     rather than a translucent sheet.
     *
     * What is left visible is the river bed, the weed, and any animal within a
     * dozen metres. Which is the entire tactical proposition of submerging.
     */
    const underwater = this.isCameraUnderwater();
    this.sky.setVisible(!underwater);
    this.backdrop.setVisible(!underwater);
    if (underwater) {
      if (!this.scene.background) this.scene.background = this.underwaterColor;
    } else if (this.scene.background) {
      this.scene.background = null;
    }

    // --- Fog ---------------------------------------------------------------
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(skyState.fogColor);
    /*
     * FogExp2 falls off as 1 - exp(-(density * depth)²), so density scales as
     * 1/viewDistance.
     *
     * The constant used to be 0.95, chosen so the fog was thick enough to hide
     * the point where the terrain simply stopped. It does not have to do that job
     * any more — the backdrop continues the jungle out to the mountains, so there
     * is no edge to hide — and at 0.95 the fog saturates completely somewhere
     * around four hundred metres, which means the distant jungle and the mountain
     * range are drawn behind a solid wall of fog colour and might as well not
     * exist.
     *
     * 0.42 leaves a visible haze in the near field (about 16% at the view
     * distance) while letting the horizon through. The jungle still closes in
     * around you — that now comes from the foliage being dense, which is a better
     * reason for it than the air being opaque.
     */
    const baseDensity = 0.42 / Math.max(40, this.settings.viewDistance);
    /*
     * The weather term is kept modest. Rain is supposed to mask *sound* — that
     * is the tactical property the simulation actually models — not to blind
     * everybody. Fog weather is the state that genuinely cuts visibility, so it
     * carries most of the weight here.
     */
    const weatherDensity = world.fog * 0.014 + world.rain * 0.004;
    if (underwater) {
      // ~12 m of visibility. Silty green rather than blue: this is an Amazon
      // tributary, which carries enough sediment to be opaque in a metre.
      fog.color.copy(this.underwaterColor);
      fog.density = 0.115;
    } else {
      fog.density = baseDensity + weatherDensity;
    }

    // --- The storm wall ---------------------------------------------------
    // Hidden underwater: from the river bed you can see twelve metres, so a
    // hundred-metre-tall squall would only render as a smear of fog colour.
    this.storm.update(underwater ? null : world.zone, dt, this.time);
    this.stormIntensity = this.storm.intensityAt(world.zone, cameraPos.x, cameraPos.z);

    // --- Lightning --------------------------------------------------------
    // A storm flash briefly blows out the exposure and lights the whole map.
    // Strikes inside the zone wall count too, scaled by how close the camera is
    // to it — otherwise the most electrically violent thing on screen has no
    // effect on the scene's lighting at all.
    const zoneFlash = this.storm.flashLevel * (0.25 + this.stormIntensity * 0.75);
    this.lightningFlash = Math.max(this.lightningFlash - dt * 3.5, world.lightning, zoneFlash);
    if (this.lightningFlash > 0.01) {
      this.renderer.toneMappingExposure = 1.05 + this.lightningFlash * 1.5;
      this.sky.ambientLight.intensity += this.lightningFlash * 1.8;
    } else {
      this.renderer.toneMappingExposure = 1.05;
    }

    // --- Water -------------------------------------------------------------
    this.water.update(
      this.time,
      cameraPos,
      skyState.sunDirection,
      skyState.horizonColor,
      skyState.sunColor,
      world.rain,
      world.waterLevel,
      underwater,
    );

    // --- World content ----------------------------------------------------
    this.foliage.update(cameraPos, this.time, world.wind);
    this.grass.update(cameraPos, this.time, world.wind);
    // The backdrop is outside the scene fog and does its own aerial
    // perspective, so it has to be handed the sky's colours explicitly.
    this.backdrop.update(
      skyState.horizonColor,
      skyState.sunColor,
      skyState.sunDirection,
      skyState.night,
    );
    this.animals.update(dt, cameraPos, this.time);

    // --- Effects ----------------------------------------------------------
    this.animals.collectWaterWakes(this.wakes);
    // Splashes first, so a ring spawned this frame is drawn this frame.
    this.animals.collectSplashes(this.splashes);
    this.effects.spawnSplash(this.splashes);
    // Rain dimples the river. Skipped underwater, where the surface is above you
    // and its rings would be drawn from the wrong side.
    if (!underwater) {
      this.effects.spawnRainDimples(
        world.rain,
        cameraPos.x,
        cameraPos.z,
        (x, z) => this.terrain.isWater(x, z),
        dt,
      );
    }
    this.effects.updateRipples(this.wakes, world.waterLevel, dt);
    this.animals.collectFlySwarms(this.swarms);
    this.effects.update(
      dt,
      this.time,
      cameraPos,
      this.swarms,
      world.rain,
      world.fog,
      world.wind,
      skyState.fogColor,
    );

    // --- Field of view ----------------------------------------------------
    // A weakened eye narrows the usable view slightly. Subtle on purpose: it
    // must be a handicap the player feels, not one the hunter can see.
    const targetFov = lerp(60, 74, this.fovModifier);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, targetFov, Math.min(1, dt * 4));
      this.camera.updateProjectionMatrix();
    }

    /*
     * Draw. Through the composer when post-processing is on, straight to the
     * canvas when it is not — see PostProcessing for why an inactive chain is
     * absent rather than merely disabled.
     */
    if (this.post.active) this.post.render();
    else this.renderer.render(this.scene, this.camera);

    // Rolling frame-time window for the debug overlay.
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
  }

  /** Apply changed graphics settings, rebuilding only what must be rebuilt. */
  setSettings(settings: GraphicsSettings): void {
    const previous = this.settings;
    this.settings = settings;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.resolutionScale * 2));
    this.renderer.shadowMap.enabled = settings.shadowQuality !== 'off';
    this.renderer.shadowMap.type =
      settings.shadowQuality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;

    this.camera.far = farPlaneFor(settings);
    this.camera.updateProjectionMatrix();

    this.sky.setSettings(settings);
    this.backdrop.setSettings(settings);
    this.storm.setSettings(settings);
    this.water.setSettings(settings);
    this.animals.setSettings(settings);
    this.effects.setSettings(settings);
    this.post.setSettings(settings);

    // Foliage and terrain rebuilds are expensive, so only do them when the
    // setting that actually drives them has changed.
    if (
      settings.foliageQuality !== previous.foliageQuality ||
      settings.foliageDensity !== previous.foliageDensity ||
      settings.grassDistance !== previous.grassDistance ||
      settings.shadowQuality !== previous.shadowQuality
    ) {
      this.foliage.setSettings(settings);
    }
    this.grass.setSettings(settings);

    this.resize();
  }

  /** Match the drawing buffer to the canvas' CSS size. */
  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    // The composer's targets are sized independently of the canvas, so they have
    // to be told too or post-processing renders at the old resolution.
    this.post?.setSize(width, height);
  }

  /** How exposed the camera is to the storm, 0..1. Read by the HUD. */
  get stormExposure(): number {
    return this.stormIntensity;
  }

  /** Average frames per second over the recent window. */
  get fps(): number {
    if (this.frameTimes.length === 0) return 0;
    let total = 0;
    for (const t of this.frameTimes) total += t;
    return this.frameTimes.length / Math.max(1e-6, total);
  }

  /** Stats for the debug overlay. */
  stats(): {
    fps: number;
    drawCalls: number;
    triangles: number;
    animalsDrawn: number;
    foliageBatches: number;
  } {
    const info = this.renderer.info.render;
    return {
      fps: this.fps,
      drawCalls: info.calls,
      triangles: info.triangles,
      animalsDrawn: this.animals.drawnCount,
      foliageBatches: this.foliage.visibleBatches + this.grass.visibleChunks,
    };
  }

  dispose(): void {
    this.post.dispose();
    this.grass.dispose();
    this.storm.dispose();
    this.effects.dispose();
    this.animals.dispose();
    this.backdrop.dispose();
    this.foliage.dispose();
    this.water.dispose();
    this.terrainMesh.dispose();
    this.sky.dispose();
    this.renderer.dispose();
  }
}
