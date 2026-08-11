/**
 * FoliageRenderer.ts — the jungle itself.
 *
 * There are ~15,000 props in the world. Drawing them individually is
 * impossible, and putting them all in one InstancedMesh per type is almost as
 * bad, because an InstancedMesh is culled as a single unit — one whose bounding
 * volume covers the entire map, so it is never culled at all.
 *
 * So the world is divided into a grid of chunks and each chunk gets its own
 * InstancedMesh per prop type. That gives:
 *   • real frustum culling — the jungle behind you costs nothing;
 *   • cheap distance culling — grass only exists within a few dozen metres;
 *   • and still only a handful of draw calls, because each visible chunk draws
 *     all of its trees in one go.
 *
 * Wind is done in the vertex shader by displacing vertices by height above the
 * instance origin, so thousands of bushes sway without any CPU cost.
 */

import * as THREE from 'three';
import { PropKind, type Prop, type WorldContent } from '../World/WorldGen';
import { WORLD_SIZE } from '../Systems/Config';
import type { GraphicsSettings } from '../Graphics/QualitySettings';

/**
 * Chunk resolution, per prop kind.
 *
 * One grid for everything does not work, because the useful chunk size is set by
 * the kind's draw distance. Grass is culled at forty metres, so hundred-metre
 * chunks mean loading a chunk to show a tenth of it — most of what is submitted
 * is behind the cull distance and wasted. Trees are visible to the fog line, so
 * *fine* chunks mean hundreds of draw calls for the same canopy.
 *
 * So: ground cover is chunked finely and the canopy coarsely. `COARSE` is the
 * grid used for anything visible to the horizon, `FINE` for anything that only
 * exists near the camera.
 */
const COARSE_GRID = 10; // 100 m chunks in a 1000 m world
const FINE_GRID = 24; // ~42 m chunks — matches the grass cull distance

/** Per-prop-kind rendering rules. */
interface KindConfig {
  /** Max distance at which this kind is drawn. */
  distance: (s: GraphicsSettings) => number;
  /** Fraction of instances to keep, by preset. */
  density: (s: GraphicsSettings) => number;
  /** Does the wind shader affect it? */
  wind: number;
  castShadow: boolean;
  /** Chunk grid resolution. Defaults to COARSE_GRID. */
  chunkGrid?: number;
  /**
   * How the per-instance colour is chosen.
   *
   * `foliage` is the green brightness/warmth jitter that stops a canopy reading
   * as one flat colour. `flower` picks from a palette instead, which is the only
   * way to get five different flower colours out of one InstancedMesh — the
   * geometry is shared, so the variety has to live in the colour attribute.
   */
  tint?: 'foliage' | 'flower' | 'none';
  /**
   * Non-uniform instance scaling.
   *
   * Underwater weed needs it: its `scale` carries the water depth at that spot in
   * metres, so a clump in three metres of water should be three metres tall — but
   * not three metres wide, which uniform scaling would give.
   */
  scaleAxes?: (prop: Prop, out: THREE.Vector3) => void;
}

/** Flower colours. Tropical, but not so saturated they read as plastic. */
const FLOWER_PALETTE = [0xe4483f, 0xe8c33a, 0xf0eee4, 0xa964c4, 0xe87ba8];

