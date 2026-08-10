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
    gl_Position = projectionMatrix * viewMatrix * world;
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

  varying vec2 vWorldXZ;
  varying vec3 vWorldPos;
  varying float vWave;

  // Reconstruct a surface normal from the same wave functions as the vertex
  // shader, analytically — no normal map, no extra texture fetch.
  vec3 waveNormal(vec2 p) {
    float dx = cos(p.x * 0.19 + uTime * 1.10) * 0.19 * 0.055
             + cos((p.x + p.y) * 0.045 + uTime * 0.35) * 0.045 * 0.075;
    float dz = cos(p.y * 0.25 - uTime * 0.85) * 0.25 * -0.045
             + cos((p.x + p.y) * 0.045 + uTime * 0.35) * 0.045 * 0.075;
    // Ripples from rain, which visibly roughen the surface during a storm.
    float r = uRain * 0.35;
    dx += sin(p.x * 5.0 + uTime * 9.0) * r * 0.02;
    dz += sin(p.y * 5.3 - uTime * 8.0) * r * 0.02;
    return normalize(vec3(-dx * 6.0, 1.0, -dz * 6.0));
  }

  void main() {
    // Water depth comes from a baked texture of the terrain heightfield, so the
    // shader knows where the shallows are without any CPU work per frame.
    vec2 uv = vWorldXZ / uWorldSize + 0.5;
    float ground = texture2D(uDepthMap, uv).r;
    float depth = max(0.0, 1.0 - ground);

    vec3 normal = waveNormal(vWorldXZ);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);

    // Fresnel: glancing angles reflect the sky, steep angles show the bottom.
    float fresnel = pow(1.0 - clamp(dot(viewDir, normal), 0.0, 1.0), 3.0);
    fresnel = mix(0.04, 1.0, fresnel) * uReflectivity;

    // Depth-graded body colour.
    vec3 body = mix(uShallowColor, uDeepColor, clamp(depth * 3.2, 0.0, 1.0));

    // Sky reflection plus a specular sun glint on the wave crests.
    vec3 halfway = normalize(uSunDirection + viewDir);
    float spec = pow(max(dot(normal, halfway), 0.0), 90.0);
    vec3 reflection = uSkyColor + uSunColor * spec * 2.2;

    vec3 color = mix(body, reflection, fresnel);

    // Foam on the crests, and along the shoreline where depth goes to zero.
    float crest = smoothstep(0.05, 0.11, vWave);
    float shore = 1.0 - smoothstep(0.0, 0.16, depth);
    color += vec3(0.32) * crest * 0.5;
    color = mix(color, vec3(0.72, 0.74, 0.66), shore * 0.35);

    // Fade out at the very edge so the plane never shows a hard border.
    float alpha = uOpacity * (0.35 + 0.65 * clamp(depth * 5.0, 0.0, 1.0));
    alpha = mix(alpha, 1.0, fresnel * 0.5);

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));

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
      uniforms: {
        uTime: { value: 0 },
        uWaveScale: { value: settings.waterQuality === 'low' ? 0 : 1 },
        uShallowColor: { value: new THREE.Color(0x4b6b4a) },
        uDeepColor: { value: new THREE.Color(0x10251f) },
        uSkyColor: { value: new THREE.Color(0x88a7c4) },
        uSunColor: { value: new THREE.Color(0xffe8c0) },
        uSunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
        uCameraPos: { value: new THREE.Vector3() },
        uReflectivity: { value: settings.waterQuality === 'high' ? 1 : 0.7 },
        uOpacity: { value: 0.9 },
        uRain: { value: 0 },
        uDepthMap: { value: depthMap },
        uWorldSize: { value: WORLD_SIZE },
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
  }

  setSettings(settings: GraphicsSettings): void {
    if (settings.waterQuality === this.quality) return;
    this.quality = settings.waterQuality;
    this.mesh.material = settings.waterQuality === 'low' ? this.simpleMaterial : this.material;
    this.material.uniforms.uWaveScale.value = settings.waterQuality === 'low' ? 0 : 1;
    this.material.uniforms.uReflectivity.value = settings.waterQuality === 'high' ? 1 : 0.7;
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
