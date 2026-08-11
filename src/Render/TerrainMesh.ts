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
  riverSand: new THREE.Color(0x9c8760),
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
  private detailTexture: THREE.Texture;
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

    /*
     * A tiling detail texture, on top of the vertex colours.
     *
     * The vertex colours give the ground its large-scale story — mud here, sand
     * at the waterline, bright clearing over there — but they are sampled per
     * mesh vertex, which at this world size is every three or four metres. Between
     * those samples the surface is a perfectly smooth gradient, and a smooth
     * gradient is exactly what makes a procedural landscape look like a painted
     * backdrop rather than ground: real forest floor is visually noisy at the
     * centimetre scale, and the eye checks.
     *
     * `map` multiplies the vertex colour in three's Lambert shader, so a texture
     * averaging 1.0 modulates the existing palette rather than replacing it, and
     * the whole thing costs one 128² texture and one fetch per pixel.
     */
    this.detailTexture = buildGroundDetailTexture(terrain.seed);
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: this.detailTexture,
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
    this.detailTexture.dispose();
    this.mesh.removeFromParent();
  }
}

/**
 * How many metres one tile of the detail texture covers.
 *
 * This was 7, and at 7 the texture was doing nothing at all — which is worth
 * recording, because it looked like a working feature. A 128² tile over 7 m is
 * 5.5 cm per texel, so every octave in it has a wavelength somewhere between a
 * few centimetres and nine; all of that is below a pixel by the time the surface
 * is more than a couple of metres away, the mip chain averages it to a flat 1.0,
 * and the ground goes back to being the smooth painted plane the texture exists
 * to break up. Detail you cannot resolve is not detail.
 *
 * At 26 m the same three octaves land on 3.2 m patches, 1.1 m mottling and 40 cm
 * grain — scales the eye can actually see across a clearing — and the texel is a
 * legible 20 cm. The cost of the larger tile is that the repeat is in principle
 * visible, but the vertex colours carry all the large-scale variation and the
 * ground is under grass almost everywhere, so in practice it is not.
 */
const DETAIL_TILE_METRES = 26;

/**
 * Build the tiling ground-detail texture.
 *
 * Value noise at three octaves, wrapped so the tile is seamless: each octave
 * indexes its lattice modulo the octave's own period, which is what makes the
 * left edge continue into the right edge instead of showing a seam every seven
 * metres.
 *
 * The output is a *multiplier*, centred on 1.0, with a slight warm/cool split so
 * the darker specks read as damp leaf litter and the lighter ones as dry debris
 * rather than as brightness noise. Its colour space is explicitly linear: this
 * is not an image, it is a number per pixel, and letting three sRGB-decode it
 * would bend the midpoint away from 1.0 and darken every surface it touches.
 */
function buildGroundDetailTexture(seed: number): THREE.Texture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);

  // A hash keyed on the seed, so two worlds do not share the same litter.
  const hash = (x: number, y: number): number => {
    const n = Math.sin((x * 127.1 + y * 311.7 + seed * 0.017) * 1.0) * 43758.5453;
    return n - Math.floor(n);
  };

  const octave = (u: number, v: number, period: number): number => {
    const x = u * period;
    const y = v * period;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = x - xi;
    const ty = y - yi;
    // Smoothstep the interpolation so the lattice does not show as a grid.
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    // Modulo the period: this is what makes the tile seamless.
    const wrap = (i: number) => ((i % period) + period) % period;
    const a = hash(wrap(xi), wrap(yi));
    const b = hash(wrap(xi + 1), wrap(yi));
    const c = hash(wrap(xi), wrap(yi + 1));
    const d = hash(wrap(xi + 1), wrap(yi + 1));
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      // Three octaves: patches, mottling, and fine grain. Weighted towards the
      // broad octave, since that is the one that survives to a distance — the
      // fine grain is a close-range accent, not the structure.
      const n = octave(u, v, 6) * 0.56 + octave(u, v, 18) * 0.29 + octave(u, v, 52) * 0.15;
      // Centre on 1.0 with about ±26% swing.
      const value = 1 + (n - 0.5) * 0.82;
      const warm = (octave(u, v, 10) - 0.5) * 0.22;
      const idx = (j * size + i) * 4;
      const clamp255 = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
      data[idx] = clamp255(value + warm);
      data[idx + 1] = clamp255(value);
      data[idx + 2] = clamp255(value - warm * 0.7);
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  // PlaneGeometry's UVs run 0..1 across the whole world, so the repeat count is
  // how many tiles fit along one edge.
  const tiles = WORLD_SIZE / DETAIL_TILE_METRES;
  texture.repeat.set(tiles, tiles);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
