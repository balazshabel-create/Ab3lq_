/**
 * SkySystem.ts — sky, sun, moon, stars and the lighting rig.
 *
 * The round always runs from mid-afternoon into full night, so this system is
 * doing real gameplay work: the light level is the main reason the last three
 * minutes of a round feel completely different from the first three. Everything
 * — sky gradient, sun colour, fog density, ambient level — is driven from one
 * "hour of day" value plus the weather, so they can never drift out of step.
 */

import * as THREE from 'three';
import { Weather } from '../Core/Types';
import { clamp01, lerp, smoothstep } from '../Systems/Noise';
import { shadowMapSize, type GraphicsSettings } from '../Graphics/QualitySettings';
import { WORLD_SIZE } from '../Systems/Config';

const SKY_VERTEX = /* glsl */ `
  varying vec3 vWorldDirection;
  void main() {
    vWorldDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Push the dome to the far plane so it never occludes anything.
    gl_Position.z = gl_Position.w;
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec3 uHorizonColor;
  uniform vec3 uZenithColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform float uStarStrength;
  uniform float uSunSize;
  uniform float uHaze;

  varying vec3 vWorldDirection;

  // Cheap hash-based star field: no texture, and stable between frames because
  // it is a pure function of the view direction.
  float stars(vec3 dir) {
    vec3 p = dir * 220.0;
    vec3 cell = floor(p);
    float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (h < 0.9965) return 0.0;
    vec3 local = fract(p) - 0.5;
    float d = length(local);
    // Twinkle amount varies per star.
    float brightness = (h - 0.9965) / 0.0035;
    return smoothstep(0.42, 0.0, d) * brightness;
  }

  void main() {
    vec3 dir = normalize(vWorldDirection);
    float up = clamp(dir.y, -1.0, 1.0);

    // Vertical gradient, compressed towards the horizon so the sky feels tall.
    float t = pow(clamp(up * 0.5 + 0.5, 0.0, 1.0), 0.55);
    vec3 color = mix(uHorizonColor, uZenithColor, t);

    // Haze band just above the horizon: what sells the humidity of a rainforest.
    float horizonBand = exp(-abs(up) * 9.0);
    color = mix(color, uHorizonColor * 1.12, horizonBand * uHaze);

    // The sun/moon disc plus its bloom.
    float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
    float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, sunDot);
    float glow = pow(sunDot, 26.0);
    color += uSunColor * (disc * 1.5 + glow * 0.55);

    // Stars, only above the horizon and only at night.
    if (uStarStrength > 0.01 && up > 0.0) {
      color += vec3(0.85, 0.88, 1.0) * stars(dir) * uStarStrength * smoothstep(0.0, 0.25, up);
    }

    gl_FragColor = vec4(color, 1.0);

    #include <colorspace_fragment>
  }
`;

/** A keyframe in the day/night colour ramp. */
interface SkyKey {
  hour: number;
  horizon: number;
  zenith: number;
  sun: number;
  ambient: number;
  /** Directional light intensity. */
  sunIntensity: number;
  /** Ambient light intensity. */
  ambientIntensity: number;
  fog: number;
}

/**
 * The colour script for the round.
 *
 * Hand-authored rather than physically derived: a round should look good, and
 * "golden hour into a blue-hour dusk into a moonlit night" is a much better
 * dramatic curve than an accurate atmosphere model would give.
 */
/*
 * A note on the intensities, because the scale is not obvious.
 *
 * Three.js applies the Lambert BRDF as `albedo / PI`, so a light intensity of
 * 1.0 does NOT produce an albedo-brightness surface — it produces roughly a
 * third of one. Full daylight therefore sits near PI (~3.14), not near 1.0.
 * Values around 1.0 look plausible in isolation and then render the rainforest
 * floor as pure black, because the canopy shadows almost everything and the
 * ambient term is all that reaches the ground.
 *
 * The ambient (hemisphere) term is deliberately generous relative to the sun:
 * it is what keeps canopy shade readable as dappled shade rather than a void,
 * and the whole game depends on being able to read animal behaviour in it.
 * Night still gets genuinely dark — that is the round's dramatic arc.
 */
