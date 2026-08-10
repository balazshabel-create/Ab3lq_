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

import { FOOD_NUTRITION, type FoodTier } from '../Systems/Config';
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