const KIND_CONFIG: Partial<Record<PropKind, KindConfig>> = {
  [PropKind.Tree]: {
    // Trees are landmarks; they must be visible as far as the fog allows.
    distance: (s) => s.viewDistance,
    density: () => 1,
    wind: 0.35,
    castShadow: true,
  },
  [PropKind.Bush]: {
    distance: (s) => Math.min(s.viewDistance, 110),
    density: (s) => s.foliageDensity,
    wind: 1,
    castShadow: true,
  },
  [PropKind.FruitBush]: {
    // Never thinned: these are food sources, so hiding them would be unfair.
    distance: (s) => Math.min(s.viewDistance, 130),
    density: () => 1,
    wind: 1,
    castShadow: true,
  },
  [PropKind.Fern]: {
    distance: (s) => Math.min(s.viewDistance, 80),
    density: (s) => s.foliageDensity,
    wind: 1.3,
    castShadow: false,
    chunkGrid: FINE_GRID,
  },
  [PropKind.Grass]: {
    distance: (s) => s.grassDistance,
    density: (s) => s.foliageDensity,
    wind: 1.8,
    castShadow: false,
    chunkGrid: FINE_GRID,
  },
  [PropKind.Flower]: {
    distance: (s) => Math.min(s.grassDistance, 55),
    density: (s) => s.foliageDensity,
    wind: 1.6,
    castShadow: false,
    chunkGrid: FINE_GRID,
    tint: 'flower',
  },
  [PropKind.Reed]: {
    distance: (s) => Math.min(s.viewDistance, 100),
    density: (s) => s.foliageDensity,
    wind: 2.2, // reeds are the most wind-responsive thing in the world
    castShadow: false,
    chunkGrid: FINE_GRID,
  },
  [PropKind.Waterweed]: {
    distance: (s) => Math.min(s.viewDistance, 65),
    density: (s) => s.foliageDensity,
    // Swayed by current rather than wind, but the same vertex displacement sells
    // it — slower and wider, which the shader gets from the strength alone.
    wind: 1.5,
    castShadow: false,
    chunkGrid: FINE_GRID,
    scaleAxes: (prop, out) => {
      // `scale` is the depth to fill; width stays plant-sized.
      out.set(0.8 + (prop.variant % 3) * 0.25, Math.max(0.4, prop.scale), 0.8 + (prop.variant % 2) * 0.3);
    },
  },
  [PropKind.Rock]: {
    distance: (s) => s.viewDistance,
    density: () => 1,
    wind: 0,
    castShadow: true,
  },
  [PropKind.Log]: {
    distance: (s) => Math.min(s.viewDistance, 150),
    density: () => 1,
    wind: 0,
    castShadow: true,
  },
  [PropKind.Vine]: {
    distance: (s) => Math.min(s.viewDistance, 90),
    density: (s) => s.foliageDensity,
    wind: 0.9,
    castShadow: false,
  },
  [PropKind.LilyPad]: {
    distance: (s) => Math.min(s.viewDistance, 80),
    density: (s) => s.foliageDensity,
    wind: 0.2,
    castShadow: false,
  },
  [PropKind.Hut]: {
    distance: (s) => s.viewDistance,
    density: () => 1,
    wind: 0,
    castShadow: true,
  },
  [PropKind.Bridge]: {
    distance: (s) => s.viewDistance,
    density: () => 1,
    wind: 0,
    castShadow: true,
  },
  [PropKind.Cave]: {
    distance: (s) => s.viewDistance,
    density: () => 1,
    wind: 0,
    castShadow: true,
  },
};

/** One chunk's worth of one prop kind. */
interface ChunkBatch {
  kind: PropKind;
  mesh: THREE.InstancedMesh;
  /** Chunk centre, for distance culling. */
  center: THREE.Vector3;
  radius: number;
}

/**
 * Vertex shader injection that adds wind sway to any instanced material.
 *
 * Applied via onBeforeCompile so the standard lighting, shadows and fog all
 * keep working — writing a whole material from scratch would mean
 * reimplementing three's shadow mapping.
 */
