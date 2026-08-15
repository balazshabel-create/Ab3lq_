/**
 * WorldGen.ts — scatters the jungle onto the terrain.
 *
 * Split into two passes:
 *   • gameplay props (trees, fruit bushes, fishing spots, huts, bridges, caves)
 *     are generated on both the server and the client from the same seed, since
 *     they collide or can be eaten;
 *   • cosmetic props (grass, ferns, vines, small rocks) are client-only and
 *     scale with the graphics preset.
 */

import { Rng } from '../Systems/Rng';
import { clamp01 } from '../Systems/Noise';
import { BRIDGE_SAG, WORLD_PROPS } from '../Systems/Config';
import { GroundType, Terrain } from './Terrain';

export enum PropKind {
  Tree = 0,
  Bush = 1,
  Fern = 2,
  Grass = 3,
  Rock = 4,
  Log = 5,
  Hut = 6,
  Bridge = 7,
  Cave = 8,
  Vine = 9,
  FruitBush = 10,
  LilyPad = 11,
  Flower = 12,
  /** Tall blades standing in the shallows at the water's edge. */
  Reed = 13,
  /**
   * Weed rooted in the river bed, reaching up towards the surface.
   *
   * Only visible from under the water, which is the entire reason it exists: a
   * submerged crocodile needs somewhere to actually hide, and before this the
   * river bed was a bare brown plane with nothing on it.
   */
  Waterweed = 14,
  /**
   * A tall flowering spike — celosia, ginger, heliconia: the plants that give a
   * clearing its colour.
   *
   * Separate from Flower because it plays a different visual role. Flowers are
   * ground-level punctuation you notice when you look down; spikes stand at knee
   * to waist height and are meant to be seen *across* a clearing, in drifts. They
   * are placed in clumps rather than scattered for exactly that reason.
   */
  FlowerSpike = 15,
}

/** One placed piece of scenery. */
export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  /** Yaw in radians. */
  rot: number;
  /** Uniform scale multiplier. */
  scale: number;
  /** Visual variant index, so the same kind is not visually repetitive. */
  variant: number;
}

/**
 * Trees carry extra data because they block movement and camera booms.
 *
 * (They used to be climbable too; nothing climbs any more, but `branchHeight` is
 * still what vines hang from and what the camera-blocker index uses as the top
 * of the trunk.)
 */
export interface TreeProp extends Prop {
  kind: PropKind.Tree;
  /** Trunk radius at the base, used for collision. */
  radius: number;
  /** Height of the lowest branch: where vines hang from, and the blocker top. */
  branchHeight: number;
  /** Total trunk height. */
  height: number;
}

/** Bridges are walkable platforms over water. */
export interface BridgeProp extends Prop {
  kind: PropKind.Bridge;
  length: number;
  /** Deck height above the water plane. */
  deckHeight: number;
}

export type FoodSourceKind = 'fruit' | 'fish' | 'plant';

/** A refillable food source in the world. */
export interface FoodSource {
  id: number;
  kind: FoodSourceKind;
  x: number;
  y: number;
  z: number;
  /** False while depleted; regrows after a cooldown. */
  available: boolean;
  /** Seconds until it becomes available again. */
  respawnIn: number;
}

/** Everything world generation produces. */
export interface WorldContent {
  trees: TreeProp[];
  bushes: Prop[];
  rocks: Prop[];
  logs: Prop[];
  huts: Prop[];
  bridges: BridgeProp[];
  caves: Prop[];
  foodSources: FoodSource[];
  /** Cosmetic-only, empty when generated headless. */
  cosmetic: Prop[];
}

export interface WorldGenOptions {
  /** Generate grass/ferns/flowers. The server passes false. */
  cosmetic: boolean;
  /** 0..1 multiplier on cosmetic prop counts (graphics preset). */
  cosmeticDensity: number;
}

/**
 * Deterministically populate the world.
 *
 * Placement uses rejection sampling against the terrain's foliage-density
 * field, so trees cluster into thick jungle and thin out along the riverbanks
 * and clearings without any hand authoring.
 */
