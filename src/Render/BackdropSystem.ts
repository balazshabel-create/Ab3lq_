/**
 * BackdropSystem.ts — everything past the edge of the world.
 *
 * The playable heightfield is a kilometre across. That is a big jungle, but a
 * kilometre still *ends*, and standing at the boundary looking outwards used to
 * show the terrain stop dead against the fog. The Amazon does not do that. It
 * goes on for two thousand kilometres and then hits the Andes.
 *
 * So this draws three things, none of them simulated and none of them
 * interactive:
 *
 *   1. **Distant ground** — a radial mesh continuing outwards from the world
 *      edge, rolling for a while and then rising into a ring of mountains that
 *      closes off the basin.
 *   2. **A canopy shell** — a bumpy surface floating at treetop height over the
 *      near part of that ground, which is what an unbroken rainforest canopy
 *      looks like from a distance. Far cheaper than trees, and more convincing:
 *      at two kilometres you cannot resolve individual crowns anyway.
 *   3. **Silhouette trees** — actual (very cheap) instanced trees for the first
 *      few hundred metres past the boundary, where individual crowns still read
 *      and a smooth shell would look like a green tarpaulin.
 *
 * ## Why this needs its own shader
 *
 * The scene's fog is exponential and tuned for a jungle you can hide in — at the
 * view distance it is fully opaque. Anything four kilometres away is therefore
 * *infinitely* fogged and would render as a flat wall of fog colour.
 *
 * The fix is not to weaken the fog, which would ruin the near field. It is to
 * take the backdrop out of the fog entirely and give it its own aerial
 * perspective: a per-fragment blend towards the horizon colour based on real
 * camera distance, over a range measured in kilometres rather than metres. That
 * is how a matte painting handles it, and the horizon colour comes from the sky
 * system, so the mountains go orange at sunset and blue-black at night for free.
 */

import * as THREE from 'three';
import { Noise2D, clamp01, lerp, smoothstep } from '../Systems/Noise';
import { Rng } from '../Systems/Rng';
import {
  BACKDROP_MOUNTAIN_HEIGHT,
  BACKDROP_RADIUS,
  BACKDROP_TREES,
  TERRAIN_HEIGHT,
  WORLD_SIZE,
} from '../Systems/Config';
import type { Terrain } from '../World/Terrain';
import type { GraphicsSettings } from '../Graphics/QualitySettings';

/** Where the backdrop starts: just inside the world edge, so the seam is hidden. */
const INNER_RADIUS = (WORLD_SIZE / 2) * 0.9;

/** How far out the canopy shell reaches before bare mountain takes over. */
const CANOPY_OUTER = 2100;

/** Silhouette trees live in this band past the boundary. */
const TREE_BAND_OUTER = INNER_RADIUS + 420;

/** Sectors the silhouette trees are bucketed into, for frustum culling. */
const TREE_SECTORS = 16;

/**
 * Aerial perspective, in metres.
 *
 * The tricky part is *continuity*. The near field is hazed by the scene's
 * exponential fog and the backdrop is not, so if the two do not agree at the
 * seam there is a visible line in the air where one atmosphere stops and another
 * starts — the backdrop pops out unnaturally crisp behind a fogged mid-distance.
 *
 * So the backdrop starts already partly hazed (`HAZE_BASE`, roughly matching what
 * the scene fog has accumulated by the time it reaches the world edge) and ramps
 * the rest of the way over kilometres. It saturates short of full, so the
 * mountain ridgeline still reads as a shape rather than dissolving completely.
 */
const HAZE_BASE = 0.42;
const HAZE_NEAR = 500;
const HAZE_FAR = 3200;

/** Colours, sampled by altitude and distance when the mesh is built. */
const COLOUR_JUNGLE_NEAR = new THREE.Color(0x2e5326);
const COLOUR_JUNGLE_FAR = new THREE.Color(0x35563a);
/*
 * Deliberately dark. A distant range is a *silhouette* — it reads as
 * far away precisely because it is dimmer and less saturated than everything in
 * front of it. Rock light enough to look like rock up close ends up brighter
 * than the sky behind it, which reads as a rendering fault rather than as
 * mountains.
 */
