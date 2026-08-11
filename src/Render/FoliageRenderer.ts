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
  tint?: 'foliage' | 'flower' | 'spike' | 'none';
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

/**
 * Spike colours: magenta, gold, coral, cream.
 *
 * A shorter, hotter palette than the ground flowers get. A spike is meant to be
 * read across a clearing, and the whole point of placing them in single-variant
 * drifts is that a band of one strong colour is what carries at that distance —
 * five pastels mixed together just average out to grey.
 */
/*
 * Spike colours, pulled back from where they started.
 *
 * These multiply a white floret, so whatever is written here arrives on screen
 * at close to full strength — and a fully saturated magenta in a scene whose
 * every other surface is a muted green reads as neon plastic, not as a flower.
 * The first pass used 0xd6428a and 0xf0c02e and the drifts glowed. Desaturated
 * towards the warm end and dropped a little in value, they still carry a
 * clearing from across it without looking like they are lit from inside.
 */
const SPIKE_PALETTE = [0xb8497f, 0xd4ac3c, 0xcc6a42, 0xdcd0b4];

/*
 * Note the absence of PropKind.Grass.
 *
 * Grass is not a scattered prop any more. Reaching a believable density this way
 * would need hundreds of thousands of stored props, so it is streamed in chunks
 * around the camera instead — see GrassField.ts. A prop kind with no entry here
 * is simply skipped, so nothing else needs to know.
 */
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
  [PropKind.Flower]: {
    distance: (s) => Math.min(s.grassDistance, 55),
    density: (s) => s.foliageDensity,
    wind: 1.6,
    castShadow: false,
    chunkGrid: FINE_GRID,
    tint: 'flower',
  },
  [PropKind.FlowerSpike]: {
    // Visible further than ground flowers: standing knee-high in a drift, these
    // are landmarks in a clearing rather than detail underfoot.
    distance: (s) => Math.min(s.viewDistance, 95),
    density: (s) => s.foliageDensity,
    wind: 1.9,
    castShadow: false,
    chunkGrid: FINE_GRID,
    tint: 'spike',
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
export function applyWind(material: THREE.Material, strength: number): void {
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: 0.3 },
    uStrength: { value: strength },
  };
  (material as THREE.Material & { userData: { windUniforms?: typeof uniforms } }).userData.windUniforms =
    uniforms;

  /*
   * Chain, do not replace.
   *
   * `vertexColorMaterial` has already installed the tint-mask injection here,
   * and assigning over it silently dropped that — which showed up as every
   * flower stem going black again. Anything that hooks a shared material's
   * compile step has to compose with what is already there.
   */
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
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
          if (tintMode === 'spike') {
            // One colour per drift: the clump shares a variant, so this picks the
            // same hue for every spike in it. Brightness still jitters per plant.
            tint.setHex(SPIKE_PALETTE[p.variant % SPIKE_PALETTE.length]);
            tint.multiplyScalar(0.86 + jitter.a * 0.3);
          } else if (tintMode === 'flower') {
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

  /** The batch list, for the verification tools' instance-count checks. */
  get batchList(): readonly ChunkBatch[] {
    return this.batches;
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
      assets = buildBush(detail, 0x4a7530);
      break;
    case PropKind.FruitBush:
      assets = buildFruitBush(detail);
      break;
    case PropKind.Fern:
      assets = buildFern(detail);
      break;
    case PropKind.Flower:
      assets = buildFlower();
      break;
    case PropKind.FlowerSpike:
      assets = buildFlowerSpike(detail);
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
/**
 * A merged part.
 *
 * `tintable: false` opts the part out of the per-instance colour — see
 * `injectTintMask` for why that is needed and what goes wrong without it.
 */
interface MergePart {
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
  tintable?: boolean;
}

function merge(parts: MergePart[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const tintMask: number[] = [];

  for (const part of parts) {
    const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute | undefined;
    const mask = part.tintable === false ? 0 : 1;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nrm) normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      colors.push(part.color.r, part.color.g, part.color.b);
      tintMask.push(mask);
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
  merged.setAttribute('aTintMask', new THREE.Float32BufferAttribute(tintMask, 1));
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Make the per-instance colour apply only to the vertices that asked for it.
 *
 * ## The bug this fixes
 *
 * Several props are drawn in many colours from one geometry by leaving the
 * coloured parts white and letting the InstancedMesh's per-instance colour
 * supply the hue — that is how one flower mesh produces red, yellow and purple
 * flowers across the map for a single draw call. It is a good trick and it has
 * one flaw that is invisible until the tint gets saturated: three.js multiplies
 * `instanceColor` into *every* vertex of the instance, not just the white ones.
 *
 * So a flowering spike with a green stem and green leaves, tinted magenta, does
 * not get a magenta plume on a green plant. It gets a magenta plume, magenta
 * leaves, and a stem whose green has been multiplied by magenta into something
 * very close to black. On screen that read as a drift of neon plumes floating
 * over black sticks, which is exactly what it was.
 *
 * The fix is a per-vertex mask written at merge time: 1 for "this vertex is
 * white and wants the instance colour", 0 for "this vertex already knows what
 * colour it is". Then the stem stays green whatever the flower is doing.
 *
 * Implemented by replacing three's `<color_vertex>` chunk rather than adding to
 * it, because the multiply that has to be conditional is *inside* that chunk.
 * The default is 1, so every prop that does not care is unaffected.
 */
function injectTintMask(shader: { vertexShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float aTintMask;`,
    )
    .replace(
      '#include <color_vertex>',
      `vColor = vec3( 1.0 );
       #ifdef USE_COLOR
         vColor *= color;
       #endif
       #ifdef USE_INSTANCING_COLOR
         vColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, aTintMask );
       #endif`,
    );
}

export function vertexColorMaterial(options: { transparent?: boolean; side?: THREE.Side } = {}): THREE.Material {
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: options.side ?? THREE.FrontSide,
    transparent: options.transparent ?? false,
  });
  material.onBeforeCompile = (shader) => injectTintMask(shader);
  return material;
}

/**
 * One leaf: a tapered blade, four triangles, lying in its own local XZ plane.
 *
 * This is the building block that replaced the smooth spheres the canopy and the
 * bushes used to be made of, and it is worth spelling out why, because the change
 * made the jungle both better looking *and* cheaper.
 *
 * A low-poly sphere is a terrible leaf mass. Its silhouette is a polygon, its
 * shading is a smooth gradient, and the eye reads it instantly as a ball painted
 * green — no amount of colour variation fixes a shape that has no leaves in it.
 * It is also expensive: a 7×5 sphere is about seventy triangles, and a bush was
 * four of them, so ~280 triangles to draw one shrub badly.
 *
 * A cluster of twenty leaf cards is ~80 triangles, has a ragged silhouette, and
 * catches light differently on every card. Better and a third of the cost.
 */
function leafGeometry(length: number, width: number, droop: number): THREE.BufferGeometry {
  // Five points: base, two shoulders, two tip-side points, meeting at the tip.
  const h = width * 0.5;
  const positions = [
    // Base triangle pair, widening out.
    0, 0, 0, length * 0.35, -droop * 0.15, -h, length * 0.35, -droop * 0.15, h,
    // Middle, at full width.
    length * 0.35, -droop * 0.15, -h, length * 0.72, -droop * 0.55, -h * 0.8, length * 0.35, -droop * 0.15, h,
    length * 0.72, -droop * 0.55, -h * 0.8, length * 0.72, -droop * 0.55, h * 0.8, length * 0.35, -droop * 0.15, h,
    // Tip.
    length * 0.72, -droop * 0.55, -h * 0.8, length, -droop, 0, length * 0.72, -droop * 0.55, h * 0.8,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A mass of leaves filling a rough ellipsoid.
 *
 * Cards are placed on a Fibonacci sphere so they spread evenly at any count, then
 * each is tilted outward-and-down like a real leaf hanging off a twig. Every card
 * gets its own colour from a small palette, which is what turns the cluster into
 * something with depth instead of a single-tone shape.
 */
function leafCluster(
  parts: MergePart[],
  options: {
    count: number;
    radius: number;
    flatten: number;
    leafLength: number;
    leafWidth: number;
    centre: [number, number, number];
    palette: number[];
  },
): void {
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < options.count; i++) {
    // Fibonacci sphere: even coverage without a lattice pattern.
    const y = 1 - (i / Math.max(1, options.count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * golden;
    const dirX = Math.cos(a) * r;
    const dirY = y;
    const dirZ = Math.sin(a) * r;

    const leaf = leafGeometry(options.leafLength, options.leafWidth, options.leafLength * 0.3);
    // Point the leaf outwards along its own +X, then tip it down a little.
    leaf.rotateZ(-0.35 - (i % 3) * 0.18);
    leaf.rotateY(-Math.atan2(dirZ, dirX));
    // Splay the whole card towards its direction on the sphere.
    leaf.rotateZ(Math.asin(Math.max(-1, Math.min(1, dirY))) * 0.55);
    leaf.translate(
      options.centre[0] + dirX * options.radius * 0.72,
      options.centre[1] + dirY * options.radius * options.flatten * 0.72,
      options.centre[2] + dirZ * options.radius * 0.72,
    );
    parts.push({
      geometry: leaf,
      color: new THREE.Color(options.palette[i % options.palette.length]),
    });
  }
}

/** A rainforest tree: bare trunk, real branches, and a canopy of leaves. */
function buildTree(detail: number): PropAssets {
  const segments = detail >= 2 ? 7 : detail >= 1 ? 5 : 4;
  const parts: MergePart[] = [];

  // Trunk — tall and clean, as rainforest trunks are. Two stacked sections with
  // different tapers read as a real trunk rather than as a pole.
  const lower = new THREE.CylinderGeometry(0.42, 0.56, 7, segments);
  lower.translate(0, 3.5, 0);
  parts.push({ geometry: lower, color: new THREE.Color(0x4b3826) });
  const upper = new THREE.CylinderGeometry(0.26, 0.42, 6.4, segments);
  upper.translate(0, 10.1, 0);
  parts.push({ geometry: upper, color: new THREE.Color(0x554027) });

  // Buttress roots, the signature of a big Amazon tree.
  if (detail >= 1) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const root = new THREE.ConeGeometry(0.4, 2.8, 4);
      root.rotateZ(0.13);
      root.rotateY(a);
      root.translate(Math.cos(a) * 0.55, 1.2, Math.sin(a) * 0.55);
      parts.push({ geometry: root, color: new THREE.Color(0x3f2f1f) });
    }
  }

  /*
   * Branches, reaching up and out into the canopy.
   *
   * These do real work beyond decoration: they are what visually *supports* the
   * leaf mass. Leaf clusters floating with nothing underneath them read as
   * green clouds, which is what the three smooth domes here used to look like.
   */
  const branchCount = detail >= 2 ? 5 : detail >= 1 ? 4 : 3;
  const branchTips: [number, number, number][] = [];
  for (let i = 0; i < branchCount; i++) {
    const a = (i / branchCount) * Math.PI * 2 + 0.4;
    const lean = 0.62 + (i % 2) * 0.16;
    const len = 3.6 + (i % 3) * 0.9;
    const baseY = 11.4 + (i % 3) * 0.9;
    const branch = new THREE.CylinderGeometry(0.07, 0.17, len, 4);
    // Stand it up, tip it out, then swing it round to its bearing.
    branch.translate(0, len * 0.5, 0);
    branch.rotateZ(lean);
    branch.rotateY(-a);
    branch.translate(0, baseY, 0);
    parts.push({ geometry: branch, color: new THREE.Color(0x483623) });
    // Where the leaves for this branch belong.
    const reach = Math.sin(lean) * len;
    branchTips.push([
      Math.cos(a) * reach,
      baseY + Math.cos(lean) * len,
      Math.sin(a) * reach,
    ]);
  }

  /*
   * The canopy: one leaf cluster per branch tip, plus a crown on top.
   *
   * Uneven on purpose — real tree tops form a lumpy roof, and a row of identical
   * blobs is the single most obvious tell of a procedural forest.
   */
  const palette = [0x2f6224, 0x376e29, 0x40802f, 0x2a5620, 0x487f35];
  const perCluster = detail >= 2 ? 13 : detail >= 1 ? 9 : 5;
  for (let i = 0; i < branchTips.length; i++) {
    leafCluster(parts, {
      count: perCluster,
      radius: 2.5 + (i % 3) * 0.55,
      flatten: 0.78,
      leafLength: 1.5,
      leafWidth: 0.66,
      centre: branchTips[i],
      palette,
    });
  }
  leafCluster(parts, {
    count: perCluster + 4,
    radius: 3.1,
    flatten: 0.62,
    leafLength: 1.7,
    leafWidth: 0.72,
    centre: [0, 15.4, 0],
    palette,
  });

  /*
   * A lower tier, at four to nine metres.
   *
   * Everything above is botanically right for a rainforest — a clean trunk with
   * all its leaves in a canopy fifteen metres up — and from the game's actual
   * camera it looked wrong, because the player's eye is half a metre off the
   * ground and the canopy is entirely out of frame. What filled the screen was a
   * row of bare brown poles with sky between them.
   *
   * Real forest fills that band with saplings, epiphytes and the lower branches
   * of smaller trees. Rather than add another prop for it, each tree carries two
   * short drooping branches down at eye level. They cost about a tenth of the
   * canopy and they are the difference between looking at a jungle and looking
   * through one — which also matters for play, since this is the band that
   * actually breaks line of sight between two animals.
   */
  if (detail >= 1) {
    const lowPalette = [0x2b5a20, 0x33682a, 0x3c7530, 0x27501d];
    const lowCount = detail >= 2 ? 3 : 2;
    for (let i = 0; i < lowCount; i++) {
      const a = (i / lowCount) * Math.PI * 2 + 1.9;
      const len = 2.2 + (i % 2) * 0.7;
      const baseY = 4.4 + i * 2.1;
      const branch = new THREE.CylinderGeometry(0.05, 0.11, len, 4);
      branch.translate(0, len * 0.5, 0);
      // Past 90°, so the branch droops rather than reaching up.
      branch.rotateZ(1.15);
      branch.rotateY(-a);
      branch.translate(0, baseY, 0);
      parts.push({ geometry: branch, color: new THREE.Color(0x453320) });
      const reach = Math.sin(1.15) * len;
      leafCluster(parts, {
        count: detail >= 2 ? 7 : 5,
        radius: 1.25,
        flatten: 0.85,
        leafLength: 1.1,
        leafWidth: 0.5,
        centre: [Math.cos(a) * reach, baseY + Math.cos(1.15) * len, Math.sin(a) * reach],
        palette: lowPalette,
      });
    }
  }

  return { geometry: merge(parts), material: vertexColorMaterial({ side: THREE.DoubleSide }) };
}

/**
 * A bush: stems and a mass of leaves. The primary hiding place in the game.
 *
 * The most important prop in the world to get right — there are eight thousand of
 * them and the whole game is about being inside one — and until now it was four
 * overlapping spheres, which is to say four green balls. Now it is a few woody
 * stems with leaf cards clustered around them: a ragged outline, light catching
 * individual leaves, and about a third of the triangles.
 *
 * The albedo is much brighter than a photograph of a shade-grown shrub, and that
 * is deliberate. sRGB 0x2f5423 — which looks like a perfectly reasonable bush
 * green in a colour picker — is only 0.088 in linear light. Multiply that by a
 * canopy-shadowed sun and push it through ACES tone mapping and the bush comes out
 * as a black hexagon with one lit facet: it stops reading as the thing you hide in
 * and starts reading as a hole in the ground.
 */
function buildBush(detail: number, color: number): PropAssets {
  const parts: MergePart[] = [];
  const base = new THREE.Color(color);

  // A palette spread around the base colour. The spread is wider than looks
  // right in isolation, because leaves deep in the bush sit in its own shadow and
  // need somewhere darker to fall to.
  const palette = [
    base.clone().offsetHSL(0, 0.03, 0.08).getHex(),
    base.getHex(),
    base.clone().offsetHSL(0.02, -0.02, -0.07).getHex(),
    base.clone().offsetHSL(-0.02, 0.05, 0.03).getHex(),
    base.clone().offsetHSL(0, -0.04, -0.12).getHex(),
  ];

  // Woody stems fanning up out of the ground, so the leaves hang off something.
  const stems = detail >= 1 ? 4 : 2;
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + 0.3;
    const stem = new THREE.CylinderGeometry(0.018, 0.038, 0.62, 3);
    stem.translate(0, 0.31, 0);
    stem.rotateZ(0.28);
    stem.rotateY(-a);
    parts.push({ geometry: stem, color: new THREE.Color(0x4a3a24) });
  }

  /*
   * Three overlapping leaf masses, and a lot of leaves in each.
   *
   * The count is high deliberately. A bush is the primary hiding place in the
   * game, so it has to read as a *solid mass* — the first pass at this used
   * fifteen small cards and the result was loose confetti you could see straight
   * through, which is worse than the spheres it replaced however much better an
   * individual leaf looked. The leaves are also bigger relative to the bush than
   * feels right in isolation, because overlap is what makes a mass.
   *
   * Still cheaper than what it replaced: forty-odd cards at four triangles each is
   * under two hundred triangles, against roughly two hundred and eighty for four
   * low-poly spheres.
   */
  const perCluster = detail >= 2 ? 22 : detail >= 1 ? 16 : 9;
  const masses: { radius: number; centre: [number, number, number]; scale: number }[] = [
    { radius: 0.62, centre: [0, 0.46, 0], scale: 1 },
    { radius: 0.48, centre: [0.26, 0.72, -0.16], scale: 0.88 },
    { radius: 0.42, centre: [-0.27, 0.6, 0.2], scale: 0.82 },
  ];
  for (let m = 0; m < masses.length; m++) {
    const mass = masses[m];
    leafCluster(parts, {
      count: m === 0 ? perCluster : Math.max(6, perCluster - 5),
      radius: mass.radius,
      flatten: 0.88,
      // Leaf size against bush size is the ratio that decides whether this reads
      // as a shrub or as a houseplant. Half a metre was too long: at the scales
      // bushes are instanced at, that is a banana leaf.
      leafLength: 0.32 * mass.scale,
      leafWidth: 0.17 * mass.scale,
      centre: mass.centre,
      palette,
    });
  }

  return { geometry: merge(parts), material: vertexColorMaterial({ side: THREE.DoubleSide }) };
}

/** A fruit bush: a bush with visible berries, so food is findable. */
function buildFruitBush(detail: number): PropAssets {
  const bush = buildBush(detail, 0x446d2b);

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
  /*
   * Every vertex takes the instance tint. Nothing built through this path wants
   * to opt out — but the attribute has to be present regardless, because the
   * shader declares it unconditionally and a missing attribute reads as zero,
   * which would silently strip the tint from grass and fruit bushes instead of
   * throwing.
   */
  merged.setAttribute(
    'aTintMask',
    new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3).fill(1), 1),
  );
  merged.computeBoundingSphere();
  return merged;
}

