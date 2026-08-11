/**
 * Terrain.ts — the shape of the Amazon basin.
 *
 * Built deterministically from a seed on both the authority server and every
 * client. The heightfield is baked into a grid once, then sampled with bilinear
 * interpolation, which keeps per-frame queries (hundreds of animals asking
 * "how high is the ground here?") cheap.
 *
 * The river network is the gameplay-critical feature: crocodiles and capybaras
 * both want to be near water, so rivers are carved first and the rest of the
 * terrain is fitted around them.
 */

import { Noise2D, clamp, clamp01, lerp, smoothstep } from '../Systems/Noise';
import { Rng } from '../Systems/Rng';
import {
  DEEP_WATER_DEPTH,
  TERRAIN_GRID,
  TERRAIN_HEIGHT,
  WATER_LEVEL,
  WORLD_SIZE,
} from '../Systems/Config';

/** Ground classification, used to pick foliage, footstep sounds and AI goals. */
export enum GroundType {
  Jungle = 0,
  Clearing = 1,
  RiverBank = 2,
  ShallowWater = 3,
  DeepWater = 4,
  Rock = 5,
  Mud = 6,
}

/** A meandering river centre-line, described as a polyline. */
export interface RiverPath {
  points: { x: number; z: number }[];
  width: number;
  /** Flow direction hint for water shading and current. */
  flow: number;
}

export interface Clearing {
  x: number;
  z: number;
  radius: number;
}

/** A disc that spawn sampling is restricted to. */
export interface SpawnArea {
  x: number;
  z: number;
  radius: number;
}

const HALF = WORLD_SIZE / 2;

export class Terrain {
  readonly seed: number;
  readonly size = WORLD_SIZE;
  readonly grid = TERRAIN_GRID;
  readonly cellSize = WORLD_SIZE / (TERRAIN_GRID - 1);
  readonly waterLevel = WATER_LEVEL;

  /** Baked height per grid vertex. */
  private heights: Float32Array;
  /** Baked "how close is the nearest river centre" field, 0 = on the centre. */
  private riverField: Float32Array;
  /** Baked foliage density multiplier, 0 = bare, 1 = dense jungle. */
  private foliage: Float32Array;

  readonly rivers: RiverPath[] = [];
  readonly clearings: Clearing[] = [];

  private readonly baseNoise: Noise2D;
  private readonly detailNoise: Noise2D;
  private readonly foliageNoise: Noise2D;

  /**
   * River segments bucketed into a coarse grid.
   *
   * The bake asks "how far is the nearest river?" once per grid vertex, which at
   * this world size is a hundred thousand queries against roughly a hundred and
   * forty segments. Testing every segment every time is fourteen million
   * point-to-segment distances and turns world generation into a visible stall.
   * Since a river only influences terrain within a couple of channel widths, each
   * segment is registered in the cells it can possibly reach and a query only
   * examines its own cell — a handful of segments instead of all of them.
   */
  private readonly riverSegs: { ax: number; az: number; bx: number; bz: number; width: number }[] =
    [];
  private riverBuckets: number[][] = [];
  private readonly riverCell = 40;
  private riverCols = 1;

  constructor(seed: number) {
    this.seed = seed;
    this.baseNoise = new Noise2D(seed ^ 0x1111);
    this.detailNoise = new Noise2D(seed ^ 0x2222);
    this.foliageNoise = new Noise2D(seed ^ 0x3333);

    const rng = new Rng(seed ^ 0x4444);
    this.generateRivers(rng);
    this.buildRiverIndex();
    this.generateClearings(rng);

    const n = TERRAIN_GRID * TERRAIN_GRID;
    this.heights = new Float32Array(n);
    this.riverField = new Float32Array(n);
    this.foliage = new Float32Array(n);
    this.bake();
  }

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  /**
   * One large river crossing the whole map plus a few tributaries feeding into
   * it. Tributaries start at a random point on the main river and wander off,
   * which produces the branching delta look without any hydrology simulation.
   */
  private generateRivers(rng: Rng): void {
    // Main river: enters on one edge, exits roughly on the opposite edge.
    const entryAngle = rng.range(0, Math.PI * 2);
    const start = {
      x: Math.cos(entryAngle) * HALF * 1.05,
      z: Math.sin(entryAngle) * HALF * 1.05,
    };
    const end = {
      x: Math.cos(entryAngle + Math.PI + rng.range(-0.6, 0.6)) * HALF * 1.05,
      z: Math.sin(entryAngle + Math.PI + rng.range(-0.6, 0.6)) * HALF * 1.05,
    };
    const main = this.meander(start, end, rng, 26, 46);
    this.rivers.push({ points: main, width: rng.range(20, 27), flow: entryAngle + Math.PI });

    // Tributaries branch off the main channel.
    const tributaries = rng.int(2, 4);
    for (let i = 0; i < tributaries; i++) {
      const anchorIdx = rng.int(4, main.length - 5);
      const anchor = main[anchorIdx];
      const outAngle = rng.range(0, Math.PI * 2);
      const len = rng.range(HALF * 0.45, HALF * 0.95);
      const target = {
        x: clamp(anchor.x + Math.cos(outAngle) * len, -HALF * 1.05, HALF * 1.05),
        z: clamp(anchor.z + Math.sin(outAngle) * len, -HALF * 1.05, HALF * 1.05),
      };
      const pts = this.meander(anchor, target, rng, 14, 30);
      this.rivers.push({ points: pts, width: rng.range(7, 13), flow: outAngle + Math.PI });
    }
  }