const COLOUR_ROCK = new THREE.Color(0x3f4550);
const COLOUR_PEAK = new THREE.Color(0x5d6472);

const backdropVertexShader = /* glsl */ `
  attribute vec3 tint;
  varying vec3 vTint;
  varying vec3 vNormalW;
  varying float vHaze;
  uniform float uHazeNear;
  uniform float uHazeFar;
  uniform float uHazeBase;
  void main() {
    vTint = tint;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    // Aerial perspective from real camera distance, not from the origin: the
    // player can be five hundred metres off-centre and the ridgeline nearest
    // them should be the least hazy part of it.
    float d = length(world.xyz - cameraPosition);
    vHaze = uHazeBase + (1.0 - uHazeBase) * smoothstep(uHazeNear, uHazeFar, d);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const backdropFragmentShader = /* glsl */ `
  varying vec3 vTint;
  varying vec3 vNormalW;
  varying float vHaze;
  uniform vec3 uHaze;
  uniform vec3 uLight;
  uniform vec3 uSunDir;
  uniform float uMaxHaze;
  void main() {
    // A single wrapped lambert term. No shadows, no specular: at this distance
    // the only lighting cue that matters is which side of the ridge faces the
    // sun, and that is exactly what this gives.
    float ndl = dot(normalize(vNormalW), normalize(uSunDir));
    float lambert = 0.42 + 0.58 * max(ndl * 0.5 + 0.5, 0.0);
    vec3 lit = vTint * lambert * uLight;
    gl_FragColor = vec4(mix(lit, uHaze, vHaze * uMaxHaze), 1.0);
  }