/**
 * A fern: a rosette of arching compound fronds.
 *
 * Each frond is a rachis with leaflets paired along it, which is what makes a
 * fern a fern — the old version was a rosette of long thin *boxes*, and a box has
 * no fern in it at all. The arch is built by stepping along the frond and dropping
 * each pair a little lower than the last, so the tip bows towards the ground the
 * way a real frond does under its own weight.
 */
function buildFern(detail: number): PropAssets {
  const fronds = detail >= 2 ? 8 : detail >= 1 ? 6 : 4;
  const leaflets = detail >= 2 ? 7 : detail >= 1 ? 5 : 3;
  const parts: MergePart[] = [];
  const shades = [0x54903a, 0x437a2b, 0x3a6a24, 0x4d8330];

  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + (i % 2) * 0.22;
    const length = 0.95 + (i % 3) * 0.28;

    // The rachis: a thin stem arching out and up from the crown.
    const rachis = new THREE.CylinderGeometry(0.012, 0.022, length, 3);
    rachis.translate(0, length * 0.5, 0);
    rachis.rotateZ(1.02);
    rachis.rotateY(-a);
    rachis.translate(0, 0.14, 0);
    parts.push({ geometry: rachis, color: new THREE.Color(0x46702a) });

    for (let j = 0; j < leaflets; j++) {
      const t = (j + 1) / (leaflets + 1);
      // Along the arch: out with sin, up-then-over with a bowed profile.
      const along = Math.sin(1.02) * length * t;
      const height = 0.14 + Math.cos(1.02) * length * t - t * t * length * 0.34;
      // Leaflets shorten towards the tip.
      const size = (0.3 + (1 - t) * 0.24) * (detail >= 1 ? 1 : 0.8);

      for (const side of [-1, 1]) {
        const leaflet = leafGeometry(size, size * 0.42, size * 0.3);
        // Splay out sideways from the rachis, angled back towards the tip.
        leaflet.rotateY(side * 1.15);
        leaflet.rotateZ(-0.25);
        leaflet.rotateY(-a);
        leaflet.translate(Math.cos(a) * along, height, Math.sin(a) * along);
        parts.push({
          geometry: leaflet,
          color: new THREE.Color(shades[(i + j) % shades.length]),
        });
      }
    }
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
function bladeGeometry(
  width: number,
  height: number,
  lean: number,
  segments = 4,
  /**
   * Optional root-to-tip colour ramp, written straight into a vertex colour
   * attribute.
   *
   * This is the single detail that most separates convincing grass from a green
   * carpet, and it is not a lighting effect — it is the plant. A blade is shaded
   * and often bluer at the base, where it is buried among its neighbours, and
   * lighter and more yellow at the tip, where it is new growth in full sun. Bake
   * that in and a mass of blades gets depth from its own colour before a single
   * light touches it.
   */
  ramp?: { base: number; tip: number },
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const base = ramp ? new THREE.Color(ramp.base) : null;
  const tip = ramp ? new THREE.Color(ramp.tip) : null;
  const shade = new THREE.Color();

  const push = (x: number, y: number, t: number) => {
    positions.push(x, y, 0);
    if (base && tip) {
      // Biased towards the tip colour so the light band is the wider one, which
      // is what makes a field read as sunlit rather than as dying.
      shade.copy(base).lerp(tip, Math.pow(t, 0.65));
      colors.push(shade.r, shade.g, shade.b);
    }
  };

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
    push(x0 - w0, y0, t0);
    push(x0 + w0, y0, t0);
    push(x1 + w1, y1, t1);
    push(x0 - w0, y0, t0);
    push(x1 + w1, y1, t1);
    push(x1 - w1, y1, t1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors.length === positions.length) {
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Grass: a tuft of leaning blades fanned around the origin.
 *
 * Exported because the dense near-field grass (GrassField) streams its own
 * instances around the camera rather than drawing from the scattered prop list,
 * and both have to use the same tuft or the two would visibly disagree at the
 * boundary between them.
 */
export function buildGrassTuftGeometry(lod: 'near' | 'far' = 'near'): THREE.BufferGeometry {
  /*
   * Tall, arching, gradient blades.
   *
   * The earlier version was fifteen-centimetre stubs, on the reasoning that
   * ankle-height cover is what a rainforest floor has. It is, and it looked like
   * a mown lawn with sprigs on it. Real ground cover — and the look this is
   * matching — is knee-to-waist height on the things walking through it, dense
   * enough that individual blades overlap into a continuous mass, and lit from
   * within by a root-to-tip colour ramp rather than by shading alone.
   *
   * Three things carry that, in order of how much they matter:
   *   1. **Height.** Blades reach half a metre. Everything else is cosmetic if
   *      the grass is too short to be grass.
   *   2. **The colour ramp**, baked per vertex — see bladeGeometry.
   *   3. **The arch.** Three segments rather than two, and a much stronger lean,
   *      so a blade bows over under its own weight instead of standing up like a
   *      spike. Two segments cannot describe a curve.
   *
   * ## The gameplay cost, which is real
   *
   * Grass this tall genuinely hides animals, and this is a game about spotting
   * animals. That cuts both ways and mostly in a good direction — cover is the
   * survivor's whole toolkit and the hunter is supposed to have a hard problem —
   * but it is a balance change, not just a visual one, and worth naming.
   * Mitigated by the height *variance* below: a tuft is a mix of tall and short
   * blades, and the field thins over open ground, so nothing is uniformly buried.
   */
  const parts: THREE.BufferGeometry[] = [];

  /*
   * ## Two tiers, and the short one is the one that matters
   *
   * The previous tuft was seven tall blades fanned from a single point, and at
   * field density it produced exactly the wrong picture: a flat green plane with
   * isolated sprays of big blades standing on it, like cutlery in a lawn. The
   * diagnosis is that a tuft built from one tier can only be one of two things —
   * tall and see-through, or short and invisible — and ground cover needs to be
   * both at once.
   *
   * So a tuft is now a *clump*:
   *
   *   • a **skirt** of short blades splayed outward over the full circle, which
   *     is what actually hides the ground. These are the ones doing the work of
   *     making the floor read as overgrown rather than painted. Two segments
   *     each, because a 20 cm blade does not need a curve.
   *   • a **spray** of tall arching blades over about 130° of one side, which is
   *     what gives the field silhouette and movement.
   *
   * The skirt is spread to a 20 cm radius rather than sprouting from the origin.
   * That single number roughly quadruples the ground each instance covers for no
   * extra triangles at all, and it is what closes the gaps between neighbours:
   * at ~5 tufts/m² the skirts of adjacent clumps now overlap instead of leaving
   * bare floor between them.
   */
  /*
   * ## The far variant, and why the count is what changes
   *
   * Covering the ground out to seventy metres at this density means well over a
   * hundred thousand tufts, and at sixty-odd triangles each that is seven million
   * triangles of grass — enough to matter even on a good card.
   *
   * The lever that costs nothing visually is blade *count*, not tuft count.
   * Beyond twenty-five metres or so a whole tuft is a few pixels tall, so the
   * individual blades are not resolvable and their only contribution is the
   * overall mass and colour of the clump. A far tuft therefore keeps the same
   * footprint and the same colour ramp with a third of the blades: the field
   * still reads as continuous cover to the horizon, and the triangle budget goes
   * where the player can actually see detail.
   *
   * Reducing the *density* at range instead would be the wrong trade, because
   * perspective means a distant square metre occupies fewer pixels — thinning it
   * shows up immediately as a bald patch, while thinning each clump does not.
   */
  const far = lod === 'far';
  const skirt = far ? 4 : 7;
  for (let i = 0; i < skirt; i++) {
    // Full circle, golden-angle stepped so the spread does not form a visible
    // ring of evenly spaced spokes.
    const a = i * 2.39996 + 0.7;
    const reach = 0.09 + (i % 3) * 0.055;
    const height = 0.15 + (i % 4) * 0.032;
    const blade = bladeGeometry(0.045 + (i % 2) * 0.02, height, 0.2 + (i % 3) * 0.06, 2, {
      base: i % 2 === 0 ? 0x22441a : 0x1c3a16,
      tip: i % 3 === 0 ? 0x6b9c37 : 0x5c8c30,
    });
    blade.rotateY(a);
    blade.translate(Math.cos(a) * reach, 0, Math.sin(a) * reach);
    parts.push(blade);
  }

  const blades = far ? 3 : 5;
  for (let i = 0; i < blades; i++) {
    /*
     * A one-sided clump, not a rosette.
     *
     * Fanning the blades over the full circle — which a golden-angle spread does —
     * makes every tuft radially symmetric, and a field of radially symmetric tufts
     * reads as a scattering of little green stars. Real grass grows as a clump
     * leaning one way. Spreading over about 130° instead, with the instance's own
     * random rotation deciding which way that is, gives clumps that lean in
     * different directions across the field and interlock rather than dot it.
     */
    const a = (i / (blades - 1) - 0.5) * 2.3 + (i % 2) * 0.24;
    /*
     * Deliberately unequal. Identical blades make a tidy little rosette, and at
     * this density a field of tidy rosettes reads as a repeating pattern — the
     * eye finds the repeat immediately.
     */
    const tall = i === 0 ? 1.0 : i === 1 ? 0.8 : i === 3 ? 0.64 : 0.52 + (i % 3) * 0.13;
    const height = 0.5 * tall;
    const blade = bladeGeometry(
      // Narrower than before. The old 5–7 cm blade was legible as an individual
      // leaf at close range, which is precisely what stops a field reading as
      // grass; the mass has to come from count, not from blade area.
      0.036 + (i % 2) * 0.012,
      height,
      // Taller blades bow further over, as they do under their own weight.
      (0.18 + (i % 3) * 0.08) * tall,
      3,
      {
        // Shaded blue-green at the base, sunlit yellow-green at the tip.
        base: i % 2 === 0 ? 0x24491c : 0x1f4019,
        tip: i % 3 === 0 ? 0x8cba46 : i % 3 === 1 ? 0x6da236 : 0x7cae3e,
      },
    );
    blade.rotateY(a);
    blade.translate(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
    parts.push(blade);
  }

  // One broad low leaf: rainforest floor is not a lawn, it is grass interleaved
  // with wider low-growing foliage, and one broad blade among the narrow ones is
  // what carries that read. Kept even on the far variant: it is a single quad and
  // it is the widest thing in the clump, so it does more for a distant tuft's
  // mass than any of the narrow blades.
  const broad = bladeGeometry(0.13, 0.24, 0.14, 2, { base: 0x25491b, tip: 0x5d9432 });
  broad.rotateZ(-0.5);
  broad.rotateY(1.7);
  broad.translate(0.06, 0, 0.02);
  parts.push(broad);

  const merged = concatGeometries(parts);
  for (const g of parts) g.dispose();
  return merged;
}

/**
 * A flower: a stem, a couple of leaves and a ring of petals.
 *
 * The petals are deliberately near-white. The instance tint multiplies the
 * vertex colour, so leaving them white is what lets one shared geometry produce
 * red, yellow, purple and pink flowers across the map — see FLOWER_PALETTE.
 */
function buildFlower(): PropAssets {
  const parts: MergePart[] = [];

  // Green parts stay green whatever colour this instance's petals are.
  const stem = new THREE.CylinderGeometry(0.012, 0.02, 0.42, 3);
  stem.translate(0, 0.21, 0);
  parts.push({ geometry: stem, color: new THREE.Color(0x3f6a24), tintable: false });

  // Two low leaves, so the flower has something at ground level.
  for (const side of [-1, 1]) {
    const leaf = bladeGeometry(0.09, 0.2, 0.13 * side);
    leaf.rotateY(side > 0 ? 0.6 : 2.4);
    parts.push({ geometry: leaf, color: new THREE.Color(0x477a28), tintable: false });
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
 * A tall flowering spike: a stem, a few leaves, and a dense plume of florets.
 *
 * Built from small quads stacked up a vertical axis and fanned around it, tapering
 * to a point — the celosia/ginger silhouette. The florets are near-white so the
 * per-instance tint *is* the flower's colour, the same trick the ground flowers
 * use: one shared geometry, four drift colours.
 *
 * The plume is dense on purpose. A spike read from across a clearing is a solid
 * block of colour with a shape, and a sparse one just looks like a dead stick with
 * some confetti stuck to it.
 */
function buildFlowerSpike(detail: number): PropAssets {
  const parts: MergePart[] = [];

  // Stem and leaves opt out of the instance tint: they are green plants, not
  // parts of the flower, and multiplying them by a saturated plume colour turned
  // the stem black and the leaves magenta. See injectTintMask.
  const stem = new THREE.CylinderGeometry(0.012, 0.022, 0.72, 3);
  stem.translate(0, 0.36, 0);
  parts.push({ geometry: stem, color: new THREE.Color(0x4a7a2c), tintable: false });

  // A couple of long leaves low on the stem.
  for (const side of [-1, 1]) {
    const leaf = bladeGeometry(0.075, 0.34, 0.16 * side, 3);
    leaf.rotateZ(-0.7);
    leaf.rotateY(side > 0 ? 0.5 : 2.5);
    leaf.translate(0, 0.1, 0);
    parts.push({ geometry: leaf, color: new THREE.Color(0x4c8730), tintable: false });
  }

  /*
   * The plume: rings of florets up the top third, narrowing to a tip.
   *
   * Many small florets, not a few big ones. The first version used 5×7 cm cards
   * four to a ring, which is the right *silhouette* and completely the wrong
   * texture: from a couple of metres away each card is individually legible and
   * the spike reads as a stack of coloured tiles on a stick. A flowering spike
   * is supposed to be a soft mass with an edge you cannot quite resolve, and the
   * only way to get that out of flat cards is to make them small enough that no
   * single one draws the eye.
   *
   * So: roughly twice the rings, half again the florets per ring, and each one
   * about a third of the area. That is 84 quads against 36 — but they are only
   * ever drawn within 95 m and there are about a thousand on screen, so the cost
   * is a rounding error next to the canopy.
   */
  const rings = detail >= 2 ? 14 : detail >= 1 ? 10 : 5;
  const perRing = detail >= 1 ? 6 : 3;
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    const y = 0.58 + t * 0.46;
    // Widest a third of the way up, tapering to nothing at the tip.
    const radius = 0.072 * Math.sin(Math.min(1, t * 1.25 + 0.18) * Math.PI * 0.85);
    for (let i = 0; i < perRing; i++) {
      // Golden-angle offset per ring, so the florets interleave up the spike
      // instead of stacking into visible vertical columns.
      const a = (i / perRing) * Math.PI * 2 + r * 2.39996;
      const floret = new THREE.PlaneGeometry(0.03, 0.042);
      // Tip each one outward a little: a plume of strictly vertical cards
      // silhouettes as a rectangle no matter how many you use.
      floret.rotateX(-0.35);
      floret.rotateY(-a);
      floret.translate(Math.cos(a) * radius, y, Math.sin(a) * radius);
      parts.push({ geometry: floret, color: new THREE.Color(0xffffff) });
    }
  }

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
  const parts: MergePart[] = [];
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
  const parts: MergePart[] = [];
  /*
   * A thicket, not a spray.
   *
   * This is the only cover a submerged crocodile has, so it has to actually
   * occlude — nine fronds from a single point is a shape you can see straight
   * between, which makes "hide in the weed" a fiction. Eighteen fronds over two
   * staggered rings of different heights build a clump you can lose an animal
   * inside, and they are still only 4 triangles each.
   *
   * The inner ring is full height and the outer ring is shorter and splayed
   * further, so a bed of these reads as a mound rather than as a set of columns.
   */
  const rings = [
    { count: 9, radius: 0.16, height: 1, lean: 0.42, width: 0.3 },
    { count: 9, radius: 0.42, height: 0.68, lean: 0.72, width: 0.24 },
  ];
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let i = 0; i < ring.count; i++) {
      const a = i * 2.399963 + r * 0.7;
      // Unit height, so scaleAxes maps Y directly to metres of depth.
      const frond = bladeGeometry(
        ring.width,
        ring.height,
        ring.lean + (i % 3) * 0.16,
        4,
      );
      frond.rotateY(a);
      frond.translate(Math.cos(a) * ring.radius, 0, Math.sin(a) * ring.radius);
      parts.push({
        geometry: frond,
        // Deep, desaturated greens: underwater light loses red first, and weed
        // that is as bright as grass looks like grass someone flooded.
        color: new THREE.Color(i % 3 === 0 ? 0x244a2f : i % 3 === 1 ? 0x1b3d29 : 0x2b5236),
      });
    }
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
  const parts: MergePart[] = [];
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
  const parts: MergePart[] = [];
  const rope = new THREE.CylinderGeometry(0.05, 0.04, 5.5, 4);
  rope.translate(0, -2.75, 0);
  parts.push({ geometry: rope, color: new THREE.Color(0x466a2a) });
  for (let i = 0; i < 4; i++) {
    const leaf = new THREE.PlaneGeometry(0.3, 0.22);
    leaf.translate(0.15, -1 - i * 1.2, 0);
    parts.push({ geometry: leaf, color: new THREE.Color(0x53883a) });
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
  const parts: MergePart[] = [];
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
  const parts: MergePart[] = [];
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
  const parts: MergePart[] = [];
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
