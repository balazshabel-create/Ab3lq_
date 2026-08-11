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
  varying vec2 vStreak;
  varying float vBright;

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
    /*
     * Bigger points than a drop needs, because the point is a *canvas* for the
     * streak the fragment shader draws inside it, not the drop itself. Rain read
     * as falling dots before — which is snow. What makes rain look like rain is
     * motion blur: each drop is a short line, not a dot.
     */
    gl_PointSize = clamp(420.0 / -mvPosition.z, 3.0, 26.0);

    /*
     * The streak's direction in *screen* space.
     *
     * A drop falls down the world's -Y and is pushed sideways by the wind, so its
     * apparent direction on screen depends on where the camera is looking. Project
     * the world-space velocity into clip space and hand the fragment shader the 2D
     * direction to smear along, so streaks lean correctly from any viewpoint —
     * including straight down, where they collapse to dots, which is also right.
     */
    vec3 velocity = normalize(vec3(uSlant * 6.0, -uHeight, 0.0));
    vec4 tip = projectionMatrix * (mvPosition + vec4(velocity * 0.6, 0.0));
    vec2 dir = tip.xy / max(1e-4, tip.w) - gl_Position.xy / max(1e-4, gl_Position.w);
    vStreak = length(dir) > 1e-5 ? normalize(dir) : vec2(0.0, 1.0);

    // Fade in at the top and out near the ground, so drops do not pop.
    vAlpha = smoothstep(0.0, 0.12, fall) * (1.0 - smoothstep(0.85, 1.0, fall));
    // Nearer drops are brighter, which gives the curtain depth.
    vBright = 0.55 + 0.45 * clamp(20.0 / -mvPosition.z, 0.0, 1.0);
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  varying vec2 vStreak;
  varying float vBright;

  void main() {
    // Point-local coordinates, centred and in -1..1.
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    // Split into "along the streak" and "across it". Anything more than a hair
    // off the line is discarded, which is what turns a square sprite into a
    // slanted line without any texture.
    float along = dot(p, vStreak);
    float across = abs(dot(p, vec2(-vStreak.y, vStreak.x)));
    float line = 1.0 - smoothstep(0.06, 0.34, across);
    // Taper both ends so the streak has a head and a tail rather than square cuts.
    line *= 1.0 - smoothstep(0.55, 1.0, abs(along));
    if (line <= 0.01) discard;
    gl_FragColor = vec4(uColor * vBright, line * vAlpha * uOpacity);
  }
`;

/**
 * Falling leaves.
 *
 * Same stateless trick as the rain — position is a pure function of time and a
 * per-particle seed, so thousands of leaves cost no CPU at all. They fall far
 * more slowly than rain and drift sideways as they go, which is what makes a
 * canopy feel alive even when nothing else is moving.
 */
const LEAF_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uRadius;
  uniform vec3 uCenter;
  uniform float uWind;
  attribute float aSeed;
  varying float vAlpha;
  varying float vShade;

  void main() {
    float seed = aSeed;
    // Each leaf has its own fall period, so they never form visible ranks.
    float fall = fract(uTime * (0.035 + seed * 0.05) + seed * 7.3);
    float y = uHeight * (1.0 - fall);

    float angle = seed * 6.2831853;
    float radius = uRadius * sqrt(fract(seed * 53.17));
    vec3 offset = vec3(cos(angle) * radius, y, sin(angle) * radius);

    // Tumbling drift: a slow spiral, widening as it descends.
    float t = uTime * (0.6 + seed) + seed * 20.0;
    offset.x += sin(t) * (1.2 + fall * 2.5) + uWind * fall * 9.0;
    offset.z += cos(t * 0.8) * (1.2 + fall * 2.5);

    vec4 mvPosition = viewMatrix * vec4(uCenter + offset, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(120.0 / -mvPosition.z, 1.5, 9.0);
    // Fade in high up and out just before the ground, so none of them pop.
    vAlpha = smoothstep(0.0, 0.1, fall) * (1.0 - smoothstep(0.88, 1.0, fall));
    // Flicker between face and edge as it tumbles.
    vShade = 0.55 + 0.45 * abs(sin(t * 1.7));
  }
`;

