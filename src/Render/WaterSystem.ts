/**
 * WaterSystem.ts — the rivers.
 *
 * The water matters mechanically: crocodiles own it, capybaras escape into it,
 * and a submerged animal is nearly invisible. So it has to read clearly as
 * *water* — reflective, moving, and with a visible depth gradient so players can
 * judge where it stops being wadeable.
 *
 * Implemented as a custom shader rather than a stock material because it needs
 * three things at once: a fresnel sky reflection, animated surface normals from
 * two crossing wave sets, and a shoreline fade that hides the hard intersection
 * with the terrain. On the LOW preset the whole thing collapses to a flat
 * translucent plane.
 */

import * as THREE from 'three';
import { WATER_LEVEL, WORLD_SIZE } from '../Systems/Config';
import type { GraphicsSettings } from '../Graphics/QualitySettings';

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uWaveScale;
  varying vec2 vWorldXZ;
  varying vec3 vWorldPos;
  varying float vWave;

  // Three's own fog plumbing. A custom ShaderMaterial does not get it for free,
  // which is exactly how the water ended up as the only unfogged surface in the
  // game — see the note in the fragment shader.
  #include <fog_pars_vertex>

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldXZ = world.xz;
    vWorldPos = world.xyz;

    // Two crossing wave trains, plus a slow swell. Cheap, and enough to make
    // the surface read as flowing rather than sloshing in place.
    float w1 = sin(world.x * 0.19 + uTime * 1.10) * 0.055;
    float w2 = sin(world.z * 0.25 - uTime * 0.85) * 0.045;
    float swell = sin((world.x + world.z) * 0.045 + uTime * 0.35) * 0.075;
    float wave = (w1 + w2 + swell) * uWaveScale;
    vWave = wave;

    world.y += wave;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform vec3 uCameraPos;
  uniform float uTime;
  uniform float uReflectivity;
  uniform float uOpacity;
  uniform float uRain;
  uniform sampler2D uDepthMap;
  uniform float uWorldSize;
  uniform float uUnderwater;

  varying vec2 vWorldXZ;
  varying vec3 vWorldPos;
  varying float vWave;

  /*
   * Fog.
   *
   * A ShaderMaterial gets none of three's standard plumbing unless it asks, and
   * for a long time this one did not ask. The consequence only showed up in fog
   * weather, and it was severe: every other surface in the game faded into the
   * fog colour while the river stayed perfectly crisp, so the water read as a
   * flat white sheet laid over a grey world. A river is not less atmospheric than
   * the ground next to it.
   */
  #include <fog_pars_fragment>

  /*
   * Reconstruct a surface normal analytically — no normal map, no texture fetch.
   *
   * The vertex shader only displaces three long, smooth wave trains, because that
   * is all the mesh has the resolution to carry. The *normal* is not limited by
   * mesh resolution, so it gets four extra octaves of much finer ripple on top:
   * detail the surface does not actually have geometrically, but which is what the
   * eye reads as water rather than as a tilted sheet. Cross-hatched at
   * non-parallel angles and at frequencies that are not multiples of each other,
   * so the pattern never visibly tiles.
   */
  vec3 waveNormal(vec2 p, float detail) {
    float dx = cos(p.x * 0.19 + uTime * 1.10) * 0.19 * 0.055
             + cos((p.x + p.y) * 0.045 + uTime * 0.35) * 0.045 * 0.075;
    float dz = cos(p.y * 0.25 - uTime * 0.85) * 0.25 * -0.045
             + cos((p.x + p.y) * 0.045 + uTime * 0.35) * 0.045 * 0.075;

    /*
     * Fine chop, faded out with distance by 'detail'.
     *
     * The fade is not an optimisation, it is the fix for a real artefact. A ripple
     * with a wavelength under a metre covers less than a pixel once the water is
     * thirty metres away, so the shader samples it essentially at random from one
     * pixel to the next — and with a sharp specular lobe on top, "slightly
     * different normal" means "wildly different brightness". The result was a
     * shimmering cross-hatch across the whole river, which is aliasing: detail
     * finer than the pixel grid can resolve. Mip-mapping solves this for textures;
     * for procedural normals you have to fade the octaves out by hand.
     *
     * Amplitudes also fall off as frequency rises, which is what keeps the sum
     * looking like water rather than corrugated iron.
     */
    dx += cos(p.x * 1.31 + p.y * 0.42 + uTime * 2.3) * 0.020 * detail;
    dz += cos(p.y * 1.19 - p.x * 0.37 - uTime * 2.1) * 0.020 * detail;
    dx += cos(p.x * 2.87 - p.y * 1.13 + uTime * 3.7) * 0.011 * detail * detail;
    dz += cos(p.y * 3.11 + p.x * 0.91 - uTime * 3.3) * 0.011 * detail * detail;

    // Ripples from rain, which visibly roughen the surface during a storm.
    float r = uRain * 0.35 * detail;
    dx += sin(p.x * 5.0 + uTime * 9.0) * r * 0.02;
    dz += sin(p.y * 5.3 - uTime * 8.0) * r * 0.02;
    return normalize(vec3(-dx * 6.0, 1.0, -dz * 6.0));
  }

  void main() {
    /*
     * Water depth comes from a baked texture of the terrain heightfield, so the
     * shader knows where the shallows are without any CPU work per frame.
     *
     * The texture stores ground height normalised over a 7 m band centred on the
     * water line, so the water line itself sits at 1/7 of the range, not at
     * zero. Getting that wrong is not subtle: the water plane spans the entire
     * map, so treating dry land as "zero depth" drew a 35%-opacity white sheet
     * over the whole world and washed every scene out to grey.
     */
    vec2 uv = vWorldXZ / uWorldSize + 0.5;
    float ground = texture2D(uDepthMap, uv).r;
    // Metres of water above the ground. Negative on dry land.
    float depthM = ((1.0 - ground) - 0.142857) * 7.0;
    // Anywhere the terrain rises above the water line, there is simply no water.
    if (depthM <= 0.0) discard;

    // How much fine surface detail this pixel can actually resolve.
    float camDist = length(uCameraPos - vWorldPos);
    float detail = 1.0 - smoothstep(10.0, 48.0, camDist);

    vec3 normal = waveNormal(vWorldXZ, detail);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);

    /*
     * Seen from below, the surface is a different thing entirely.
     *
     * Looking up from under water you do not see a translucent sheet with the
     * river bed behind it — you see a bright, rippling ceiling, mostly total
     * internal reflection with a lighter disc overhead (Snell's window). Running
     * the normal above-water path from underneath produces a murky grey film that
     * reads as a bug, so this takes its own branch and returns early.
     */
    if (uUnderwater > 0.5) {
      // How steeply we are looking at the surface. Straight up = 1.
      float up = clamp(abs(viewDir.y), 0.0, 1.0);
      // Snell's window: the world above is only visible within a cone. Outside
      // it the surface mirrors the dark water back down at you.
      float window = smoothstep(0.32, 0.78, up);
      vec3 mirrored = uDeepColor * 1.15;
      vec3 through = mix(uShallowColor, uSkyColor, 0.72);
      vec3 under = mix(mirrored, through, window);
      // Wave crests catch the light from underneath as bright rippling bands.
      float shimmer = pow(max(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0), 28.0);
      under += uSunColor * shimmer * 0.5 * window;
      gl_FragColor = vec4(under, 0.92);
      #include <fog_fragment>
      #include <colorspace_fragment>
      return;
    }

    // Fresnel: glancing angles reflect the sky, steep angles show the bottom.
    float fresnel = pow(1.0 - clamp(dot(viewDir, normal), 0.0, 1.0), 3.0);
    fresnel = mix(0.04, 1.0, fresnel) * uReflectivity;

    // Depth-graded body colour: silty green in the shallows, near-black deep.
    vec3 body = mix(uShallowColor, uDeepColor, clamp(depthM / 3.5, 0.0, 1.0));

    /*
     * Sky reflection, plus two specular lobes rather than one.
     *
     * A single tight highlight gives you one bright spot on the water and nothing
     * else. Real water has a *glitter path*: a broad sheen stretching away towards
     * the sun, speckled with individual sparks where a wavelet happens to face it
     * exactly. The tight lobe is the sparks, the broad one is the sheen, and the
     * fine ripple octaves in waveNormal are what make the sparks land in different
     * places from frame to frame instead of sitting still.
     */
    vec3 halfway = normalize(uSunDirection + viewDir);
    float ndh = max(dot(normal, halfway), 0.0);
    /*
     * The tight lobe is faded with the same 'detail' term as the ripples that
     * feed it. An exponent this high turns a hair of normal variation into a
     * blown-out spark, so leaving it at full strength out at the horizon puts
     * the aliasing straight back even with the ripples faded.
     */
    float sparkle = pow(ndh, 120.0) * 2.2 * detail;
    float sheen = pow(ndh, 18.0) * 0.55;
    vec3 reflection = uSkyColor + uSunColor * (sparkle + sheen);

    vec3 color = mix(body, reflection, fresnel);

    /*
     * Silt.
     *
     * A slow, large-scale brightness drift across the surface, tied to world
     * position rather than to the waves. An Amazon tributary is loaded with
     * sediment and is visibly not one uniform colour; without this the river reads
     * as a flat plane of paint no matter how good the highlights are.
     */
    float silt = sin(vWorldXZ.x * 0.031 + uTime * 0.06) * sin(vWorldXZ.y * 0.027 - uTime * 0.045);
    color *= 1.0 + silt * 0.13;

    /*
     * Foam on the crests, and a wet band in the last half metre of shallows.
     *
     * Both kept deliberately weak. The wave amplitude is around fifteen
     * centimetres and the swell is smooth over tens of metres, so a low crest
     * threshold does not pick out crests — it whitens roughly a third of the
     * river at once, and the result is a milky sheet rather than water.
     */
    float crest = smoothstep(0.10, 0.16, vWave);
    float shore = 1.0 - smoothstep(0.0, 0.5, depthM);
    color += vec3(0.26) * crest * 0.3;
    color = mix(color, vec3(0.58, 0.59, 0.52), shore * 0.32);

    // Shallow water is nearly clear; deep water hides what is under it.
    float alpha = uOpacity * (0.3 + 0.7 * clamp(depthM / 1.2, 0.0, 1.0));
    alpha = mix(alpha, 1.0, fresnel * 0.5);
    // Feather the very edge so the plane never shows a hard outline.
    alpha *= smoothstep(0.0, 0.12, depthM);

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));

    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