const SKY_KEYS: SkyKey[] = [
  {
    hour: 12,
    horizon: 0xbcd6e8,
    zenith: 0x4a7fc0,
    sun: 0xfff6e0,
    ambient: 0x9fb8c8,
    sunIntensity: 3.0,
    ambientIntensity: 2.2,
    fog: 0xb8cfe0,
  },
  {
    hour: 16.5,
    horizon: 0xe8cfa4,
    zenith: 0x4f86bd,
    sun: 0xffe1a8,
    ambient: 0xa8a48c,
    sunIntensity: 2.8,
    ambientIntensity: 2.0,
    fog: 0xd8c9a8,
  },
  {
    hour: 18.6,
    horizon: 0xf2a05a,
    zenith: 0x3f5f96,
    sun: 0xff9d4a,
    ambient: 0x8f7a68,
    sunIntensity: 2.1,
    ambientIntensity: 1.5,
    fog: 0xd08a58,
  },
  {
    hour: 19.6,
    horizon: 0xa85a56,
    zenith: 0x27304f,
    sun: 0xd4552e,
    ambient: 0x5a5060,
    sunIntensity: 1.0,
    ambientIntensity: 1.0,
    fog: 0x7a5254,
  },
  {
    hour: 20.6,
    horizon: 0x3a3550,
    zenith: 0x121629,
    sun: 0x6a7096,
    ambient: 0x363a58,
    sunIntensity: 0.4,
    ambientIntensity: 0.62,
    fog: 0x2c2f45,
  },
  {
    hour: 23,
    horizon: 0x1d2038,
    zenith: 0x080a16,
    sun: 0x8f9ec0,
    ambient: 0x232842,
    sunIntensity: 0.3,
    ambientIntensity: 0.5,
    fog: 0x171a2a,
  },
];

/** Resolved lighting values for one moment. */
export interface SkyState {
  horizonColor: THREE.Color;
  zenithColor: THREE.Color;
  sunColor: THREE.Color;
  fogColor: THREE.Color;
  sunDirection: THREE.Vector3;
  sunIntensity: number;
  ambientIntensity: number;
  /** 0..1 night factor. */
  night: number;
}

export class SkySystem {
  readonly dome: THREE.Mesh;
  readonly sunLight: THREE.DirectionalLight;
  readonly ambientLight: THREE.HemisphereLight;
  /** A weak fill from the opposite side, so silhouettes never go pure black. */
  readonly fillLight: THREE.DirectionalLight;

  private material: THREE.ShaderMaterial;
  private geometry: THREE.SphereGeometry;
  private state: SkyState = {
    horizonColor: new THREE.Color(),
    zenithColor: new THREE.Color(),
    sunColor: new THREE.Color(),
    fogColor: new THREE.Color(),
    sunDirection: new THREE.Vector3(0.4, 0.7, 0.3),
    sunIntensity: 2,
    ambientIntensity: 1,
    night: 0,
  };
  private tmpA = new THREE.Color();
  private tmpB = new THREE.Color();
  private sampled = new SampledSky();
  private scratchVec = new THREE.Vector3();

  constructor(scene: THREE.Scene, settings: GraphicsSettings) {
    this.geometry = new THREE.SphereGeometry(1, 32, 16);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uHorizonColor: { value: new THREE.Color(0xbcd6e8) },
        uZenithColor: { value: new THREE.Color(0x4a7fc0) },
        uSunColor: { value: new THREE.Color(0xfff6e0) },
        uSunDirection: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
        uStarStrength: { value: 0 },
        uSunSize: { value: 0.006 },
        uHaze: { value: 0.6 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });

    this.dome = new THREE.Mesh(this.geometry, this.material);
    this.dome.name = 'sky';
    this.dome.frustumCulled = false;
    // Render first, before anything else writes depth.
    this.dome.renderOrder = -1000;
    scene.add(this.dome);

