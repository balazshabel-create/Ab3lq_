/**
 * FoodChain.ts — who eats what.
 *
 * The chain is what forces survivors out of hiding: a jaguar cannot live on
 * leaves, so a jaguar player has to go where the prey is, which is exactly
 * where the hunter is looking.
 *
 *   PLANTS ─→ CAPYBARA / PECCARY / TAPIR ─→ JAGUAR
 *   PLANTS ─→ SMALL MAMMALS ─→ ANACONDA ─→ JAGUAR
 *   FISH   ─→ CAIMAN / HERON
 *   ANY DEATH ─→ CARRION ─→ scavengers
 */

import { FOOD_NUTRITION, HUNTER_DAMAGE, type FoodTier } from '../Systems/Config';
import { ANIMALS, Diet, SizeClass, Species } from './AnimalTypes';
import type { FoodSourceKind } from '../World/WorldGen';

/** Map a world food source to its nutrition tier. */
export function tierOfSource(kind: FoodSourceKind): FoodTier {
  switch (kind) {
    case 'fruit':
      return 'fruit';
    case 'fish':
      return 'fish';
    default:
      return 'plant';
  }
}

/** Nutrition tier gained from eating an animal of the given size. */
export function tierOfPrey(size: SizeClass): FoodTier {
  return size >= SizeClass.Large ? 'largeAnimal' : 'smallAnimal';
}

/** Can this species eat this tier of food at all? */
export function canEat(species: Species, tier: FoodTier): boolean {
  return ANIMALS[species].eats.includes(tier);
}

/** Nutrition value of a tier, before weakness scaling. */
export function nutritionOf(tier: FoodTier): number {
  return FOOD_NUTRITION[tier];
}

/**
 * Can `predator` physically kill and eat `prey`?
 *
 * Two paths: an explicit entry in the species' prey list (the curated,
 * believable relationships), or a generic size rule so that new species behave
 * sensibly without having to enumerate every pairing.
 */
export function canPrey(predator: Species, prey: Species): boolean {
  const p = ANIMALS[predator];
  const q = ANIMALS[prey];
  if (p.species === q.species) return false;
  if (p.preys.includes(prey)) return true;

  const meatEater =
    p.diet === Diet.Carnivore || p.diet === Diet.Omnivore || p.diet === Diet.Piscivore;
  if (!meatEater) return false;

  // A predator can take anything at least one size class below it.
  return q.size <= p.size - 1;
}

/** Every species this one will hunt. */
export function preyListFor(species: Species): Species[] {
  return (Object.keys(ANIMALS) as Species[]).filter((s) => canPrey(species, s));
}

/** Every species that hunts this one — what the AI needs to be scared of. */
export function predatorsOf(species: Species): Species[] {
  return (Object.keys(ANIMALS) as Species[]).filter((s) => canPrey(s, species));
}

/**
 * Threat level `other` poses to `self`, 0..1.
 * Used by AI flee logic and by the "easily scared" weakness.
 */
export function threatLevel(self: Species, other: Species): number {
  if (!canPrey(other, self)) {
    // Even a non-predator is mildly alarming if it is much bigger.
    const diff = ANIMALS[other].size - ANIMALS[self].size;
    return diff >= 2 ? 0.2 : 0;
  }
  const aggression = ANIMALS[other].temperament.aggression;
  const sizeGap = Math.max(0, ANIMALS[other].size - ANIMALS[self].size);
  return Math.min(1, 0.45 + aggression * 0.35 + sizeGap * 0.12);
}

/** Food tiers a species can find in the world without killing anything. */
export function foragedTiers(species: Species): FoodTier[] {
  return ANIMALS[species].eats.filter(
    (t) => t === 'plant' || t === 'fruit' || t === 'fish' || t === 'carrion',
  );
}

/** True if this species can survive purely by foraging (no hunting needed). */
export function canForageOnly(species: Species): boolean {
  const d = ANIMALS[species].diet;
  return d === Diet.Herbivore || d === Diet.Omnivore || d === Diet.Insectivore;
}

/**
 * How much damage one bite does.
 *
 * ## Why this is here and not in the two places that used to do it
 *
 * The player's attack and the AI's attack computed damage separately, and they
 * did not agree: a player predator killed its natural prey outright while an AI
 * of the same species chipped away a flat sixteen points a bite, needing seven
 * of them on a slow cooldown. Two consequences, both bad. Animals could barely
 * kill each other, so the food chain the whole design rests on existed mostly on
 * paper; and a player and an AI of the same species behaved *differently in
 * combat*, which is a tell — and this game's central promise is that there is no
 * code path that treats the two differently.
 *
 * The rules, in one place:
 *
 *  • **Natural prey dies outright.** Not because predators are strong but
 *    because the alternative does not work: a fleeing capybara at full health
 *    that needs seven connected bites will simply never be caught, so nothing
 *    ever feeds and predators never have to come into the open to hunt.
 *  • **Anything else takes a heavy but survivable hit**, so being found is not
 *    the same as being dead and a chase is a real contest.
 *  • **Size resists.** Hitting something two classes above you barely registers.
 *    Without this a capybara could grind a tiger down given enough bites — its
 *    bite is feeble but nonzero, and nothing stopped the arithmetic getting
 *    there eventually. "A capybara must not kill a tiger" is a claim about what
 *    is *possible*, not about how long it takes, so it needs a term that scales
 *    with the gap rather than a smaller constant.
 */
export function biteDamage(
  attacker: Species,
  victim: Species,
  victimMaxHealth: number,
  options: { victimIsPlayer: boolean; armoured?: boolean },
): number {
  const a = ANIMALS[attacker];
  const attackPower = a.attackPower ?? 0.5;
  const sizeGap = ANIMALS[victim].size - a.size;
  const resistance = sizeGap > 0 ? 1 / (1 + sizeGap * 2) : 1;

  let damage: number;
  if (options.victimIsPlayer) {
    damage = HUNTER_DAMAGE * 0.62 * attackPower * resistance;
  } else if (canPrey(attacker, victim)) {
    damage = victimMaxHealth;
  } else {
    damage = HUNTER_DAMAGE * 1.8 * attackPower * resistance;
  }
  return options.armoured ? damage * 0.3 : damage;
}
