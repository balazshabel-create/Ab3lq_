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
import { AnimalRenderer } from './AnimalRenderer';
import { EffectsRenderer, type FlySwarmInput } from './EffectsRenderer';
import { CameraRig } from '../Player/CameraRig';
import { SpatialGrid } from '../Systems/SpatialGrid';
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
  readonly animals: AnimalRenderer;
  readonly effects: EffectsRenderer;

  private terrain: Terrain;
  private settings: GraphicsSettings;
  private swarms: FlySwarmInput[] = [];
  private time = 0;
  private canvas: HTMLCanvasElement;
  /** Extra FOV added by the "Bad Eye" weakness vignette, etc. */
  private fovModifier = 1;
  private frameTimes: number[] = [];
  private lightningFlash = 0;
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

    this.scene = new THREE.Scene();
    // Exponential fog: the jungle should close in around you, and it is also
    // what hides the view-distance boundary.
    this.scene.fog = new THREE.FogExp2(0xb8cfe0, 0.006);

    this.camera = new THREE.PerspectiveCamera(
      72,
      canvas.clientWidth / Math.max(1, canvas.clientHeight),
      0.1,
      settings.viewDistance * 3,
    );
    this.cameraRig = new CameraRig(this.camera, terrain);

    this.sky = new SkySystem(this.scene, settings);
    this.terrainMesh = new TerrainMesh(terrain, settings.terrainSegments);
    this.scene.add(this.terrainMesh.mesh);

    const depthMap = buildWaterDepthTexture((x, z) => terrain.heightAt(x, z), 256);
    this.water = new WaterSystem(depthMap, settings);
    this.scene.add(this.water.mesh);

    this.foliage = new FoliageRenderer(this.scene, content, settings);
    this.animals = new AnimalRenderer(this.scene, settings);
    this.effects = new EffectsRenderer(this.scene, settings);

    this.buildCameraBlockers(content);
    this.cameraRig.setBlockerTest((x, y, z) => this.isBlocked(x, y, z));

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
    this.time += dt;

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

    // --- Fog ---------------------------------------------------------------
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(skyState.fogColor);
    /*
     * FogExp2 falls off as 1 - exp(-(density * depth)²), so density scales as
     * 1/viewDistance. The constant matters a lot: at 1.9 the fog is fully opaque
     * *at* the view distance, which means it is already ~60% opaque at half that
     * — the jungle turns into a grey wall and you cannot see the trees you are
     * supposed to hide behind. 0.95 leaves the mid-distance readable while still
     * hiding the view-distance boundary, and the weather term does the heavy
     * lifting when fog or rain is actually meant to blind you.
     */
    const baseDensity = 0.95 / Math.max(40, this.settings.viewDistance);
    /*
     * The weather term is kept modest. Rain is supposed to mask *sound* — that
     * is the tactical property the simulation actually models — not to blind
     * everybody. Fog weather is the state that genuinely cuts visibility, so it
     * carries most of the weight here.
     */
    const weatherDensity = world.fog * 0.022 + world.rain * 0.004;
    fog.density = baseDensity + weatherDensity;

    // --- Lightning --------------------------------------------------------
    // A storm flash briefly blows out the exposure and lights the whole map.
    this.lightningFlash = Math.max(this.lightningFlash - dt * 3.5, world.lightning);
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
    );

    // --- World content ----------------------------------------------------
    this.foliage.update(cameraPos, this.time, world.wind);
    this.animals.update(dt, cameraPos, this.time);

    // --- Effects ----------------------------------------------------------
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

    this.renderer.render(this.scene, this.camera);

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

    this.camera.far = settings.viewDistance * 3;
    this.camera.updateProjectionMatrix();

    this.sky.setSettings(settings);
    this.water.setSettings(settings);
    this.animals.setSettings(settings);
    this.effects.setSettings(settings);

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

    this.resize();
  }

  /** Match the drawing buffer to the canvas' CSS size. */
  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
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
      foliageBatches: this.foliage.visibleBatches,
    };
  }

  dispose(): void {
    this.effects.dispose();
    this.animals.dispose();
    this.foliage.dispose();
    this.water.dispose();
    this.terrainMesh.dispose();
    this.sky.dispose();
    this.renderer.dispose();
  }
}
