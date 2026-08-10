/**
 * TerrainMesh.ts — the visible ground.
 *
 * Built once from the shared Terrain heightfield, with per-vertex colours
 * derived from height, slope and river proximity. Vertex colouring rather than
 * textures keeps the project asset-free while still giving the jungle floor,
 * the mud banks, the sand shoals and the rock faces visibly different surfaces.
 */

import * as THREE from 'three';
import { Terrain } from '../World/Terrain';
import { WATER_LEVEL, WORLD_SIZE } from '../Systems/Config';
import { Noise2D, clamp01, smoothstep } from '../Systems/Noise';

/**
 * Ground palette. Tuned to read as Amazon basin rather than generic grass.
 *
 * These are brighter than a photograph of a rainforest floor would suggest, on
 * purpose. The canopy above casts shadows over almost everything, so a
 * physically dark albedo plus canopy shadow plus dusk leaves the ground reading
 * as pure black. The albedo carries the colour; the lighting supplies the mood.
 */
const COLORS = {
  deepMud: new THREE.Color(0x52401f),
  riverSand: new THREE.Color(0xbba173),
  bank: new THREE.Color(0x8d7748),
  jungleFloor: new THREE.Color(0x4a7038),
  jungleDark: new THREE.Color(0x33501f),
  clearing: new THREE.Color(0x6f9a40),
  rock: new THREE.Color(0x7c7970),
  highland: new THREE.Color(0x577044),
};

export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  private geometry: THREE.PlaneGeometry;
  private material: THREE.MeshLambertMaterial;
  /** Fine noise used only to mottle the vertex colours. */
  private detailNoise: Noise2D;

  constructor(terrain: Terrain, segments: number) {
    // Seeded from the terrain so the mottling matches on every client.
    this.detailNoise = new Noise2D(terrain.seed ^ 0x5eed);
    this.geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
    // PlaneGeometry is built in XY; rotate it into the XZ ground plane.
    this.geometry.rotateX(-Math.PI / 2);

    const position = this.geometry.attributes.position as THREE.BufferAttribute;
    const count = position.count;
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const height = terrain.heightAt(x, z);
      position.setY(i, height);

      // --- Colour by what this bit of ground actually is ------------------
      const river = terrain.riverAt(x, z);
      const foliage = terrain.foliageAt(x, z);
      const slope = terrain.slopeAt(x, z);
      const depth = WATER_LEVEL - height;

      if (depth > 0.4) {
        // River bed: dark silt, lighter in the shallows.
        color.copy(COLORS.riverSand).lerp(COLORS.deepMud, clamp01(depth / 5));
      } else if (depth > -0.6) {
        // The waterline itself: wet sand and mud.
        color.copy(COLORS.riverSand);
      } else {
        // Dry land. Dense canopy floor is dark; clearings are bright.
        color.copy(COLORS.jungleFloor).lerp(COLORS.jungleDark, clamp01(foliage * 1.15));
        if (foliage < 0.3) {
          color.lerp(COLORS.clearing, 1 - clamp01(foliage / 0.3));
        }
        // Riverbanks blend to mud.
        color.lerp(COLORS.bank, clamp01(river * 1.4) * 0.8);
        // High ground dries out.
        color.lerp(COLORS.highland, smoothstep(14, 26, height));
      }

      // Steep faces are bare rock regardless of everything above.
      color.lerp(COLORS.rock, smoothstep(0.5, 0.95, slope));

      /*
       * Mottling.
       *
       * Up to here the ground is a smooth interpolation between a handful of
       * colours, which at close range looks like a painted backdrop — the eye
       * expects a forest floor to be visually noisy. Two octaves of noise, one
       * broad and one fine, break it up into patches of leaf litter and moss for
       * no runtime cost at all: this is baked once into the vertex colours.
       */
      const broad = this.detailNoise.sample(x * 0.06, z * 0.06);
      const fine = this.detailNoise.sample(x * 0.31, z * 0.31);
      const mottle = 1 + broad * 0.1 + fine * 0.055;
      color.multiplyScalar(mottle);
      // Tint the darker patches slightly cooler, the lighter ones warmer, which
      // reads as dappled light rather than as brightness noise.
      if (broad > 0) color.r *= 1 + broad * 0.05;
      else color.b *= 1 - broad * 0.05;

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();

    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      // Flat shading emphasises the terrain's shape, which helps players read
      // slopes and dips they need to hide behind.
      flatShading: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    // The terrain fills the frustum by definition; skip the per-frame test.
    this.mesh.frustumCulled = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