    // --- Lights ----------------------------------------------------------
    this.sunLight = new THREE.DirectionalLight(0xfff6e0, 2);
    this.sunLight.name = 'sun';
    this.configureShadows(settings);
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.ambientLight = new THREE.HemisphereLight(0x9fb8c8, 0x2a3320, 1);
    this.ambientLight.name = 'ambient';
    scene.add(this.ambientLight);

    // Scaled to the same range as the sun (see the note above the sky keys).
    this.fillLight = new THREE.DirectionalLight(0x516b8a, 0.7);
    this.fillLight.position.set(-0.5, 0.4, -0.6);
    scene.add(this.fillLight);
  }

  /** Set up (or tear down) the shadow map according to the graphics preset. */
  configureShadows(settings: GraphicsSettings): void {
    const size = shadowMapSize(settings.shadowQuality);
    if (size === 0) {
      this.sunLight.castShadow = false;
      return;
    }
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(size, size);
    // The shadow frustum follows the camera, so it only needs to cover the area
    // the player can actually see — a map-wide frustum would waste the entire
    // shadow map on terrain nobody is looking at.
    const extent = Math.min(90, settings.viewDistance * 0.45);
    const cam = this.sunLight.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 400;
    cam.updateProjectionMatrix();
    this.sunLight.shadow.bias = -0.0008;
    this.sunLight.shadow.normalBias = 0.035;
    /*
     * Partial shadows, not full ones.
     *
     * The canopy covers nearly the whole map, so a physically correct shadow
     * leaves the rainforest floor lit by the ambient term alone — which renders
     * as near-black and hides the animal behaviour the game is built on reading.
     * Letting 40% of the sun through the shadow keeps the ground as legible
     * dappled shade while still making the sunlit clearings feel exposed, which
     * is what matters tactically.
     */
    this.sunLight.shadow.intensity = 0.6;
  }

  setSettings(settings: GraphicsSettings): void {
    this.configureShadows(settings);
  }

  /**
   * Advance the sky to a given hour and weather.
   *
   * `followPosition` keeps the sky dome and the shadow frustum centred on the
   * player, which is what lets a 620 m world use a 90 m shadow map.
   */
  update(
    hour: number,
    weather: Weather,
    rain: number,
    fog: number,
    followPosition: THREE.Vector3,
    settings: GraphicsSettings,
  ): SkyState {
    const key = this.sampled.sample(hour);

    // --- Sun position ----------------------------------------------------
    // A simple arc: the sun sweeps from high in the west down below the horizon
    // as the round progresses, then the moon takes the same path.
    const dayProgress = clamp01((hour - 6) / 14);
    const elevation = Math.sin(dayProgress * Math.PI) * 1.15 - 0.08;
    const azimuth = lerp(-0.7, 2.6, dayProgress);
    const night = smoothstep(17.8, 20.5, hour);

    this.state.sunDirection.set(
      Math.cos(azimuth) * Math.cos(Math.max(-0.2, elevation)),
      Math.max(night > 0.55 ? 0.35 : -0.12, Math.sin(elevation)),
      Math.sin(azimuth) * Math.cos(Math.max(-0.2, elevation)),
    );
    this.state.sunDirection.normalize();

    // --- Colours ---------------------------------------------------------
    this.state.horizonColor.copy(key.horizon);
    this.state.zenithColor.copy(key.zenith);
    this.state.sunColor.copy(key.sun);
    this.state.fogColor.copy(key.fog);
    this.state.night = night;

    // Weather desaturates and darkens the sky.
    const overcast =
      weather === Weather.Storm ? 0.8 : weather === Weather.Rain ? 0.5 : weather === Weather.Cloudy ? 0.32 : 0;
    if (overcast > 0) {
      const grey = this.tmpA.setRGB(0.34, 0.36, 0.39).multiplyScalar(1 - night * 0.7);
      this.state.horizonColor.lerp(grey, overcast * 0.75);
      this.state.zenithColor.lerp(grey, overcast * 0.85);
      this.state.fogColor.lerp(grey, overcast * 0.7);
    }
    if (weather === Weather.Fog) {
      const fogGrey = this.tmpB.setRGB(0.62, 0.64, 0.6).multiplyScalar(1 - night * 0.72);
      this.state.horizonColor.lerp(fogGrey, 0.8);
      this.state.zenithColor.lerp(fogGrey, 0.55);
      this.state.fogColor.lerp(fogGrey, 0.85);
    }

    // --- Intensities -----------------------------------------------------
    const weatherDim = 1 - overcast * 0.55 - (weather === Weather.Fog ? 0.35 : 0);
    this.state.sunIntensity = key.sunIntensity * Math.max(0.12, weatherDim);
    this.state.ambientIntensity = key.ambientIntensity * Math.max(0.35, 1 - overcast * 0.3);

    // --- Push to the scene ----------------------------------------------
    const u = this.material.uniforms;
    u.uHorizonColor.value.copy(this.state.horizonColor);
    u.uZenithColor.value.copy(this.state.zenithColor);
    u.uSunColor.value.copy(this.state.sunColor);
    u.uSunDirection.value.copy(this.state.sunDirection);
    u.uStarStrength.value = settings.stars ? night * (1 - overcast) * (1 - fog * 0.8) : 0;
    // The moon reads as a smaller, harder disc than the sun.
    u.uSunSize.value = night > 0.55 ? 0.0035 : 0.006;
    u.uHaze.value = 0.4 + fog * 0.5 + rain * 0.2;

    this.sunLight.color.copy(this.state.sunColor);
    this.sunLight.intensity = this.state.sunIntensity;
    this.ambientLight.color.copy(key.ambient);
    this.ambientLight.groundColor.setRGB(0.14, 0.18, 0.1).multiplyScalar(1 - night * 0.6);
    this.ambientLight.intensity = this.state.ambientIntensity;
    this.fillLight.intensity = 0.7 * (1 - night * 0.5);

    // Keep the dome and the shadow frustum with the player.
    this.dome.position.copy(followPosition);
    this.dome.scale.setScalar(Math.max(WORLD_SIZE, settings.viewDistance * 3));

    this.sunLight.target.position.copy(followPosition);
    this.sunLight.position
      .copy(followPosition)
      .add(this.scratchVec.copy(this.state.sunDirection).multiplyScalar(120));

    return this.state;
  }

  get current(): SkyState {
    return this.state;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.dome.removeFromParent();
    this.sunLight.removeFromParent();
    this.ambientLight.removeFromParent();
    this.fillLight.removeFromParent();
  }
}