const LEAF_FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vShade;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    if (length(d) > 0.5) discard;
    vec3 color = mix(uColorA, uColorB, vShade);
    gl_FragColor = vec4(color, vAlpha * uOpacity);
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

  // --- Falling leaves -----------------------------------------------------
  private leaves: THREE.Points;
  private leafMaterial: THREE.ShaderMaterial;
  private leafGeometry: THREE.BufferGeometry;

  // --- Water ripples ------------------------------------------------------
  private ripples: THREE.InstancedMesh;
  private rippleMaterial: THREE.MeshBasicMaterial;
  /** Live ripples: expanding rings on the water surface. */
  private ripplePool: { x: number; z: number; age: number; life: number; scale: number }[] = [];
  private rippleSpawnAccumulator = 0;
  private dimpleAccumulator = 0;
  private static readonly RIPPLE_POOL = 96;

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

    // --- Falling leaves ---------------------------------------------------
    const leafCount = Math.max(1, Math.round(settings.rainParticles * 0.12) + 60);
    this.leafGeometry = new THREE.BufferGeometry();
    const leafSeeds = new Float32Array(leafCount);
    for (let i = 0; i < leafCount; i++) leafSeeds[i] = Math.random();
    this.leafGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(leafCount * 3), 3));
    this.leafGeometry.setAttribute('aSeed', new THREE.BufferAttribute(leafSeeds, 1));
    this.leafGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), WORLD_SIZE);

    this.leafMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: 26 },
        uRadius: { value: 40 },
        uCenter: { value: new THREE.Vector3() },
        uWind: { value: 0.2 },
        uColorA: { value: new THREE.Color(0x3d6b26) },
        uColorB: { value: new THREE.Color(0x8a7a2c) },
        uOpacity: { value: 0.85 },
      },
      vertexShader: LEAF_VERTEX,
      fragmentShader: LEAF_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.leaves = new THREE.Points(this.leafGeometry, this.leafMaterial);
    this.leaves.frustumCulled = false;
    this.leaves.name = 'falling-leaves';
    this.group.add(this.leaves);

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

    // --- Water ripples ----------------------------------------------------
    // Flat expanding rings laid on the water surface. Cheap, and they do a lot
    // of work: they show that an animal is *in* the water rather than floating
    // above it, and a wake is a genuine tell that something is moving out there.
    const rippleGeometry = new THREE.RingGeometry(0.55, 1, 18);
    rippleGeometry.rotateX(-Math.PI / 2);
    this.rippleMaterial = new THREE.MeshBasicMaterial({
      color: 0xcfe0da,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ripples = new THREE.InstancedMesh(
      rippleGeometry,
      this.rippleMaterial,
      EffectsRenderer.RIPPLE_POOL,
    );
    this.ripples.frustumCulled = false;
    this.ripples.count = 0;
    this.ripples.renderOrder = 2;
    this.ripples.name = 'water-ripples';
    this.group.add(this.ripples);

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

    // --- Falling leaves ---------------------------------------------------
    const leavesVisible = this.settings.effectsQuality !== 'off';
    this.leaves.visible = leavesVisible;
    if (leavesVisible) {
      const u = this.leafMaterial.uniforms;
      u.uTime.value = time;
      u.uCenter.value.set(cameraPos.x, cameraPos.y - 2, cameraPos.z);
      u.uWind.value = wind;
      u.uRadius.value = Math.min(46, this.settings.viewDistance * 0.26);
      // Leaves come down harder in wind and rain.
      u.uOpacity.value = 0.55 + clamp01(wind) * 0.35;
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
    const fogVisible = this.settings.volumetricFog && fogDensity > 0.2;
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
   * Spawn and advance water ripples.
   *
   * Ripples are emitted around anything in the water at a rate proportional to
   * how fast it is moving, then expand and fade. A stationary animal still emits
   * a slow trickle, so it reads as sitting *in* the water rather than on it.
   */
  /**
   * A burst of ripples where an animal broke the surface.
   *
   * Reuses the ripple pool rather than adding a droplet particle system: a splash
   * seen from a third-person camera a few metres away is mostly an expanding ring
   * of disturbed water, and a handful of overlapping rings at different sizes and
   * ages reads as one convincingly chaotic splash. Free, in the sense that the
   * pool, the geometry and the draw call all already exist.
   */
  spawnSplash(events: { x: number; z: number; strength: number }[]): void {
    if (this.settings.effectsQuality === 'off' || events.length === 0) return;
    for (const e of events) {
      const rings = Math.min(9, 3 + Math.round(e.strength * 4));
      for (let i = 0; i < rings; i++) {
        if (this.ripplePool.length >= EffectsRenderer.RIPPLE_POOL) return;
        const spread = 0.5 + e.strength * 0.6;
        this.ripplePool.push({
          x: e.x + (Math.random() - 0.5) * spread,
          z: e.z + (Math.random() - 0.5) * spread,
          // Stagger the ages so the rings do not expand in lockstep.
          age: Math.random() * 0.25,
          life: 0.5 + Math.random() * 0.7,
          scale: (0.6 + Math.random() * 1.5) * (0.6 + e.strength * 0.8),
        });
      }
    }
  }

  /**
   * Rain dimpling the water.
   *
   * Rain that falls *through* a river without touching it is one of those details
   * whose absence is hard to name and easy to feel. Reuses the ripple pool, so it
   * costs no extra draw call: the ring geometry, the material and the instanced
   * mesh are all already there for animal wakes.
   *
   * Candidates are sampled near the camera and rejected unless they land on water,
   * which keeps the cost to a handful of heightfield lookups per frame and means
   * dimples never appear on dry land.
   */
  spawnRainDimples(
    rain: number,
    cameraX: number,
    cameraZ: number,
    isWater: (x: number, z: number) => boolean,
    dt: number,
  ): void {
    if (this.settings.effectsQuality === 'off' || rain <= 0.05) return;
    this.dimpleAccumulator += dt * rain * 46;
    let budget = Math.min(6, Math.floor(this.dimpleAccumulator));
    if (budget <= 0) return;
    this.dimpleAccumulator -= budget;
    // Bounded attempts: in a jungle with no river in sight, most samples miss.
    let attempts = budget * 4;
    while (budget > 0 && attempts-- > 0) {
      if (this.ripplePool.length >= EffectsRenderer.RIPPLE_POOL) return;
      const a = Math.random() * Math.PI * 2;
      const r = 30 * Math.sqrt(Math.random());
      const x = cameraX + Math.cos(a) * r;
      const z = cameraZ + Math.sin(a) * r;
      if (!isWater(x, z)) continue;
      this.ripplePool.push({
        x,
        z,
        age: 0,
        // Short-lived and small: a raindrop, not an animal.
        life: 0.4 + Math.random() * 0.35,
        scale: 0.16 + Math.random() * 0.2,
      });
      budget--;
    }
  }

  updateRipples(
    wakes: { x: number; z: number; speed: number; radius: number }[],
    waterLevel: number,
    dt: number,
  ): void {
    if (this.settings.effectsQuality === 'off') {
      this.ripples.count = 0;
      return;
    }

    // --- Age out the existing ripples ------------------------------------
    for (let i = this.ripplePool.length - 1; i >= 0; i--) {
      this.ripplePool[i].age += dt;
      if (this.ripplePool[i].age >= this.ripplePool[i].life) this.ripplePool.splice(i, 1);
    }

    // --- Spawn new ones ---------------------------------------------------
    // One shared accumulator rather than a per-actor timer: the total spawn rate
    // is what has to stay bounded, however many animals are in the river.
    this.rippleSpawnAccumulator += dt;
    const spawnInterval = 0.09;
    if (wakes.length > 0 && this.rippleSpawnAccumulator >= spawnInterval) {
      this.rippleSpawnAccumulator = 0;
      for (const wake of wakes) {
        if (this.ripplePool.length >= EffectsRenderer.RIPPLE_POOL) break;
        // Fast movers throw ripples constantly; a drifting animal rarely.
        const chance = 0.12 + clamp01(wake.speed) * 0.85;
        if (Math.random() > chance) continue;
        // Scatter the origin a little so a wake is not a single tidy column.
        const jitter = wake.radius * 0.6;
        this.ripplePool.push({
          x: wake.x + (Math.random() - 0.5) * jitter,
          z: wake.z + (Math.random() - 0.5) * jitter,
          age: 0,
          life: 1.1 + Math.random() * 0.9,
          scale: wake.radius * (0.7 + Math.random() * 0.5),
        });
      }
    }

    // --- Draw -------------------------------------------------------------
    const count = Math.min(this.ripplePool.length, EffectsRenderer.RIPPLE_POOL);
    this.ripples.count = count;
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
      const r = this.ripplePool[i];
      const t = clamp01(r.age / r.life);
      // Expand quickly at first, then ease out — how a real ripple spreads.
      const size = r.scale * (0.3 + Math.pow(t, 0.55) * 1.5);
      this.trackPos.set(r.x, waterLevel + 0.05, r.z);
      this.trackQuat.identity();
      this.trackScale.set(size, 1, size);
      this.trackMatrix.compose(this.trackPos, this.trackQuat, this.trackScale);
      this.ripples.setMatrixAt(i, this.trackMatrix);
    }
    this.ripples.instanceMatrix.needsUpdate = true;

    // Fade the whole set with the youngest ripple's life, since per-instance
    // opacity would need a custom shader for very little visual gain.
    this.rippleMaterial.opacity = 0.13;
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
    this.leafGeometry.dispose();
    this.leafMaterial.dispose();
    this.tracks.geometry.dispose();
    this.trackMaterial.dispose();
    this.pings.geometry.dispose();
    this.pingMaterial.dispose();
    this.ripples.geometry.dispose();
    this.rippleMaterial.dispose();
    for (const plane of this.fogPlanes) plane.geometry.dispose();
    this.fogMaterial.dispose();
    this.group.removeFromParent();
  }
}