  /** Build a wandering polyline between two points. */
  private meander(
    from: { x: number; z: number },
    to: { x: number; z: number },
    rng: Rng,
    amplitude: number,
    segments: number,
  ): { x: number; z: number }[] {
    const pts: { x: number; z: number }[] = [];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    // Perpendicular direction, used to push points sideways.
    const px = -dz / len;
    const pz = dx / len;
    // Two out-of-phase sine waves plus noise gives a natural-looking meander.
    const phase1 = rng.range(0, Math.PI * 2);
    const phase2 = rng.range(0, Math.PI * 2);
    const freq1 = rng.range(1.4, 2.8);
    const freq2 = rng.range(3.1, 5.4);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      // Taper the wobble at the ends so joins with the parent river stay smooth.
      const taper = Math.sin(t * Math.PI) ** 0.6;
      const offset =
        (Math.sin(phase1 + t * Math.PI * 2 * freq1) * 0.7 +
          Math.sin(phase2 + t * Math.PI * 2 * freq2) * 0.3) *
        amplitude *
        taper;
      pts.push({
        x: lerp(from.x, to.x, t) + px * offset,
        z: lerp(from.z, to.z, t) + pz * offset,
      });
    }
    return pts;
  }

  /** Sunlit clearings — visually striking, and dangerously exposed. */
  private generateClearings(rng: Rng): void {
    const count = rng.int(7, 11);
    for (let i = 0; i < count; i++) {
      const p = rng.inCircle(HALF * 0.85);
      this.clearings.push({ x: p.x, z: p.y, radius: rng.range(16, 34) });
    }
  }

  /**
   * Flatten every river into segments and register each one in the grid cells it
   * can influence.
   *
   * "Can influence" is the bank distance — `width * 2.6` — since beyond that
   * `rawHeight` ignores the river entirely. Registering a segment in a slightly
   * generous box is harmless; missing one would carve a visible notch out of a
   * riverbank, so the box is expanded by a whole cell for safety.
   */
  private buildRiverIndex(): void {
    for (const river of this.rivers) {
      const pts = river.points;
      for (let i = 0; i < pts.length - 1; i++) {
        this.riverSegs.push({
          ax: pts[i].x,
          az: pts[i].z,
          bx: pts[i + 1].x,
          bz: pts[i + 1].z,
          width: river.width,
        });
      }
    }

    this.riverCols = Math.ceil(WORLD_SIZE / this.riverCell) + 1;
    this.riverBuckets = Array.from({ length: this.riverCols * this.riverCols }, () => []);

    for (let s = 0; s < this.riverSegs.length; s++) {
      const seg = this.riverSegs[s];
      const reach = seg.width * 2.6 + this.riverCell;
      const minX = Math.min(seg.ax, seg.bx) - reach;
      const maxX = Math.max(seg.ax, seg.bx) + reach;
      const minZ = Math.min(seg.az, seg.bz) - reach;
      const maxZ = Math.max(seg.az, seg.bz) + reach;
      const i0 = this.riverCellIndex(minX);
      const i1 = this.riverCellIndex(maxX);
      const j0 = this.riverCellIndex(minZ);
      const j1 = this.riverCellIndex(maxZ);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          this.riverBuckets[j * this.riverCols + i].push(s);
        }
      }
    }
  }

  private riverCellIndex(v: number): number {
    return clamp(Math.floor((v + HALF) / this.riverCell), 0, this.riverCols - 1);
  }

  /** Distance from a point to the nearest river centre-line, in metres. */
  private distanceToRiver(x: number, z: number): { dist: number; width: number } {
    const i = this.riverCellIndex(x);
    const j = this.riverCellIndex(z);
    const bucket = this.riverBuckets[j * this.riverCols + i];
    let best = Infinity;
    let bestWidth = 12;
    for (let k = 0; k < bucket.length; k++) {
      const seg = this.riverSegs[bucket[k]];
      const abx = seg.bx - seg.ax;
      const abz = seg.bz - seg.az;
      const lenSq = abx * abx + abz * abz || 1e-6;
      // Project the point onto the segment, clamped to its extent.
      const t = clamp01(((x - seg.ax) * abx + (z - seg.az) * abz) / lenSq);
      const cx = seg.ax + abx * t;
      const cz = seg.az + abz * t;
      const d = Math.hypot(x - cx, z - cz);
      if (d < best) {
        best = d;
        bestWidth = seg.width;
      }
    }
    return { dist: best, width: bestWidth };
  }

  /** Continuous terrain height function, before baking. */
  private rawHeight(x: number, z: number): { h: number; riverT: number } {
    const nx = x / WORLD_SIZE;
    const nz = z / WORLD_SIZE;

    // Rolling base relief.
    let h = this.baseNoise.fbm(nx * 3.1, nz * 3.1, 5) * 0.5 + 0.5;
    h = Math.pow(h, 1.25);

    // A couple of ridges for silhouette interest.
    const ridge = this.baseNoise.ridged(nx * 2.2 + 11, nz * 2.2 - 7, 3);
    h = h * 0.78 + ridge * 0.34;

    // Fine detail.
    h += this.detailNoise.fbm(nx * 14, nz * 14, 3) * 0.045;

    let height = h * TERRAIN_HEIGHT;

    // Carve the river valleys.
    const { dist, width } = this.distanceToRiver(x, z);
    /*
     * Carve the channel.
     *
     * ## Why the bed is flat rather than V-shaped
     *
     * The floor was already set about 3.4 m below the water line, so on paper
     * the river was deep — but `pow(riverT, 1.6)` reached that depth only on the
     * exact centre-line and fell away fast, which made the channel a narrow
     * V. In play almost the whole width of the river was ankle-deep and only a
     * thin thread down the middle was swimmable, so "go underwater as a
     * crocodile" meant finding and staying on a line you could not see.
     *
     * Two changes make the depth mean something:
     *
     *  • the full-depth core now runs out to 0.85 of the channel width rather
     *    than 0.5, so most of the river *is* the deep part;
     *  • the profile exponent drops below 1, which bows the cross-section into a
     *    U — the bed stays near its floor and then turns up sharply at the
     *    banks, instead of sloping continuously from the middle.
     *
     * The target is roughly 3.5 m of water over the bed for a 0.5 m animal:
     * deep enough to swim in, to submerge in, and to grow weed tall enough to
     * hide a crocodile, while the banks still shelve up quickly enough that
     * walking into the river is a decision rather than an accident.
     */
    const bank = width * 2.6;
    const riverT = 1 - smoothstep(width * 0.85, bank, dist);
    if (riverT > 0) {
      // Channel floor sits below the water line; banks blend into the terrain.
      // The width term keeps the main channel a little deeper than its
      // tributaries, which is both true of rivers and useful: the big river is
      // the one worth swimming down.
      const channelDepth = WATER_LEVEL - 3.5 - width * 0.04;
      const carve = Math.pow(riverT, 0.65);
      height = lerp(height, channelDepth, carve);
    }

    // Flatten clearings a little so they read as usable open ground.
    for (const c of this.clearings) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.radius * 1.4) {
        const t = 1 - smoothstep(c.radius * 0.6, c.radius * 1.4, d);
        const target = this.sampleSmoothBase(c.x, c.z);
        height = lerp(height, target, t * 0.55);
      }
    }

    // Raise the outer rim into impassable hills so players cannot walk off-map.
    const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
    if (edge > 0.86) {
      const t = smoothstep(0.86, 1.06, edge);
      height = lerp(height, TERRAIN_HEIGHT * 1.75, t);
    }

    return { h: height, riverT };
  }

  /** Coarse height used as a flattening target for clearings. */
  private sampleSmoothBase(x: number, z: number): number {
    const nx = x / WORLD_SIZE;
    const nz = z / WORLD_SIZE;
    const h = this.baseNoise.fbm(nx * 3.1, nz * 3.1, 3) * 0.5 + 0.5;
    return Math.pow(h, 1.25) * TERRAIN_HEIGHT * 0.85 + 1.2;
  }

  /** Bake the heightfield, river proximity and foliage density grids. */
  private bake(): void {
    for (let j = 0; j < TERRAIN_GRID; j++) {
      for (let i = 0; i < TERRAIN_GRID; i++) {
        const idx = j * TERRAIN_GRID + i;
        const x = -HALF + i * this.cellSize;
        const z = -HALF + j * this.cellSize;
        const { h, riverT } = this.rawHeight(x, z);
        this.heights[idx] = h;
        this.riverField[idx] = riverT;

        // Foliage: dense jungle by default, thinner near water, bare in
        // clearings and on steep rock.
        let density = this.foliageNoise.fbm((x / WORLD_SIZE) * 6.5, (z / WORLD_SIZE) * 6.5, 4) * 0.5 + 0.5;
        density = clamp01(density * 1.25);
        density *= 1 - riverT * 0.85;
        for (const c of this.clearings) {
          const d = Math.hypot(x - c.x, z - c.z);
          density *= smoothstep(c.radius * 0.35, c.radius * 1.25, d);
        }
        if (h < WATER_LEVEL + 0.15) density *= 0.15;
        this.foliage[idx] = density;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Bilinear sample of a baked grid. */
  private sampleGrid(grid: Float32Array, x: number, z: number): number {
    const fx = (x + HALF) / this.cellSize;
    const fz = (z + HALF) / this.cellSize;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const i0 = clamp(i, 0, TERRAIN_GRID - 1);
    const j0 = clamp(j, 0, TERRAIN_GRID - 1);
    const i1 = clamp(i + 1, 0, TERRAIN_GRID - 1);
    const j1 = clamp(j + 1, 0, TERRAIN_GRID - 1);
    const h00 = grid[j0 * TERRAIN_GRID + i0];
    const h10 = grid[j0 * TERRAIN_GRID + i1];
    const h01 = grid[j1 * TERRAIN_GRID + i0];
    const h11 = grid[j1 * TERRAIN_GRID + i1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** Ground height at a world position. */
  heightAt(x: number, z: number): number {
    return this.sampleGrid(this.heights, x, z);
  }

  /** How strongly this point belongs to a river channel (0..1). */
  riverAt(x: number, z: number): number {
    return this.sampleGrid(this.riverField, x, z);
  }

  /** Foliage density multiplier at a point (0..1). */
  foliageAt(x: number, z: number): number {
    return this.sampleGrid(this.foliage, x, z);
  }

  /** Depth of water above the ground, 0 on dry land. */
  waterDepthAt(x: number, z: number): number {
    return Math.max(0, WATER_LEVEL - this.heightAt(x, z));
  }

  isWater(x: number, z: number): boolean {
    return this.heightAt(x, z) < WATER_LEVEL;
  }

  isDeepWater(x: number, z: number): boolean {
    return this.waterDepthAt(x, z) >= DEEP_WATER_DEPTH;
  }

  /** Walkable surface height: the water line when submerged, else the ground. */
  surfaceAt(x: number, z: number): number {
    const h = this.heightAt(x, z);
    return h < WATER_LEVEL ? WATER_LEVEL : h;
  }

  /** Terrain normal, via central differences on the baked grid. */
  normalAt(x: number, z: number, out: { x: number; y: number; z: number }): void {
    const e = this.cellSize;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    const nx = hl - hr;
    const nz = hd - hu;
    const ny = 2 * e;
    const len = Math.hypot(nx, ny, nz) || 1;
    out.x = nx / len;
    out.y = ny / len;
    out.z = nz / len;
  }

  /** Slope steepness in radians (0 = flat). */
  slopeAt(x: number, z: number): number {
    const n = { x: 0, y: 1, z: 0 };
    this.normalAt(x, z, n);
    return Math.acos(clamp(n.y, -1, 1));
  }

  /** Classify the ground for footsteps, foliage placement and AI preferences. */
  groundTypeAt(x: number, z: number): GroundType {
    const depth = this.waterDepthAt(x, z);
    if (depth >= DEEP_WATER_DEPTH) return GroundType.DeepWater;
    if (depth > 0.02) return GroundType.ShallowWater;
    const river = this.riverAt(x, z);
    if (river > 0.32) return GroundType.RiverBank;
    if (this.slopeAt(x, z) > 0.72) return GroundType.Rock;
    if (this.foliageAt(x, z) < 0.22) return GroundType.Clearing;
    return GroundType.Jungle;
  }

  /** True if a point is inside the playable area (not the impassable rim). */
  inBounds(x: number, z: number): boolean {
    return Math.max(Math.abs(x), Math.abs(z)) < HALF * 0.9;
  }

  /** Clamp a position back into the playable area. */
  clampToBounds(p: { x: number; z: number }): void {
    const lim = HALF * 0.89;
    p.x = clamp(p.x, -lim, lim);
    p.z = clamp(p.z, -lim, lim);
  }

  /**
   * A disc to draw spawn positions from.
   *
   * Passed down from the round's storm circle so that nothing — no player, no AI
   * animal — is ever spawned into the storm. Spawning outside the circle is not
   * a slightly worse start, it is a death sentence delivered before the player
   * has pressed a key.
   */
  static readonly WHOLE_MAP: SpawnArea = { x: 0, z: 0, radius: HALF * 0.86 };

  /**
   * Find a position matching a predicate by rejection sampling.
   * Deterministic given the rng, and always returns something.
   */
  findPosition(
    rng: Rng,
    predicate: (x: number, z: number) => boolean,
    attempts = 90,
    area: SpawnArea = Terrain.WHOLE_MAP,
  ): { x: number; z: number } {
    // Keep clear of the very edge of the disc so an animal that wanders a few
    // metres in the first seconds is not immediately in the storm.
    const radius = Math.min(area.radius * 0.92, HALF * 0.86);
    let fallback = { x: area.x, z: area.z };
    for (let i = 0; i < attempts; i++) {
      const p = rng.inCircle(radius);
      const x = area.x + p.x;
      const z = area.z + p.y;
      if (i === 0) fallback = { x, z };
      if (predicate(x, z)) return { x, z };
    }
    return fallback;
  }

  /** A dry, gently sloped spot — used for land-animal spawns. */
  findLandPosition(rng: Rng, area?: SpawnArea): { x: number; z: number } {
    return this.findPosition(
      rng,
      (x, z) => !this.isWater(x, z) && this.slopeAt(x, z) < 0.5 && this.inBounds(x, z),
      90,
      area,
    );
  }

  /**
   * A dry spot with cover overhead.
   *
   * Used for player spawns specifically. Dropping a survivor into a bare
   * clearing at the start of a round is close to a death sentence — and it also
   * makes a terrible first impression, because the player's opening view is an
   * empty field rather than a rainforest. Requiring foliage means you always
   * start the round already hidden, with something to orient by.
   */
  findShelteredPosition(rng: Rng, area?: SpawnArea): { x: number; z: number } {
    // Two passes: insist on real cover first, then relax rather than fail.
    const strict = this.findPosition(
      rng,
      (x, z) =>
        !this.isWater(x, z) &&
        this.slopeAt(x, z) < 0.42 &&
        this.inBounds(x, z) &&
        this.foliageAt(x, z) > 0.45,
      120,
      area,
    );
    if (this.foliageAt(strict.x, strict.z) > 0.45) return strict;
    return this.findLandPosition(rng, area);
  }

  /** A point in deep water — used for crocodiles, fish and anacondas. */
  findWaterPosition(rng: Rng, area?: SpawnArea): { x: number; z: number } {
    const found = this.findPosition(
      rng,
      (x, z) => this.isDeepWater(x, z) && this.inBounds(x, z),
      120,
      area,
    );
    // A circle can legitimately contain only shallow water. Rather than drop a
    // caiman on a hillside, fall back to the shoreline and then to dry land.
    if (this.isDeepWater(found.x, found.z)) return found;
    const shore = this.findShorePosition(rng, area);
    if (this.waterDepthAt(shore.x, shore.z) > 0.05) return shore;
    return this.findLandPosition(rng, area);
  }

  /** A point on the water's edge — where most jungle life congregates. */
  findShorePosition(rng: Rng, area?: SpawnArea): { x: number; z: number } {
    return this.findPosition(
      rng,
      (x, z) => {
        const d = this.waterDepthAt(x, z);
        return d > 0.05 && d < DEEP_WATER_DEPTH && this.inBounds(x, z);
      },
      90,
      area,
    );
  }

  /** Expose the baked heights so the renderer can build a mesh without rebaking. */
  get heightGrid(): Float32Array {
    return this.heights;
  }
}