export function generateWorld(
  terrain: Terrain,
  seed: number,
  options: WorldGenOptions,
): WorldContent {
  const content: WorldContent = {
    trees: [],
    bushes: [],
    rocks: [],
    logs: [],
    huts: [],
    bridges: [],
    caves: [],
    foodSources: [],
    cosmetic: [],
  };

  // Independent streams per category: adding a new prop type must not shift
  // the placement of existing ones (keeps saved seeds stable between builds).
  const treeRng = new Rng(seed).fork('trees');
  const bushRng = new Rng(seed).fork('bushes');
  const rockRng = new Rng(seed).fork('rocks');
  const logRng = new Rng(seed).fork('logs');
  const structRng = new Rng(seed).fork('structures');
  const foodRng = new Rng(seed).fork('food');
  const cosmeticRng = new Rng(seed).fork('cosmetic');

  // --- Trees ---------------------------------------------------------------
  // The canopy giants. Density follows the foliage field; nothing grows in
  // water or on cliffs.
  placeScattered(terrain, treeRng, WORLD_PROPS.trees, 0.34, (x, z, y, rng) => {
    /*
     * Pick the species first, because everything else depends on it.
     *
     * `height` is not decoration: it is what the camera-blocker index uses as the
     * top of the trunk and what vines are hung from. It used to be an independent
     * random number in the 11–32 m range while the mesh was a fixed size — so a
     * vine could be pinned nineteen metres up a tree whose model is six metres
     * tall, and hang there in open sky. Deriving both from the variant's actual
     * model height is what keeps the physics and the picture agreeing.
     *
     * Uniform over the three geometries. `Rng.int` is inclusive, so the obvious
     * `int(0, 3)` yields four values for three variants and hands variant 0 twice
     * the share of the others once the renderer takes it modulo 3 — at four
     * thousand trees that skew reads as one species being oddly common.
     */
    const variant = rng.int(0, 2);
    // Metres, at scale 1, from the model: willow, conifer, broadleaf.
    const MODEL_HEIGHT = [13.5, 17.5, 11.5];
    // Trunk radius at the base, at scale 1, from the same models.
    const MODEL_RADIUS = [0.78, 0.5, 0.85];

    const big = rng.chance(0.16);
    const scale = big ? rng.range(1.5, 2.3) : rng.range(0.75, 1.35);
    const height = MODEL_HEIGHT[variant] * scale;
    content.trees.push({
      kind: PropKind.Tree,
      x,
      y,
      z,
      rot: rng.range(0, Math.PI * 2),
      scale,
      variant,
      radius: MODEL_RADIUS[variant] * scale,
      /*
       * Where the lowest branches actually are on each model: a willow forks low
       * (62% of its height), a conifer's skirt starts higher, and a broadleaf
       * carries its limbs just under the crown.
       */
      branchHeight: height * [0.6, 0.32, 0.7][variant],
      height,
    });
  });

  // --- Bushes: the primary hiding places ----------------------------------
  placeScattered(terrain, bushRng, WORLD_PROPS.bushes, 0.18, (x, z, y, rng) => {
    content.bushes.push({
      kind: PropKind.Bush,
      x,
      y,
      z,
      rot: rng.range(0, Math.PI * 2),
      scale: rng.range(0.8, 1.7),
      variant: rng.int(0, 2),
    });
  });

  // --- Rocks: prefer steep ground and riverbeds ---------------------------
  for (let i = 0; i < WORLD_PROPS.rocks; i++) {
    const p = terrain.findPosition(rockRng, (x, z) => {
      if (!terrain.inBounds(x, z)) return false;
      const g = terrain.groundTypeAt(x, z);
      return g === GroundType.Rock || g === GroundType.RiverBank || rockRng.chance(0.25);
    }, 12);
    content.rocks.push({
      kind: PropKind.Rock,
      x: p.x,
      y: terrain.heightAt(p.x, p.z),
      z: p.z,
      rot: rockRng.range(0, Math.PI * 2),
      scale: rockRng.range(0.6, 2.6),
      variant: rockRng.int(0, 2),
    });
  }

  // --- Fallen logs: cover, and a bridge across narrow streams -------------
  placeScattered(terrain, logRng, WORLD_PROPS.logs, 0.12, (x, z, y, rng) => {
    content.logs.push({
      kind: PropKind.Log,
      x,
      y,
      z,
      rot: rng.range(0, Math.PI * 2),
      scale: rng.range(0.9, 1.8),
      variant: rng.int(0, 1),
    });
  });

  // --- Abandoned huts: landmarks, and the only man-made thing out here ----
  for (let i = 0; i < WORLD_PROPS.huts; i++) {
    const p = terrain.findPosition(structRng, (x, z) => {
      return (
        terrain.inBounds(x, z) &&
        !terrain.isWater(x, z) &&
        terrain.slopeAt(x, z) < 0.28 &&
        terrain.foliageAt(x, z) < 0.7
      );
    }, 60);
    content.huts.push({
      kind: PropKind.Hut,
      x: p.x,
      y: terrain.heightAt(p.x, p.z),
      z: p.z,
      rot: structRng.range(0, Math.PI * 2),
      scale: structRng.range(0.95, 1.25),
      variant: structRng.int(0, 1),
    });
  }

  /*
   * --- Suspension bridges over the rivers --------------------------------
   *
   * These are the only way across a deep channel on foot, which is what makes
   * them matter: the hunter is a man in boots carrying a rifle and cannot swim
   * ten metres of river, so every crossing he makes is at a place the survivors
   * can see, predict and avoid. A bridge is a chokepoint, and a chokepoint is
   * information — the most valuable thing either side has.
   *
   * The span is *measured*, not guessed. The old version used a fixed multiple
   * of the nominal river width and drew a fixed 26 m deck regardless, so on a
   * wide reach it stopped short of the far bank and on a narrow one it ran out
   * over dry land. Walking outwards from the centre until the ground comes back
   * above the water line finds the real banks, whatever the channel is doing
   * there.
   */
  for (const river of terrain.rivers) {
    if (content.bridges.length >= WORLD_PROPS.bridges) break;
    if (river.width < 9 && structRng.chance(0.5)) continue;
    const idx = structRng.int(3, Math.max(3, river.points.length - 4));
    const a = river.points[idx];
    const b = river.points[Math.min(river.points.length - 1, idx + 1)];
    // Perpendicular to the local flow direction.
    const cross = Math.atan2(b.z - a.z, b.x - a.x) + Math.PI / 2;
    const dirX = Math.cos(cross);
    const dirZ = Math.sin(cross);

    /** How far from the river's centre line the bank is, on one side. */
    const reachBank = (sign: number): number => {
      const limit = 90;
      for (let d = 2; d <= limit; d += 1) {
        const px = a.x + dirX * d * sign;
        const pz = a.z + dirZ * d * sign;
        // Land, and high enough that the abutment is not standing in water.
        if (terrain.heightAt(px, pz) > terrain.waterLevel + 0.6) return d;
      }
      return limit;
    };
    /*
     * The two banks are rarely the same distance from the centre line, and using
     * the larger of the two for both ends — which is what the first version did
     * — leaves one end of the bridge hanging over open water on the near side
     * while the other runs a long way inland. So each side is measured
     * separately and the deck is *recentred* on the midpoint of the crossing.
     *
     * Three metres of overhang at each end, so the abutment lands on solid
     * ground rather than at the exact waterline, where the mud is.
     */
    const bankPos = reachBank(1) + 3;
    const bankNeg = reachBank(-1) + 3;
    const half = (bankPos + bankNeg) * 0.5;
    const shift = (bankPos - bankNeg) * 0.5;
    const cx = a.x + dirX * shift;
    const cz = a.z + dirZ * shift;

    /*
     * The deck rides well clear of the water — high enough that a full flood
     * cannot reach it and, more usefully, high enough that a man standing on it
     * is skylined against the canopy from a long way off.
     */
    const deckHeight = 4.2;

    content.bridges.push({
      kind: PropKind.Bridge,
      x: cx,
      // The mesh puts its deck at local y = 0, so the prop sits at deck height.
      y: terrain.waterLevel + deckHeight,
      z: cz,
      /*
       * The instancer rotates about Y, which maps the mesh's local +Z to
       * (sin rot, 0, cos rot) — and the bridge is modelled along its local +Z.
       * The span we want it to lie along is (cos cross, sin cross), so the two
       * agree only at rot = π/2 − cross. Passing `cross` straight through, which
       * is what the old code did, laid every bridge along the river instead of
       * across it.
       */
      rot: Math.PI / 2 - cross,
      scale: 1,
      variant: structRng.int(0, 1),
      length: half * 2,
      deckHeight,
    });
    // And the same span again as something you can actually stand on.
    terrain.addDeck({
      x: cx,
      z: cz,
      dirX,
      dirZ,
      halfLength: half,
      halfWidth: 1.5,
      y: terrain.waterLevel + deckHeight,
      // The same constant the mesh is built with. See BRIDGE_SAG.
      sag: BRIDGE_SAG,
    });
  }

  // --- Cave mouths: dark, defensible, and a trap if the hunter finds you --
  for (let i = 0; i < WORLD_PROPS.caves; i++) {
    const p = terrain.findPosition(structRng, (x, z) => {
      return terrain.inBounds(x, z) && !terrain.isWater(x, z) && terrain.slopeAt(x, z) > 0.42;
    }, 70);
    const n = { x: 0, y: 1, z: 0 };
    terrain.normalAt(p.x, p.z, n);
    content.caves.push({
      kind: PropKind.Cave,
      x: p.x,
      y: terrain.heightAt(p.x, p.z),
      z: p.z,
      // Face the mouth downhill.
      rot: Math.atan2(n.z, n.x),
      scale: structRng.range(1, 1.6),
      variant: structRng.int(0, 1),
    });
  }

  // --- Food sources ------------------------------------------------------
  let foodId = 1;
  // Fruit bushes: herbivore and omnivore food, on dry jungle floor.
  for (let i = 0; i < WORLD_PROPS.fruitBushes; i++) {
    const p = terrain.findPosition(foodRng, (x, z) => {
      return terrain.inBounds(x, z) && !terrain.isWater(x, z) && terrain.foliageAt(x, z) > 0.3;
    }, 20);
    const y = terrain.heightAt(p.x, p.z);
    content.foodSources.push({
      id: foodId++,
      kind: 'fruit',
      x: p.x,
      y,
      z: p.z,
      available: true,
      respawnIn: 0,
    });
    content.bushes.push({
      kind: PropKind.FruitBush,
      x: p.x,
      y,
      z: p.z,
      rot: foodRng.range(0, Math.PI * 2),
      scale: foodRng.range(0.9, 1.4),
      variant: 0,
    });
  }

  // Fishing spots: shallow water shoals, the crocodile's pantry.
  for (let i = 0; i < WORLD_PROPS.fishingSpots; i++) {
    const p = terrain.findShorePosition(foodRng);
    content.foodSources.push({
      id: foodId++,
      kind: 'fish',
      x: p.x,
      y: terrain.waterLevel,
      z: p.z,
      available: true,
      respawnIn: 0,
    });
  }

  // --- Cosmetic layer ----------------------------------------------------
  if (options.cosmetic) {
    const d = clamp01(options.cosmeticDensity);
    /*
     * No grass here.
     *
     * Grass is the one prop that needs a density scattering cannot reach. Across
     * a world this size, forty thousand tufts is one per fourteen square metres —
     * a few sprigs on bare ground rather than a forest floor — and a believable
     * density would need hundreds of thousands of stored props. It is generated
     * on demand in a ring around the camera instead; see GrassField.ts.
     */
    placeScattered(terrain, cosmeticRng, Math.round(WORLD_PROPS.ferns * d), 0.3, (x, z, y, rng) => {
      content.cosmetic.push({
        kind: PropKind.Fern,
        x,
        y,
        z,
        rot: rng.range(0, Math.PI * 2),
        scale: rng.range(0.8, 1.6),
        variant: rng.int(0, 1),
      });
    });
    /*
     * Flowers.
     *
     * Placed with `minDensity` 0 so they reach into clearings and onto the
     * riverbanks, which is exactly where they should be: the open, sunlit ground
     * is where a rainforest actually flowers, and it is also the ground that
     * looks emptiest without them.
     */
    placeScattered(terrain, cosmeticRng, Math.round(WORLD_PROPS.flowers * d), 0, (x, z, y, rng) => {
      content.cosmetic.push({
        kind: PropKind.Flower,
        x,
        y,
        z,
        rot: rng.range(0, Math.PI * 2),
        scale: rng.range(0.6, 1.3),
        variant: rng.int(0, 4),
      });
    });

    /*
     * --- Flowering spikes, in drifts --------------------------------------
     *
     * Clumped, not scattered. Real flowering plants spread from a parent, so they
     * grow in patches, and a patch reads as *a stand of flowers* from across a
     * clearing where the same number spread evenly reads as noise. Each clump
     * shares one colour variant, which is what makes it a drift rather than a
     * fruit salad.
     */
    const spikeClumps = Math.round((WORLD_PROPS.flowerSpikes / 14) * d);
    for (let i = 0; i < spikeClumps; i++) {
      const anchor = terrain.findPosition(
        cosmeticRng,
        (x, z) =>
          terrain.inBounds(x, z) &&
          !terrain.isWater(x, z) &&
          terrain.slopeAt(x, z) < 0.5 &&
          // Open ground: flowers want the light, and a clearing wants the colour.
          terrain.foliageAt(x, z) < 0.55,
        24,
      );
      const variant = cosmeticRng.int(0, 3);
      const spread = cosmeticRng.range(2.5, 7);
      const count = cosmeticRng.int(8, 18);
      for (let j = 0; j < count; j++) {
        const a = cosmeticRng.range(0, Math.PI * 2);
        const r = spread * Math.sqrt(cosmeticRng.next());
        const x = anchor.x + Math.cos(a) * r;
        const z = anchor.z + Math.sin(a) * r;
        if (!terrain.inBounds(x, z) || terrain.isWater(x, z)) continue;
        content.cosmetic.push({
          kind: PropKind.FlowerSpike,
          x,
          y: terrain.heightAt(x, z),
          z,
          rot: cosmeticRng.range(0, Math.PI * 2),
          // Knee-to-waist on the animals, which is what "a drift you see across
          // a clearing" means here. The top of the old range put a 1.5 m spike
          // right in front of a low camera, where it stopped being scenery and
          // became an obstruction.
          scale: cosmeticRng.range(0.62, 1.12),
          variant,
        });
      }
    }

    // --- Reeds: the waterline, where the jungle meets the river -----------
    const reedCount = Math.round(WORLD_PROPS.reeds * d);
    for (let i = 0; i < reedCount; i++) {
      const p = terrain.findShorePosition(cosmeticRng);
      const depth = terrain.waterDepthAt(p.x, p.z);
      if (depth <= 0.02) continue;
      content.cosmetic.push({
        kind: PropKind.Reed,
        // Rooted on the bed, so a reed in deeper water stands taller out of it.
        x: p.x,
        y: terrain.heightAt(p.x, p.z),
        z: p.z,
        rot: cosmeticRng.range(0, Math.PI * 2),
        scale: cosmeticRng.range(0.75, 1.7),
        variant: cosmeticRng.int(0, 2),
      });
    }

    /*
     * --- Underwater weed: the crocodile's cover -------------------------
     *
     * Rooted on the river bed, in genuinely deep water only — weed in the
     * shallows is visible from the bank and hides nothing.
     *
     * ## Height is capped, and that is not a compromise
     *
     * This used to scale each clump to a *fraction of the local depth*, on the
     * reasoning that weed should reach towards the surface. In three and a half
     * metres of water that was fine. In ten it is not: a clump stretched to nine
     * metres tall while staying eighty centimetres wide, which is not a plant,
     * it is a smear — a lawn blade scaled up until you can see it is a lawn
     * blade.
     *
     * River weed is one to three metres tall whatever the river is doing, so the
     * clumps are that tall and no taller, and the deep channel is filled by
     * putting *more* of them on the bed instead of longer ones. Nothing is lost:
     * a diving animal lies on the bed, so cover only has to close over half a
     * metre of crocodile, and in ten metres of water anything on the bottom is
     * already most of the way to invisible from above.
     */
    const weedCount = Math.round(WORLD_PROPS.underwaterPlants * d);
    for (let i = 0; i < weedCount; i++) {
      const p = terrain.findWaterPosition(cosmeticRng);
      const depth = terrain.waterDepthAt(p.x, p.z);
      if (depth < 0.9) continue;
      content.cosmetic.push({
        kind: PropKind.Waterweed,
        x: p.x,
        y: terrain.heightAt(p.x, p.z),
        z: p.z,
        rot: cosmeticRng.range(0, Math.PI * 2),
        // Metres tall, never more than the water is deep.
        scale: Math.min(depth * 0.85, cosmeticRng.range(1.1, 3.2)),
        variant: cosmeticRng.int(0, 2),
      });
    }

    // Vines hang from the bigger trees.
    const vineCount = Math.round(WORLD_PROPS.vines * d);
    for (let i = 0; i < vineCount && content.trees.length > 0; i++) {
      const tree = cosmeticRng.pick(content.trees);
      const a = cosmeticRng.range(0, Math.PI * 2);
      const r = tree.radius + cosmeticRng.range(0.3, 1.4);
      content.cosmetic.push({
        kind: PropKind.Vine,
        x: tree.x + Math.cos(a) * r,
        y: tree.y + tree.branchHeight * cosmeticRng.range(0.7, 1.05),
        z: tree.z + Math.sin(a) * r,
        rot: a,
        scale: cosmeticRng.range(0.7, 1.6),
        variant: cosmeticRng.int(0, 1),
      });
    }

    // Lily pads float on still shallows.
    const padCount = Math.round(340 * d);
    for (let i = 0; i < padCount; i++) {
      const p = terrain.findShorePosition(cosmeticRng);
      content.cosmetic.push({
        kind: PropKind.LilyPad,
        x: p.x,
        y: terrain.waterLevel + 0.02,
        z: p.z,
        rot: cosmeticRng.range(0, Math.PI * 2),
        scale: cosmeticRng.range(0.6, 1.3),
        variant: cosmeticRng.int(0, 1),
      });
    }
  }

  return content;
}

/**
 * Scatter `count` props, accepting a candidate position with probability
 * proportional to the local foliage density. `minDensity` rejects sparse areas
 * outright, which is what keeps clearings clear.
 */
function placeScattered(
  terrain: Terrain,
  rng: Rng,
  count: number,
  minDensity: number,
  place: (x: number, z: number, y: number, rng: Rng) => void,
): void {
  let placed = 0;
  // Bounded attempts: dense targets in a sparse world must not hang.
  const maxAttempts = count * 8 + 64;
  for (let attempt = 0; attempt < maxAttempts && placed < count; attempt++) {
    const p = rng.inCircle((terrain.size / 2) * 0.87);
    const x = p.x;
    const z = p.y;
    if (!terrain.inBounds(x, z)) continue;
    if (terrain.isWater(x, z)) continue;
    const density = terrain.foliageAt(x, z);
    if (density < minDensity) continue;
    // Probabilistic accept weights placement towards the thick jungle.
    if (!rng.chance(clamp01(density * 1.15))) continue;
    if (terrain.slopeAt(x, z) > 0.85) continue;
    place(x, z, terrain.heightAt(x, z), rng);
    placed++;
  }
}