function applyWind(material: THREE.Material, strength: number): void {
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: 0.3 },
    uStrength: { value: strength },
  };
  (material as THREE.Material & { userData: { windUniforms?: typeof uniforms } }).userData.windUniforms =
    uniforms;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uStrength = uniforms.uStrength;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uWind;
         uniform float uStrength;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           // Instance origin in world space, so each plant sways out of phase.
           vec3 instanceOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
           float phase = instanceOrigin.x * 0.35 + instanceOrigin.z * 0.27;
           // Displacement grows with height above the base: the trunk stays put
           // and the canopy moves, which is what makes it look like a plant.
           float sway = pow(max(transformed.y, 0.0), 1.15) * uStrength * uWind * 0.06;
           transformed.x += sin(uTime * 1.7 + phase) * sway;
           transformed.z += cos(uTime * 1.3 + phase * 1.4) * sway * 0.7;
           // A faster flutter on top of the main sway.
           transformed.x += sin(uTime * 6.5 + phase * 3.0) * sway * 0.18;
         }`,
      );
  };
}

export class FoliageRenderer {
  private group = new THREE.Group();
  private batches: ChunkBatch[] = [];
  /** Materials with the wind shader injected, animated every frame. */
  private windMaterials: THREE.Material[] = [];
  private settings: GraphicsSettings;
  private content: WorldContent;

  constructor(scene: THREE.Scene, content: WorldContent, settings: GraphicsSettings) {
    this.settings = settings;
    this.content = content;
    this.group.name = 'foliage';
    scene.add(this.group);
    this.build();
  }

  /** (Re)build every batch. Called on construction and on a preset change. */
  private build(): void {
    this.teardown();

    // Gather every prop, bucketed by kind then by chunk.
    const buckets = new Map<PropKind, Map<number, Prop[]>>();
    const add = (prop: Prop) => {
      const config = KIND_CONFIG[prop.kind];
      if (!config) return;
      let byChunk = buckets.get(prop.kind);
      if (!byChunk) {
        byChunk = new Map();
        buckets.set(prop.kind, byChunk);
      }
      const key = chunkKey(prop.x, prop.z, config.chunkGrid ?? COARSE_GRID);
      let list = byChunk.get(key);
      if (!list) {
        list = [];
        byChunk.set(key, list);
      }
      list.push(prop);
    };

    for (const t of this.content.trees) add(t);
    for (const b of this.content.bushes) add(b);
    for (const r of this.content.rocks) add(r);
    for (const l of this.content.logs) add(l);
    for (const h of this.content.huts) add(h);
    for (const b of this.content.bridges) add(b);
    for (const c of this.content.caves) add(c);
    for (const p of this.content.cosmetic) add(p);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();

    for (const [kind, byChunk] of buckets) {
      const config = KIND_CONFIG[kind]!;
      const density = Math.max(0, Math.min(1, config.density(this.settings)));
      if (density <= 0) continue;

      for (const [key, props] of byChunk) {
        // Thin the list according to the preset. Deterministic (take every Nth)
        // rather than random, so lowering the preset never changes *which* props
        // exist in a way that could differ between two players.
        const keep =
          density >= 1 ? props : props.filter((_, i) => i % Math.ceil(1 / density) === 0);
        if (keep.length === 0) continue;

        const built = buildPropGeometry(kind, this.settings);
        if (!built) continue;
        const { geometry, material } = built;

        // Register the material for wind animation the first time we see it.
        // Assets are cached per kind, so every chunk of a kind shares one
        // material and one set of wind uniforms.
        if (config.wind > 0 && !this.windMaterials.includes(material)) {
          this.windMaterials.push(material);
        }

        const mesh = new THREE.InstancedMesh(geometry, material, keep.length);
        mesh.castShadow = config.castShadow && this.settings.shadowQuality !== 'off';
        mesh.receiveShadow = false;
        mesh.name = `${PropKind[kind]}-chunk-${key}`;

        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;

        const tintMode = config.tint ?? 'foliage';

        for (let i = 0; i < keep.length; i++) {
          const p = keep[i];
          position.set(p.x, p.y, p.z);
          quaternion.setFromAxisAngle(axis, p.rot);
          if (config.scaleAxes) config.scaleAxes(p, scale);
          else scale.setScalar(p.scale);
          matrix.compose(position, quaternion, scale);
          mesh.setMatrixAt(i, matrix);

          /*
           * Per-instance tint.
           *
           * Without this every bush in the jungle is the *exact* same shade of
           * green, which is the single most artificial-looking thing about a
           * heavily instanced scene — the eye reads the repetition instantly. A
           * per-instance colour multiplier costs one extra vertex attribute and
           * no draw calls, and it turns a flat green mass into a canopy with
           * depth. Derived from the position so it is stable across reloads and
           * identical on every client.
           */
          const jitter = hashPosition(p.x, p.z);
          if (tintMode === 'flower') {
            // The geometry's petals are white, so this multiplier *is* the
            // flower's colour rather than a nudge to it.
            tint.setHex(FLOWER_PALETTE[p.variant % FLOWER_PALETTE.length]);
            // Still jitter the brightness, so a drift of one colour has depth.
            tint.multiplyScalar(0.82 + jitter.a * 0.32);
          } else if (tintMode === 'none') {
            tint.setRGB(1, 1, 1);
          } else {
            const brightness = 0.8 + jitter.a * 0.4;
            // A warm/cool axis on top of brightness: sun-bleached leaves next to
            // ones in shade.
            const warmth = (jitter.b - 0.5) * 0.14;
            tint.setRGB(brightness + warmth, brightness, brightness - warmth * 0.6);
          }
          mesh.setColorAt(i, tint);

          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z);
          maxZ = Math.max(maxZ, p.z);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        // Compute a real bounding volume so frustum culling is accurate.
        mesh.computeBoundingSphere();

        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;
        this.batches.push({
          kind,
          mesh,
          center: new THREE.Vector3(cx, 0, cz),
          radius: Math.hypot(maxX - minX, maxZ - minZ) * 0.5,
        });
        this.group.add(mesh);
      }
    }
  }

  /**
   * Per-frame distance culling and wind update.
   *
   * Frustum culling is handled by three; this only decides which chunks are
   * close enough to be worth submitting at all.
   */
  update(cameraPos: THREE.Vector3, time: number, wind: number): void {
    for (const batch of this.batches) {
      const config = KIND_CONFIG[batch.kind]!;
      const maxDistance = config.distance(this.settings) + batch.radius;
      const dx = batch.center.x - cameraPos.x;
      const dz = batch.center.z - cameraPos.z;
      batch.mesh.visible = dx * dx + dz * dz <= maxDistance * maxDistance;
    }

    for (const material of this.windMaterials) {
      const u = (material as THREE.Material & {
        userData: { windUniforms?: { uTime: { value: number }; uWind: { value: number } } };
      }).userData.windUniforms;
      if (!u) continue;
      u.uTime.value = time;
      // Wind ramps with the weather; a storm visibly thrashes the canopy.
      u.uWind.value = 0.25 + wind * 1.4;
    }
  }

  setSettings(settings: GraphicsSettings): void {
    this.settings = settings;
    this.build();
  }

  private teardown(): void {
    for (const batch of this.batches) {
      this.group.remove(batch.mesh);
      // Disposes the InstancedMesh's instance buffers, not the shared geometry.
      batch.mesh.dispose();
    }
    this.batches.length = 0;
    this.windMaterials.length = 0;
    // The per-kind geometry and material cache is rebuilt for the new preset
    // (detail levels differ), so release the GPU resources it holds.
    for (const assets of propGeometryCache.values()) {
      assets.geometry.dispose();
      assets.material.dispose();
    }
    propGeometryCache.clear();
  }

  /** Draw-call count, for the debug overlay. */
  get visibleBatches(): number {
    let n = 0;
    for (const b of this.batches) if (b.mesh.visible) n++;
    return n;
  }

  get totalInstances(): number {
    let n = 0;
    for (const b of this.batches) n += b.mesh.count;
    return n;
  }

  dispose(): void {
    this.teardown();
    this.group.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Prop geometry
// ---------------------------------------------------------------------------

interface PropAssets {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const propGeometryCache = new Map<PropKind, PropAssets>();

/**
 * Build one prop's geometry.
 *
 * Merged into a single BufferGeometry per kind, because an InstancedMesh can
 * only draw one geometry — so a whole tree (trunk plus three canopy layers) has
 * to be one mesh.
 */
function buildPropGeometry(kind: PropKind, settings: GraphicsSettings): PropAssets | null {
  const cached = propGeometryCache.get(kind);
  if (cached) return cached;

  const detail = settings.foliageQuality === 'high' ? 2 : settings.foliageQuality === 'medium' ? 1 : 0;
  let assets: PropAssets | null = null;

  switch (kind) {
    case PropKind.Tree:
      assets = buildTree(detail);
      break;
    case PropKind.Bush:
      assets = buildBush(detail, 0x2f5423);
      break;
    case PropKind.FruitBush:
      assets = buildFruitBush(detail);
      break;
    case PropKind.Fern:
      assets = buildFern(detail);
      break;
    case PropKind.Grass:
      assets = buildGrass();
      break;
    case PropKind.Flower:
      assets = buildFlower();
      break;
    case PropKind.Reed:
      assets = buildReed();
      break;
    case PropKind.Waterweed:
      assets = buildWaterweed();
      break;
    case PropKind.Rock:
      assets = buildRock(detail);
      break;
    case PropKind.Log:
      assets = buildLog(detail);
      break;
    case PropKind.Vine:
      assets = buildVine();
      break;
    case PropKind.LilyPad:
      assets = buildLilyPad();
      break;
    case PropKind.Hut:
      assets = buildHut();
      break;
    case PropKind.Bridge:
      assets = buildBridge();
      break;
    case PropKind.Cave:
      assets = buildCave();
      break;
    default:
      return null;
  }

  if (assets) {
    const config = KIND_CONFIG[kind];
    if (config && config.wind > 0) applyWind(assets.material, config.wind);
    propGeometryCache.set(kind, assets);
  }
  return assets;
}

/** Merge a list of geometries into one, preserving vertex colours. */
function merge(parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  for (const part of parts) {
    const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute | undefined;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nrm) normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      colors.push(part.color.r, part.color.g, part.color.b);
    }
    if (g !== part.geometry) g.dispose();
    part.geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) {
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  } else {
    merged.computeVertexNormals();
  }
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

function vertexColorMaterial(options: { transparent?: boolean; side?: THREE.Side } = {}): THREE.Material {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: options.side ?? THREE.FrontSide,
    transparent: options.transparent ?? false,
  });
}

/** A rainforest tree: bare trunk with the canopy high up. */
function buildTree(detail: number): PropAssets {
  const segments = detail >= 2 ? 7 : detail >= 1 ? 5 : 4;
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];

  // Trunk — tall and clean, as rainforest trunks are.
  const trunk = new THREE.CylinderGeometry(0.32, 0.5, 13, segments);
  trunk.translate(0, 6.5, 0);
  parts.push({ geometry: trunk, color: new THREE.Color(0x453322) });

  // Buttress roots, the signature of a big Amazon tree.
  if (detail >= 1) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const root = new THREE.ConeGeometry(0.42, 2.6, 4);
      root.translate(Math.cos(a) * 0.5, 1.1, Math.sin(a) * 0.5);
      parts.push({ geometry: root, color: new THREE.Color(0x3b2c1d) });
    }
  }

  // Canopy: three overlapping domes at different heights, so tree tops form an
  // uneven roof rather than a row of identical blobs.
  const canopyColors = [0x1f4517, 0x27551c, 0x2f6322];
  const heights = [12.4, 14.2, 15.6];
  const radii = [4.6, 3.7, 2.6];
  for (let i = 0; i < 3; i++) {
    const dome = new THREE.SphereGeometry(radii[i], segments + 2, Math.max(3, segments - 1));
    dome.scale(1, 0.62, 1);
    dome.translate((i - 1) * 0.7, heights[i], (i % 2 === 0 ? 1 : -1) * 0.5);
    parts.push({ geometry: dome, color: new THREE.Color(canopyColors[i]) });
  }

  // A couple of bare branches for silhouette interest.
  if (detail >= 2) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const branch = new THREE.CylinderGeometry(0.09, 0.16, 3.4, 4);
      branch.rotateZ(Math.PI * 0.32);
      branch.rotateY(a);
      branch.translate(Math.cos(a) * 1.2, 10 + i * 0.8, Math.sin(a) * 1.2);
      parts.push({ geometry: branch, color: new THREE.Color(0x40301f) });
    }
  }

  return { geometry: merge(parts), material: vertexColorMaterial() };
}

/** A bush: overlapping spheres. The primary hiding place in the game. */
function buildBush(detail: number, color: number): PropAssets {
  const segments = detail >= 2 ? 7 : 5;
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const blobs = detail >= 1 ? 4 : 2;
  const base = new THREE.Color(color);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2;
    const r = 0.55 + (i % 2) * 0.2;
    const blob = new THREE.SphereGeometry(r, segments, Math.max(3, segments - 2));
    blob.scale(1, 0.85, 1);
    blob.translate(Math.cos(a) * 0.35, 0.5 + (i % 2) * 0.22, Math.sin(a) * 0.35);
    // Vary the shade per blob so the bush has internal depth.
    const shade = base.clone().offsetHSL(0, 0, (i % 2 === 0 ? 0.04 : -0.05));
    parts.push({ geometry: blob, color: shade });
  }
  return { geometry: merge(parts), material: vertexColorMaterial() };
}

/** A fruit bush: a bush with visible berries, so food is findable. */
function buildFruitBush(detail: number): PropAssets {
  const bush = buildBush(detail, 0x2b4a1e);

  // merge() assigns one flat colour per part, so the fruit is built as its own
  // geometry and concatenated afterwards — that keeps the bush's per-blob
  // shading instead of flattening the whole thing to one colour.
  const fruitParts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const fruit = new THREE.SphereGeometry(0.12, 5, 4);
    fruit.translate(Math.cos(a) * 0.62, 0.55 + Math.sin(a * 2) * 0.25, Math.sin(a) * 0.62);
    fruitParts.push({ geometry: fruit, color: new THREE.Color(0xd9761f) });
  }
  const fruitGeometry = merge(fruitParts);

  // Concatenate the two geometries' attributes.
  const combined = concatGeometries([bush.geometry, fruitGeometry]);
  bush.geometry.dispose();
  fruitGeometry.dispose();
  return { geometry: combined, material: bush.material };
}

/** Join geometries that already carry their own colour attribute. */
function concatGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  for (const g of list) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    const col = g.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      colors.push(col.getX(i), col.getY(i), col.getZ(i));
    }
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

/** A fern: a rosette of angled fronds. */
function buildFern(detail: number): PropAssets {
  const fronds = detail >= 1 ? 7 : 4;
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2;
    const frond = new THREE.BoxGeometry(0.1, 0.05, 1.15);
    frond.translate(0, 0, 0.55);
    frond.rotateX(-0.55);
    frond.rotateY(a);
    frond.translate(0, 0.42, 0);
    parts.push({
      geometry: frond,
      color: new THREE.Color(i % 2 === 0 ? 0x3a6b25 : 0x2e5a1e),
    });
  }
  return { geometry: merge(parts), material: vertexColorMaterial({ side: THREE.DoubleSide }) };
}

/**
 * One grass blade: a tapered, leaning strip.
 *
 * Built by hand rather than from a PlaneGeometry because the taper is what makes
 * it read as grass at all — a rectangle reads as a rectangle. Six triangles for
 * four segments, and the lean is baked in so a tuft is not a set of identical
 * vertical slabs. Cheap enough that a tuft can afford five of them: grass is
 * culled at a few dozen metres, so only a small fraction is ever submitted.
 */
function bladeGeometry(width: number, height: number, lean: number, segments = 4): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let s = 0; s < segments; s++) {
    const t0 = s / segments;
    const t1 = (s + 1) / segments;
    // Taper to a point, and curve over further towards the tip.
    const w0 = (width * (1 - t0 * 0.85)) / 2;
    const w1 = (width * (1 - t1 * 0.85)) / 2;
    const y0 = height * t0;
    const y1 = height * t1;
    const x0 = lean * t0 * t0;
    const x1 = lean * t1 * t1;
    positions.push(x0 - w0, y0, 0, x0 + w0, y0, 0, x1 + w1, y1, 0);
    positions.push(x0 - w0, y0, 0, x1 + w1, y1, 0, x1 - w1, y1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/** Grass: a tuft of leaning blades fanned around the origin. */
function buildGrass(): PropAssets {
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    // Golden-angle fan so five blades never line up, at any rotation.
    const a = i * 2.399963;
    const blade = bladeGeometry(0.11, 0.5 + (i % 3) * 0.22, 0.16 + (i % 2) * 0.12);
    blade.rotateY(a);
    blade.translate(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
    // Alternate shades so a tuft has depth even before the per-instance tint.
    parts.push({
      geometry: blade,
      color: new THREE.Color(i % 3 === 0 ? 0x538530 : i % 3 === 1 ? 0x3d6824 : 0x477329),
    });
  }
  return { geometry: merge(parts), material: vertexColorMaterial({ side: THREE.DoubleSide }) };
}

/**
 * A flower: a stem, a couple of leaves and a ring of petals.
 *
 * The petals are deliberately near-white. The instance tint multiplies the
 * vertex colour, so leaving them white is what lets one shared geometry produce
 * red, yellow, purple and pink flowers across the map — see FLOWER_PALETTE.
 */
function buildFlower(): PropAssets {
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];

  const stem = new THREE.CylinderGeometry(0.012, 0.02, 0.42, 3);
  stem.translate(0, 0.21, 0);
  parts.push({ geometry: stem, color: new THREE.Color(0x3f6a24) });

  // Two low leaves, so the flower has something at ground level.
  for (const side of [-1, 1]) {
    const leaf = bladeGeometry(0.09, 0.2, 0.13 * side);
    leaf.rotateY(side > 0 ? 0.6 : 2.4);
    parts.push({ geometry: leaf, color: new THREE.Color(0x477a28) });
  }

  // Petals: five flat blades splayed outwards from the top of the stem.
  const petals = 5;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const petal = new THREE.PlaneGeometry(0.075, 0.11);
    petal.translate(0, 0.055, 0);
    petal.rotateX(-1.15); // tip up and outwards
    petal.rotateY(a);
    petal.translate(Math.cos(a) * 0.035, 0.43, Math.sin(a) * 0.035);
    parts.push({ geometry: petal, color: new THREE.Color(0xffffff) });
  }

  // A darker centre keeps the head from reading as a flat disc.
  const centre = new THREE.SphereGeometry(0.028, 5, 4);
  centre.translate(0, 0.45, 0);
  parts.push({ geometry: centre, color: new THREE.Color(0x8a7326) });

  return { geometry: merge(parts), material: vertexColorMaterial({ side: THREE.DoubleSide }) };
}

/**
 * Reeds: a tight clump of tall blades standing in the shallows.
 *
 * Rooted on the river bed, so the visible height depends on how deep the water
 * is where they grew — which is what makes a shoreline read as a gradient
 * instead of a hard line between "water" and "jungle".
 */
function buildReed(): PropAssets {
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = i * 2.399963;
    const blade = bladeGeometry(0.055, 1.5 + (i % 4) * 0.4, 0.1 + (i % 3) * 0.09, 3);
    blade.rotateY(a);
    blade.translate(Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09);
    parts.push({
      geometry: blade,
      color: new THREE.Color(i % 2 === 0 ? 0x6b7b34 : 0x55672a),
    });
  }
  // A seed head on the tallest few, which is the detail that says "reed".
  for (let i = 0; i < 3; i++) {
    const a = i * 2.399963;
    const head = new THREE.CylinderGeometry(0.03, 0.015, 0.26, 4);
    head.translate(Math.cos(a) * 0.09 + 0.1, 2.35, Math.sin(a) * 0.09);
    parts.push({ geometry: head, color: new THREE.Color(0x8a7442) });
  }
  return { geometry: merge(parts), material: vertexColorMaterial({ side: THREE.DoubleSide }) };
}

/**
 * Underwater weed: a fan of broad, limp fronds reaching up from the bed.
 *
 * Built at unit height so the instance's Y scale can be the water depth — see
 * the `scaleAxes` hook. Broader and darker than grass: this is meant to be a
 * murky mass that a four-metre caiman can genuinely disappear into, which is the
 * only reason a crocodile player has anywhere to hide under water at all.
 */
function buildWaterweed(): PropAssets {
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const a = i * 2.399963;
    // Unit height, so scaleAxes maps Y directly to metres of depth.
    const frond = bladeGeometry(0.3, 1, 0.42 + (i % 3) * 0.16, 4);
    frond.rotateY(a);
    frond.translate(Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16);
    parts.push({
      geometry: frond,
      // Deep, desaturated greens: underwater light loses red first, and weed
      // that is as bright as grass looks like grass someone flooded.
      color: new THREE.Color(i % 3 === 0 ? 0x244a2f : i % 3 === 1 ? 0x1b3d29 : 0x2b5236),
    });
  }
  return { geometry: merge(parts), material: vertexColorMaterial({ side: THREE.DoubleSide }) };
}

/** A rock: a lumpy low-poly sphere. */
function buildRock(detail: number): PropAssets {
  const g = new THREE.SphereGeometry(0.8, detail >= 1 ? 7 : 5, detail >= 1 ? 5 : 4);
  // Displace vertices for an irregular silhouette.
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 1 + Math.sin(x * 6.1) * 0.12 + Math.cos(z * 5.3) * 0.1 + Math.sin(y * 4.7) * 0.08;
    pos.setXYZ(i, x * n, y * n * 0.72, z * n);
  }
  g.computeVertexNormals();
  g.translate(0, 0.42, 0);
  return {
    geometry: merge([{ geometry: g, color: new THREE.Color(0x5e5b53) }]),
    material: vertexColorMaterial(),
  };
}

/** A fallen log: cover, and a bridge across a stream. */
function buildLog(detail: number): PropAssets {
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const trunk = new THREE.CylinderGeometry(0.36, 0.42, 4.2, detail >= 1 ? 7 : 5);
  trunk.rotateZ(Math.PI / 2);
  trunk.translate(0, 0.4, 0);
  parts.push({ geometry: trunk, color: new THREE.Color(0x4a3826) });
  // Mossy top.
  if (detail >= 1) {
    const moss = new THREE.CylinderGeometry(0.38, 0.38, 3.4, 6, 1, false, 0, Math.PI);
    moss.rotateZ(Math.PI / 2);
    moss.translate(0, 0.44, 0);
    parts.push({ geometry: moss, color: new THREE.Color(0x3c5c26) });
  }
  return { geometry: merge(parts), material: vertexColorMaterial() };
}

/** A hanging vine. */
function buildVine(): PropAssets {
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const rope = new THREE.CylinderGeometry(0.05, 0.04, 5.5, 4);
  rope.translate(0, -2.75, 0);
  parts.push({ geometry: rope, color: new THREE.Color(0x35521f) });
  for (let i = 0; i < 4; i++) {
    const leaf = new THREE.PlaneGeometry(0.3, 0.22);
    leaf.translate(0.15, -1 - i * 1.2, 0);
    parts.push({ geometry: leaf, color: new THREE.Color(0x3f6b24) });
  }
  return { geometry: merge(parts), material: vertexColorMaterial({ side: THREE.DoubleSide }) };
}

/** A lily pad floating on the shallows. */
function buildLilyPad(): PropAssets {
  const g = new THREE.CircleGeometry(0.55, 8);
  g.rotateX(-Math.PI / 2);
  return {
    geometry: merge([{ geometry: g, color: new THREE.Color(0x2f5c2a) }]),
    material: vertexColorMaterial({ side: THREE.DoubleSide }),
  };
}

/** An abandoned hut: the only man-made landmark out here. */
function buildHut(): PropAssets {
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  // Stilts.
  for (const [x, z] of [
    [-1.6, -1.6],
    [1.6, -1.6],
    [-1.6, 1.6],
    [1.6, 1.6],
  ]) {
    const post = new THREE.CylinderGeometry(0.13, 0.15, 1.6, 5);
    post.translate(x, 0.8, z);
    parts.push({ geometry: post, color: new THREE.Color(0x3f3123) });
  }
  // Floor and walls.
  const floor = new THREE.BoxGeometry(3.8, 0.18, 3.8);
  floor.translate(0, 1.65, 0);
  parts.push({ geometry: floor, color: new THREE.Color(0x5b4630) });
  const walls = new THREE.BoxGeometry(3.4, 1.9, 3.4);
  walls.translate(0, 2.7, 0);
  parts.push({ geometry: walls, color: new THREE.Color(0x6b5238) });
  // Thatched roof.
  const roof = new THREE.ConeGeometry(3.2, 1.7, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 4.5, 0);
  parts.push({ geometry: roof, color: new THREE.Color(0x7a6132) });
  return { geometry: merge(parts), material: vertexColorMaterial() };
}

/** A rope bridge deck across a river. */
function buildBridge(): PropAssets {
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const planks = 16;
  for (let i = 0; i < planks; i++) {
    const plank = new THREE.BoxGeometry(1.6, 0.1, 0.5);
    // Sag towards the middle, like a real rope bridge.
    const t = i / (planks - 1) - 0.5;
    plank.translate(0, 2.4 - Math.cos(t * Math.PI) * 0.5, t * 26);
    parts.push({ geometry: plank, color: new THREE.Color(0x5a4630) });
  }
  // Handrails.
  for (const side of [-1, 1]) {
    const rail = new THREE.BoxGeometry(0.08, 0.08, 26);
    rail.translate(side * 0.85, 3.2, 0);
    parts.push({ geometry: rail, color: new THREE.Color(0x40331f) });
  }
  return { geometry: merge(parts), material: vertexColorMaterial() };
}

/** A cave mouth: a dark arch set into a slope. */
function buildCave(): PropAssets {
  const parts: { geometry: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const arch = new THREE.SphereGeometry(2.6, 9, 6, 0, Math.PI);
  arch.scale(1, 0.9, 0.7);
  arch.translate(0, 0.6, 0);
  parts.push({ geometry: arch, color: new THREE.Color(0x4a463f) });
  // The dark interior, which is the whole point. Not pure black: at close range
  // an absolutely black surface stops reading as "a hole in the rock" and starts
  // looking like a rendering fault.
  const mouth = new THREE.SphereGeometry(1.7, 9, 6, 0, Math.PI);
  mouth.scale(1, 0.85, 0.5);
  mouth.translate(0, 0.45, 0.55);
  parts.push({ geometry: mouth, color: new THREE.Color(0x1b1a1e) });
  return { geometry: merge(parts), material: vertexColorMaterial({ side: THREE.DoubleSide }) };
}

/**
 * Two stable pseudo-random values from a world position.
 *
 * Position-derived rather than counter-derived so a prop keeps its exact tint
 * when the graphics preset thins the instance list, and so every client agrees.
 */
function hashPosition(x: number, z: number): { a: number; b: number } {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  const t = Math.sin(x * 39.3468 + z * 11.135) * 24634.6345;
  return { a: s - Math.floor(s), b: t - Math.floor(t) };
}

/**
 * Chunk index for a world position at a given grid resolution.
 *
 * The resolution is folded into the key, so two kinds on different grids can
 * never collide in the same bucket map.
 */
function chunkKey(x: number, z: number, grid: number): number {
  const half = WORLD_SIZE / 2;
  const size = WORLD_SIZE / grid;
  const cx = Math.min(grid - 1, Math.max(0, Math.floor((x + half) / size)));
  const cz = Math.min(grid - 1, Math.max(0, Math.floor((z + half) / size)));
  return grid * 100000 + cz * grid + cx;
}