`;

interface TreeSector {
  mesh: THREE.InstancedMesh;
  /** Sector mid-angle, for a cheap "is it behind me" test. */
  angle: number;
}

export class BackdropSystem {
  private group = new THREE.Group();
  private material: THREE.ShaderMaterial;
  private ground: THREE.Mesh | null = null;
  private canopy: THREE.Mesh | null = null;
  private treeSectors: TreeSector[] = [];
  private treeGeometry: THREE.BufferGeometry | null = null;

  private readonly terrain: Terrain;
  private readonly relief: Noise2D;
  private readonly ridge: Noise2D;
  private readonly canopyNoise: Noise2D;
  private settings: GraphicsSettings;

  constructor(scene: THREE.Scene, terrain: Terrain, settings: GraphicsSettings) {
    this.terrain = terrain;
    this.settings = settings;
    this.relief = new Noise2D(terrain.seed ^ 0x5151);
    this.ridge = new Noise2D(terrain.seed ^ 0x6262);
    this.canopyNoise = new Noise2D(terrain.seed ^ 0x7373);

    this.material = new THREE.ShaderMaterial({
      vertexShader: backdropVertexShader,
      fragmentShader: backdropFragmentShader,
      uniforms: {
        uHaze: { value: new THREE.Color(0xb8cfe0) },
        uLight: { value: new THREE.Color(1, 1, 1) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
        uHazeNear: { value: HAZE_NEAR },
        uHazeFar: { value: HAZE_FAR },
        uHazeBase: { value: HAZE_BASE },
        uMaxHaze: { value: 0.86 },
      },
      // Explicitly out of the scene's fog: see the header. Also no depth write
      // concerns — this is real geometry at real depth, so it occludes correctly.
      fog: false,
      side: THREE.FrontSide,
    });

    this.group.name = 'backdrop';
    scene.add(this.group);
    this.build();
  }

  // -------------------------------------------------------------------------
  // The height function
  // -------------------------------------------------------------------------

  /**
   * Ground height out in the backdrop.
   *
   * Three bands blended together:
   *  • at the inner edge it matches the real terrain's rim so the seam does not
   *    show as a step;
   *  • then rolling forested relief;
   *  • then a ridged mountain range, which is what "closes off the jungle".
   *
   * Ridged noise (1 - |noise|) is used for the mountains specifically because it
   * produces sharp crests and smooth valleys, which is what a mountain range
   * looks like — plain fbm gives rounded lumps that read as hills.
   */
  private heightAt(x: number, z: number): number {
    const r = Math.hypot(x, z);
    const t = clamp01((r - INNER_RADIUS) / (BACKDROP_RADIUS - INNER_RADIUS));

    // Rolling relief, in the same vertical register as the playable terrain so
    // the join looks like more of the same country.
    const n = this.relief.fbm(x / 2400, z / 2400, 4) * 0.5 + 0.5;
    let h = n * TERRAIN_HEIGHT * 2.4 + 6;

    // Mountains, rising through the outer half.
    const mountainT = smoothstep(0.34, 0.98, t);
    if (mountainT > 0) {
      const ridged = this.ridge.ridged(x / 3000 + 3.1, z / 3000 - 1.7, 4);
      // A second, coarser band so the range has foothills and true peaks rather
      // than one wall of identical teeth.
      const massif = this.relief.fbm(x / 6400 + 9, z / 6400 - 5, 2) * 0.5 + 0.5;
      const peak = Math.pow(ridged, 1.35) * (0.45 + massif * 0.9);
      h += peak * BACKDROP_MOUNTAIN_HEIGHT * mountainT;
    }

    // Match the playable rim at the seam.
    const seam = smoothstep(0, 0.055, t);
    const rimHeight = this.terrain.heightAt(
      (x / Math.max(1, r)) * INNER_RADIUS,
      (z / Math.max(1, r)) * INNER_RADIUS,
    );
    return lerp(rimHeight, h, seam);
  }

  // -------------------------------------------------------------------------
  // Building
  // -------------------------------------------------------------------------

  private build(): void {
    this.teardown();
    const detail = this.settings.foliageQuality;
    const coarse = detail === 'low' || detail === 'off';
    const sectors = coarse ? 80 : detail === 'medium' ? 112 : 144;
    const rings = coarse ? 26 : detail === 'medium' ? 34 : 44;

    this.ground = new THREE.Mesh(this.buildGround(sectors, rings), this.material);
    this.ground.name = 'backdrop-ground';
    // Never culled: it is a ring around the camera, so its bounding sphere
    // always intersects the frustum anyway, and computing it is pure cost.
    this.ground.frustumCulled = false;
    this.group.add(this.ground);

    this.canopy = new THREE.Mesh(this.buildCanopy(sectors, Math.round(rings * 0.6)), this.material);
    this.canopy.name = 'backdrop-canopy';
    this.canopy.frustumCulled = false;
    this.group.add(this.canopy);

    this.buildSilhouetteTrees();
  }

  /**
   * The distant ground, as a radial grid.
   *
   * Rings are distributed by a power law, so resolution is concentrated near the
   * boundary where the player can actually see detail and thins out towards the
   * mountains where four hundred metres is one pixel.
   */
  private buildGround(sectors: number, rings: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const tints: number[] = [];
    const indices: number[] = [];
    const colour = new THREE.Color();

    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const r = INNER_RADIUS + (BACKDROP_RADIUS - INNER_RADIUS) * Math.pow(t, 2.1);
      for (let i = 0; i <= sectors; i++) {
        const a = (i / sectors) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = this.heightAt(x, z);
        positions.push(x, y, z);

        /*
         * Colour by altitude, with distance pushing green towards the cooler
         * far-forest tone. The rock/peak transition is what makes the mountains
         * read as mountains rather than as very large green hills.
         */
        const altitude = clamp01((y - TERRAIN_HEIGHT * 1.6) / (BACKDROP_MOUNTAIN_HEIGHT * 0.62));
        colour.copy(COLOUR_JUNGLE_NEAR).lerp(COLOUR_JUNGLE_FAR, clamp01(t * 1.6));
        if (altitude > 0) {
          colour.lerp(COLOUR_ROCK, smoothstep(0.05, 0.55, altitude));
          colour.lerp(COLOUR_PEAK, smoothstep(0.62, 1, altitude));
        }
        tints.push(colour.r, colour.g, colour.b);
      }
    }

    const stride = sectors + 1;
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < sectors; i++) {
        const a = j * stride + i;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    return finishGeometry(positions, tints, indices);
  }

  /**
   * The canopy shell.
   *
   * A second surface floating one tree-height above the ground, displaced by
   * noise so its silhouette is lumpy. Fades out (by being pulled down into the
   * ground) as the mountains take over, so there is no canopy on the peaks.
   */
  private buildCanopy(sectors: number, rings: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const tints: number[] = [];
    const indices: number[] = [];
    const colour = new THREE.Color();

    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const r = INNER_RADIUS + (CANOPY_OUTER - INNER_RADIUS) * Math.pow(t, 1.7);
      for (let i = 0; i <= sectors; i++) {
        const a = (i / sectors) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const ground = this.heightAt(x, z);

        // Crown height: full canopy near the boundary, thinning as altitude and
        // distance rise, so the shell tucks itself away rather than ending.
        const bumps = this.canopyNoise.fbm(x / 130, z / 130, 3) * 0.5 + 0.5;
        const coarse = this.canopyNoise.fbm(x / 520 + 4, z / 520 + 8, 2) * 0.5 + 0.5;
        const altitudeFade = 1 - smoothstep(TERRAIN_HEIGHT * 2.2, TERRAIN_HEIGHT * 5.5, ground);
        const distanceFade = 1 - smoothstep(0.72, 1, t);
        const crown = (11 + bumps * 13 + coarse * 9) * altitudeFade * distanceFade;

        positions.push(x, ground + crown, z);
        // Brighter than the ground beneath it, and warmer where it is lit.
        colour
          .copy(COLOUR_JUNGLE_NEAR)
          .lerp(COLOUR_JUNGLE_FAR, clamp01(t * 1.3))
          .multiplyScalar(0.9 + bumps * 0.35);
        tints.push(colour.r, colour.g, colour.b);
      }
    }

    const stride = sectors + 1;
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < sectors; i++) {
        const a = j * stride + i;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    return finishGeometry(positions, tints, indices);
  }

  /**
   * Individual trees for the band immediately past the boundary.
   *
   * Bucketed into angular sectors so frustum culling works — one InstancedMesh
   * for the whole ring would have a bounding sphere covering the camera and
   * would never be culled, which is the same trap the main foliage renderer
   * chunks around.
   */
  private buildSilhouetteTrees(): void {
    // foliageQuality is a LevelSetting, which also has an 'off' state that this
    // table has no entry for — fall back to the low count rather than crashing.
    const count = BACKDROP_TREES[this.settings.foliageQuality as 'low' | 'medium' | 'high'] ??
      BACKDROP_TREES.low;
    if (count <= 0) return;

    this.treeGeometry = buildSilhouetteTreeGeometry();
    const rng = new Rng(this.terrain.seed ^ 0x8484);

    // Distribute into sectors first, so each mesh gets an exact instance count.
    const perSector: { x: number; z: number; scale: number }[][] = Array.from(
      { length: TREE_SECTORS },
      () => [],
    );
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      // sqrt for uniform area density across the annulus.
      const r = Math.sqrt(
        lerp(INNER_RADIUS * INNER_RADIUS, TREE_BAND_OUTER * TREE_BAND_OUTER, rng.next()),
      );
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const sector = Math.min(
        TREE_SECTORS - 1,
        Math.floor(((a + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / TREE_SECTORS)),
      );
      perSector[sector].push({ x, z, scale: rng.range(0.8, 1.9) });
    }

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);

    for (let s = 0; s < TREE_SECTORS; s++) {
      const list = perSector[s];
      if (list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(this.treeGeometry, this.material, list.length);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        position.set(t.x, this.heightAt(t.x, t.z) - 1, t.z);
        quaternion.setFromAxisAngle(axis, (i * 2.399963) % (Math.PI * 2));
        scale.setScalar(t.scale);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = `backdrop-trees-${s}`;
      this.group.add(mesh);
      this.treeSectors.push({
        mesh,
        angle: ((s + 0.5) / TREE_SECTORS) * Math.PI * 2,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Per frame
  // -------------------------------------------------------------------------

  /**
   * Track the sky.
   *
   * `nightFactor` pulls the haze cap down at night: at full darkness a strong
   * blend towards the horizon colour would leave the mountains as a visible
   * grey band against a black sky, which is brighter than the sky itself and
   * looks like a rendering fault rather than a mountain range.
   */
  update(
    horizonColor: THREE.Color,
    lightColor: THREE.Color,
    sunDirection: THREE.Vector3,
    nightFactor: number,
  ): void {
    const u = this.material.uniforms;
    (u.uHaze.value as THREE.Color).copy(horizonColor);
    (u.uLight.value as THREE.Color).copy(lightColor);
    (u.uSunDir.value as THREE.Vector3).copy(sunDirection);
    u.uMaxHaze.value = lerp(0.88, 0.52, clamp01(nightFactor));
  }

  /** Hide the whole backdrop — used when the camera goes under the water. */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setSettings(settings: GraphicsSettings): void {
    const previous = this.settings;
    this.settings = settings;
    if (settings.foliageQuality !== previous.foliageQuality) this.build();
  }

  /** Draw-call count contributed by the backdrop, for the debug overlay. */
  get visibleMeshes(): number {
    let n = this.ground ? 1 : 0;
    if (this.canopy) n++;
    for (const s of this.treeSectors) if (s.mesh.visible) n++;
    return n;
  }

  private teardown(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== this.treeGeometry) mesh.geometry.dispose();
      if ((child as THREE.InstancedMesh).isInstancedMesh) {
        (child as THREE.InstancedMesh).dispose();
      }
    }
    this.treeGeometry?.dispose();
    this.treeGeometry = null;
    this.treeSectors.length = 0;
    this.ground = null;
    this.canopy = null;
  }

  dispose(): void {
    this.teardown();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

/**
 * A distant tree: a trunk and two crown domes, and nothing else.
 *
 * Twenty-odd triangles, because there are thousands of these and each occupies a
 * handful of pixels. All the shape that survives at this range is the silhouette.
 */
function buildSilhouetteTreeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const tints: number[] = [];
  const indices: number[] = [];
  const colour = new THREE.Color();

  const append = (geometry: THREE.BufferGeometry, hex: number) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    colour.setHex(hex);
    const base = positions.length / 3;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      tints.push(colour.r, colour.g, colour.b);
      indices.push(base + i);
    }
    if (g !== geometry) g.dispose();
    geometry.dispose();
  };

  const trunk = new THREE.CylinderGeometry(0.3, 0.55, 12, 4);
  trunk.translate(0, 6, 0);
  append(trunk, 0x3c2f1f);

  const lower = new THREE.SphereGeometry(4.4, 6, 4);
  lower.scale(1, 0.6, 1);
  lower.translate(0, 12.5, 0);
  append(lower, 0x2b5222);

  const upper = new THREE.SphereGeometry(3, 6, 4);
  upper.scale(1, 0.62, 1);
  upper.translate(0.6, 15, -0.4);
  append(upper, 0x336026);

  return finishGeometry(positions, tints, indices);
}

/** Assemble positions/tints/indices into a geometry with computed normals. */
function finishGeometry(
  positions: number[],
  tints: number[],
  indices: number[],
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Named `tint` rather than `color`: the material is a raw ShaderMaterial, and
  // an attribute called `color` makes three inject its own vertex-colour
  // plumbing, which then fights the shader's own varying.
  g.setAttribute('tint', new THREE.Float32BufferAttribute(tints, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