export class WaterSystem {
  readonly mesh: THREE.Mesh;
  private geometry: THREE.PlaneGeometry;
  private material: THREE.ShaderMaterial;
  private simpleMaterial: THREE.MeshLambertMaterial;
  private depthTexture: THREE.DataTexture;
  private quality: GraphicsSettings['waterQuality'];

  constructor(depthMap: THREE.DataTexture, settings: GraphicsSettings) {
    this.depthTexture = depthMap;
    this.quality = settings.waterQuality;

    // Segment count only matters for the vertex wave displacement.
    const segments = settings.waterQuality === 'high' ? 160 : settings.waterQuality === 'medium' ? 96 : 1;
    this.geometry = new THREE.PlaneGeometry(WORLD_SIZE * 1.15, WORLD_SIZE * 1.15, segments, segments);
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      // `fog: true` is what makes three inject the fog uniforms and defines that
      // the #include chunks above depend on.
      fog: true,
      uniforms: {
        /*
         * Spread three's fog uniforms in rather than using UniformsUtils.merge.
         * Merge deep-clones every value, and `cloneUniforms` clones textures too —
         * which would silently duplicate the water depth map onto the GPU and
         * leave `dispose()` releasing the original while the clone leaked.
         */
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: { value: 0 },
        uWaveScale: { value: settings.waterQuality === 'low' ? 0 : 1 },
        uShallowColor: { value: new THREE.Color(0x3f5738) },
        uDeepColor: { value: new THREE.Color(0x0b1a16) },
        uSkyColor: { value: new THREE.Color(0x88a7c4) },
        uSunColor: { value: new THREE.Color(0xffe8c0) },
        uSunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
        uCameraPos: { value: new THREE.Vector3() },
        // Below 1: a fully reflective surface turns the whole mid-distance of
        // the river into sky colour, which reads as milk rather than as water.
        uReflectivity: { value: settings.waterQuality === 'high' ? 0.72 : 0.55 },
        uOpacity: { value: 0.9 },
        uRain: { value: 0 },
        uDepthMap: { value: depthMap },
        uWorldSize: { value: WORLD_SIZE },
        uUnderwater: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // The LOW preset swaps in a plain material: no per-pixel maths at all.
    this.simpleMaterial = new THREE.MeshLambertMaterial({
      color: 0x2f4f45,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(
      this.geometry,
      settings.waterQuality === 'low' ? this.simpleMaterial : this.material,
    );
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.name = 'water';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Update the shader's view of the world each frame. */
  update(
    time: number,
    cameraPos: THREE.Vector3,
    sunDirection: THREE.Vector3,
    skyColor: THREE.Color,
    sunColor: THREE.Color,
    rain: number,
    waterLevel: number,
    underwater: boolean,
  ): void {
    this.mesh.position.y = waterLevel;
    if (this.mesh.material === this.simpleMaterial) return;
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uCameraPos.value.copy(cameraPos);
    u.uSunDirection.value.copy(sunDirection);
    u.uSkyColor.value.copy(skyColor);
    u.uSunColor.value.copy(sunColor);
    u.uRain.value = rain;
    u.uUnderwater.value = underwater ? 1 : 0;
  }

  setSettings(settings: GraphicsSettings): void {
    if (settings.waterQuality === this.quality) return;
    this.quality = settings.waterQuality;
    this.mesh.material = settings.waterQuality === 'low' ? this.simpleMaterial : this.material;
    this.material.uniforms.uWaveScale.value = settings.waterQuality === 'low' ? 0 : 1;
    this.material.uniforms.uReflectivity.value = settings.waterQuality === 'high' ? 0.72 : 0.55;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.simpleMaterial.dispose();
    this.depthTexture.dispose();
    this.mesh.removeFromParent();
  }
}

/**
 * Bake the terrain height into a texture the water shader can sample.
 *
 * Stored as "how far above the water line is the ground", normalised so 1 means
 * dry land and 0 means deep water.
 */
export function buildWaterDepthTexture(
  heightAt: (x: number, z: number) => number,
  resolution = 256,
): THREE.DataTexture {
  const data = new Uint8Array(resolution * resolution * 4);
  const half = WORLD_SIZE / 2;
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const x = -half + (i / (resolution - 1)) * WORLD_SIZE;
      const z = -half + (j / (resolution - 1)) * WORLD_SIZE;
      const h = heightAt(x, z);
      // Map [WATER_LEVEL - 6, WATER_LEVEL + 1] onto [0, 255].
      const normalised = (h - (WATER_LEVEL - 6)) / 7;
      const v = Math.max(0, Math.min(255, Math.round(normalised * 255)));
      const idx = (j * resolution + i) * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