/**
 * The interpolated colour script at one moment.
 *
 * A single instance is reused every frame — this runs at 60 Hz, so allocating
 * six Color objects per call would be pure garbage-collector load for no gain.
 */
class SampledSky {
  horizon = new THREE.Color();
  zenith = new THREE.Color();
  sun = new THREE.Color();
  ambient = new THREE.Color();
  fog = new THREE.Color();
  sunIntensity = 1;
  ambientIntensity = 1;
  private scratch = new THREE.Color();

  /** Interpolate the script in place. */
  sample(hour: number): this {
    const first = SKY_KEYS[0];
    const last = SKY_KEYS[SKY_KEYS.length - 1];
    const h = Math.max(first.hour, Math.min(last.hour, hour));

    let a = first;
    let b = last;
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      if (h >= SKY_KEYS[i].hour && h <= SKY_KEYS[i + 1].hour) {
        a = SKY_KEYS[i];
        b = SKY_KEYS[i + 1];
        break;
      }
    }
    const t = clamp01((h - a.hour) / (b.hour - a.hour || 1));

    this.blend(this.horizon, a.horizon, b.horizon, t);
    this.blend(this.zenith, a.zenith, b.zenith, t);
    this.blend(this.sun, a.sun, b.sun, t);
    this.blend(this.ambient, a.ambient, b.ambient, t);
    this.blend(this.fog, a.fog, b.fog, t);
    this.sunIntensity = lerp(a.sunIntensity, b.sunIntensity, t);
    this.ambientIntensity = lerp(a.ambientIntensity, b.ambientIntensity, t);
    return this;
  }

  private blend(target: THREE.Color, from: number, to: number, t: number): void {
    target.setHex(from).lerp(this.scratch.setHex(to), t);
  }
}
