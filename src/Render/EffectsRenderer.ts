/**
 * EffectsRenderer.ts — flies, rain, fog, footprints and the hunter's senses.
 *
 * The fly swarm is the single most important visual in the game. It is the only
 * unambiguous signal that an animal is a person, so it has to be:
 *   • unmistakable once it is large (the player has failed to whistle);
 *   • genuinely subtle when it is small (one or two flies, easily missed);
 *   • and readable at a distance without being readable across the whole map.
 *
 * Everything here is pooled. Rain and flies both spike in count, and allocating
 * geometry mid-round is how you get a frame-time spike at the worst moment.
 */

import * as THREE from 'three';
import { FLY_MAX_COUNT, TRACK_LIFETIME, WORLD_SIZE } from '../Systems/Config';
import { NoiseKind } from '../Core/Types';
import type { SnapshotNoise, SnapshotTrack } from '../Networking/Protocol';
import type { GraphicsSettings } from '../Graphics/QualitySettings';
import { clamp01 } from '../Systems/Noise';

/** One animal's fly swarm. */
export interface FlySwarmInput {
  pos: THREE.Vector3;
  intensity: number;
  height: number;
}

const RAIN_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uRadius;
  uniform vec3 uCenter;
  uniform float uSpeed;
  uniform float uSlant;
  attribute float aSeed;
  varying float vAlpha;

  void main() {
    // Each drop falls on a loop, so the whole system is stateless: position is
    // a pure function of time and the drop's seed. No CPU work per frame.
    float seed = aSeed;
    float fall = fract(uTime * uSpeed * (0.75 + seed * 0.5) + seed);
    float y = uHeight * (1.0 - fall);

    // Scatter drops in a disc that follows the camera.
    float angle = seed * 6.2831853;
    float radius = uRadius * sqrt(fract(seed * 97.31));
    vec3 offset = vec3(cos(angle) * radius, y, sin(angle) * radius);
    // Wind slant, and the drops streak with it.
    offset.x += uSlant * fall * 6.0;

    vec3 world = uCenter + offset;
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    // Perspective-correct size, clamped so near drops do not become blobs.
    gl_PointSize = clamp(90.0 / -mvPosition.z, 1.0, 5.0);
    // Fade in at the top and out near the ground, so drops do not pop.
    vAlpha = smoothstep(0.0, 0.12, fall) * (1.0 - smoothstep(0.85, 1.0, fall));
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  }
`;

const FLY_VERTEX = /* glsl */ `
  uniform float uTime;
  attribute vec3 aCenter;
  attribute float aSeed;
  attribute float aActive;
  varying float vActive;

  void main() {
    vActive = aActive;
    if (aActive < 0.5) {
      // Park inactive flies behind the camera rather than branching in the
      // fragment shader.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    // Each fly orbits its animal on its own little chaotic path.
    float t = uTime * (2.2 + aSeed * 2.4) + aSeed * 31.0;
    float radius = 0.28 + aSeed * 0.42;
    vec3 offset = vec3(
      cos(t) * radius + sin(t * 2.7) * 0.12,
      sin(t * 1.6) * 0.18 + cos(t * 3.1) * 0.07,
      sin(t) * radius + cos(t * 2.3) * 0.12
    );

    vec4 mvPosition = viewMatrix * vec4(aCenter + offset, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(45.0 / -mvPosition.z, 1.5, 7.0);
  }
`;

const FLY_FRAGMENT = /* glsl */ `
  precision mediump float;
  varying float vActive;
  void main() {
    if (vActive < 0.5) discard;
    // Round, dark, slightly soft — reads as an insect rather than a pixel.
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float alpha = smoothstep(0.5, 0.24, r);
    gl_FragColor = vec4(0.06, 0.05, 0.04, alpha);
  }
`;

/** Total fly particles the pool can draw at once. */
const FLY_POOL = FLY_MAX_COUNT * 14;

export class EffectsRenderer {
  private group = new THREE.Group();
  private settings: GraphicsSettings;

  // --- Rain ---------------------------------------------------------------
  private rain: THREE.Points;
  private rainMaterial: THREE.ShaderMaterial;
  private rainGeometry: THREE.BufferGeometry;

  // --- Flies --------------------------------------------------------------
  private flies: THREE.Points;
  private flyMaterial: THREE.ShaderMaterial;
  private flyGeometry: THREE.BufferGeometry;
  private flyCenters: Float32Array;
  private flyActive: Float32Array;

  // --- Footprints ---------------------------------------------------------
  private tracks: THREE.InstancedMesh;
  private trackMaterial: THREE.MeshBasicMaterial;
  private trackMatrix = new THREE.Matrix4();
  private trackQuat = new THREE.Quaternion();
  private trackScale = new THREE.Vector3();
  private trackPos = new THREE.Vector3();
  private static readonly TRACK_POOL = 220;

  // --- Noise pings (the hunter's "listen" sense) --------------------------
  private pings: THREE.InstancedMesh;
  private pingMaterial: THREE.MeshBasicMaterial;
  private static readonly PING_POOL = 40;

  // --- Ground fog ---------------------------------------------------------
  private fogPlanes: THREE.Mesh[] = [];
  private fogMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, settings: GraphicsSettings) {
    this.settings = settings;
    this.group.name = 'effects';
    scene.add(this.group);

    // --- Rain -------------------------------------------------------------
    const rainCount = Math.max(1, settings.rainParticles);
    this.rainGeometry = new THREE.BufferGeometry();
    const rainSeeds = new Float32Array(rainCount);
    const rainDummy = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) rainSeeds[i] = Math.random();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainDummy, 3));
    this.rainGeometry.setAttribute('aSeed', new THREE.BufferAttribute(rainSeeds, 1));
    // The shader positions every drop, so the CPU-side bounds are meaningless;
    // disable culling rather than letting three cull the whole system away.
    this.rainGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), WORLD_SIZE);

    this.rainMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: 34 },
        uRadius: { value: 46 },
        uCenter: { value: new THREE.Vector3() },
        uSpeed: { value: 0.55 },
        uSlant: { value: 0.4 },
        uColor: { value: new THREE.Color(0xaec6d8) },
        uOpacity: { value: 0 },
      },
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.rain = new THREE.Points(this.rainGeometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.name = 'rain';
    this.group.add(this.rain);

    // --- Flies ------------------------------------------------------------
    this.flyGeometry = new THREE.BufferGeometry();
    this.flyCenters = new Float32Array(FLY_POOL * 3);
    this.flyActive = new Float32Array(FLY_POOL);
    const flySeeds = new Float32Array(FLY_POOL);
    for (let i = 0; i < FLY_POOL; i++) flySeeds[i] = Math.random();
    this.flyGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLY_POOL * 3), 3));
    this.flyGeometry.setAttribute('aCenter', new THREE.BufferAttribute(this.flyCenters, 3));
    this.flyGeometry.setAttribute('aSeed', new THREE.BufferAttribute(flySeeds, 1));
    this.flyGeometry.setAttribute('aActive', new THREE.BufferAttribute(this.flyActive, 1));
    this.flyGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), WORLD_SIZE);

    this.flyMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: FLY_VERTEX,
      fragmentShader: FLY_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.flies = new THREE.Points(this.flyGeometry, this.flyMaterial);
    this.flies.frustumCulled = false;
    this.flies.name = 'flies';
    this.group.add(this.flies);

    // --- Footprints -------------------------------------------------------
    // A small flattened wedge, laid on the ground and faded by age.
    const printGeometry = new THREE.CircleGeometry(0.16, 5);
    printGeometry.rotateX(-Math.PI / 2);
    this.trackMaterial = new THREE.MeshBasicMaterial({
      color: 0x2a1f14,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.tracks = new THREE.InstancedMesh(
      printGeometry,
      this.trackMaterial,
      EffectsRenderer.TRACK_POOL,
    );
    this.tracks.frustumCulled = false;
    this.tracks.count = 0;
    this.tracks.name = 'tracks';
    this.group.add(this.tracks);

    // --- Noise pings ------------------------------------------------------
    const ringGeometry = new THREE.RingGeometry(0.7, 1, 14);
    ringGeometry.rotateX(-Math.PI / 2);
    this.pingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd977,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.pings = new THREE.InstancedMesh(ringGeometry, this.pingMaterial, EffectsRenderer.PING_POOL);
    this.pings.frustumCulled = false;
    this.pings.count = 0;
    this.pings.name = 'noise-pings';
    this.group.add(this.pings);

    // --- Ground fog -------------------------------------------------------
    // A few large soft planes near the ground. Not true volumetrics, but it
    // gives the layered mist look for very little cost, and it moves.
    this.fogMaterial = new THREE.MeshBasicMaterial({
      color: 0xbfc9c2,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 4; i++) {
      const plane = new THREE.PlaneGeometry(190, 190);
      plane.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(plane, this.fogMaterial);
      mesh.position.y = 1.4 + i * 2.2;
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      this.fogPlanes.push(mesh);
      this.group.add(mesh);
    }
  }

  /**
   * Update every effect.
   *
   * `swarms` comes straight from the AnimalRenderer, so flies follow the
   * interpolated render position rather than the last snapshot position — which
   * matters, because a swarm lagging behind its animal is a dead giveaway that
   * something is being drawn specially.
   */
  update(
    dt: number,
    time: number,
    cameraPos: THREE.Vector3,
    swarms: FlySwarmInput[],
    rainIntensity: number,
    fogDensity: number,
    wind: number,
    fogColor: THREE.Color,
  ): void {
    void dt;

    // --- Rain -------------------------------------------------------------
    const rainVisible = rainIntensity > 0.02 && this.settings.effectsQuality !== 'off';
    this.rain.visible = rainVisible;
    if (rainVisible) {
      const u = this.rainMaterial.uniforms;
      u.uTime.value = time;
      u.uCenter.value.set(cameraPos.x, cameraPos.y - 4, cameraPos.z);
      u.uOpacity.value = clamp01(rainIntensity) * 0.55;
      u.uSlant.value = wind * 1.6;
      u.uSpeed.value = 0.45 + rainIntensity * 0.5;
      u.uRadius.value = Math.min(60, this.settings.viewDistance * 0.32);
    }

    // --- Flies ------------------------------------------------------------
    this.flyMaterial.uniforms.uTime.value = time;
    let slot = 0;
    for (const swarm of swarms) {
      // Count scales with intensity, so one missed second is one or two flies
      // and a fully overdue player is wearing a cloud.
      const count = Math.min(FLY_MAX_COUNT, Math.ceil(swarm.intensity * FLY_MAX_COUNT));
      for (let i = 0; i < count && slot < FLY_POOL; i++, slot++) {
        this.flyCenters[slot * 3] = swarm.pos.x;
        this.flyCenters[slot * 3 + 1] = swarm.pos.y + swarm.height;
        this.flyCenters[slot * 3 + 2] = swarm.pos.z;
        this.flyActive[slot] = 1;
      }
    }
    // Deactivate the rest of the pool.
    for (let i = slot; i < FLY_POOL; i++) this.flyActive[i] = 0;
    (this.flyGeometry.attributes.aCenter as THREE.BufferAttribute).needsUpdate = true;
    (this.flyGeometry.attributes.aActive as THREE.BufferAttribute).needsUpdate = true;
    this.flies.visible = slot > 0;

    // --- Ground fog -------------------------------------------------------
    const fogVisible = this.settings.volumetricFog && fogDensity > 0.05;
    this.fogMaterial.opacity = fogVisible ? clamp01(fogDensity) * 0.16 : 0;
    this.fogMaterial.color.copy(fogColor).lerp(new THREE.Color(0xffffff), 0.25);
    for (let i = 0; i < this.fogPlanes.length; i++) {
      const plane = this.fogPlanes[i];
      plane.visible = fogVisible;
      if (!fogVisible) continue;
      // Drift the layers so the mist is never static.
      plane.position.x = cameraPos.x + Math.sin(time * 0.05 + i) * 12;
      plane.position.z = cameraPos.z + Math.cos(time * 0.04 + i * 1.7) * 12;
      plane.position.y = 1.2 + i * 2.4 + Math.sin(time * 0.3 + i) * 0.3;
    }
  }

  /**
   * Draw footprints.
   *
   * Note what is deliberately *not* here: no visual distinction between a print
   * left by a player and one left by an AI animal. The server does not send that
   * flag, and the renderer could not draw it if it wanted to. All the hunter
   * gets is "a capybara came through here", which is exactly the right amount of
   * information — it narrows the search without solving it.
   */
  updateTracks(tracks: SnapshotTrack[], groundHeight: (x: number, z: number) => number): void {
    const count = Math.min(tracks.length, EffectsRenderer.TRACK_POOL);
    this.tracks.count = count;
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
      const t = tracks[i];
      const age = clamp01(t.age / TRACK_LIFETIME);
      // Older prints shrink and fade.
      const scale = (1 - age * 0.45) * 0.9;
      this.trackPos.set(t.x, groundHeight(t.x, t.z) + 0.035, t.z);
      this.trackQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -t.yaw);
      this.trackScale.set(scale, 1, scale * 1.5);
      this.trackMatrix.compose(this.trackPos, this.trackQuat, this.trackScale);
      this.tracks.setMatrixAt(i, this.trackMatrix);
    }
    this.tracks.instanceMatrix.needsUpdate = true;
  }

  /**
   * Draw the hunter's heard-noise markers.
   *
   * Rings on the ground where a sound came from, sized by loudness and faded by
   * age. A whistle makes a big bright ring; a footstep makes a small dim one.
   */
  updateNoisePings(
    noises: SnapshotNoise[],
    groundHeight: (x: number, z: number) => number,
    time: number,
  ): void {
    const count = Math.min(noises.length, EffectsRenderer.PING_POOL);
    this.pings.count = count;
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
      const n = noises[i];
      // Expand outward over the ping's short life.
      const age = clamp01(n.age / 2.5);
      const size = (1.2 + (n.volume / 40) * 2.6) * (0.6 + age * 1.6);
      this.trackPos.set(n.x, groundHeight(n.x, n.z) + 0.08, n.z);
      this.trackQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      this.trackScale.set(size, 1, size);
      this.trackMatrix.compose(this.trackPos, this.trackQuat, this.trackScale);
      this.pings.setMatrixAt(i, this.trackMatrix);
    }
    this.pings.instanceMatrix.needsUpdate = true;
    // Pulse the whole set, so it reads as an active sense rather than decals.
    this.pingMaterial.opacity = 0.32 + Math.sin(time * 5) * 0.12;
  }

  /** Colour the pings by the loudest noise kind, as a quick readability aid. */
  setPingTone(kind: NoiseKind | null): void {
    switch (kind) {
      case NoiseKind.Whistle:
        this.pingMaterial.color.setHex(0x8ef0a0);
        break;
      case NoiseKind.Attack:
      case NoiseKind.Death:
        this.pingMaterial.color.setHex(0xf07a6a);
        break;
      case NoiseKind.Splash:
        this.pingMaterial.color.setHex(0x7ec8f0);
        break;
      default:
        this.pingMaterial.color.setHex(0xffd977);
        break;
    }
  }

  setSettings(settings: GraphicsSettings): void {
    const rainChanged = settings.rainParticles !== this.settings.rainParticles;
    this.settings = settings;
    if (rainChanged) this.rebuildRain();
  }

  /** Resize the rain system when the effects preset changes. */
  private rebuildRain(): void {
    const count = Math.max(1, this.settings.rainParticles);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = Math.random();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.rainGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.rainGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), WORLD_SIZE);
  }

  dispose(): void {
    this.rainGeometry.dispose();
    this.rainMaterial.dispose();
    this.flyGeometry.dispose();
    this.flyMaterial.dispose();
    this.tracks.geometry.dispose();
    this.trackMaterial.dispose();
    this.pings.geometry.dispose();
    this.pingMaterial.dispose();
    for (const plane of this.fogPlanes) plane.geometry.dispose();
    this.fogMaterial.dispose();
    this.group.removeFromParent();
  }
}
