/**
 * HungerSystem.ts — the second clock every survivor is racing.
 *
 * Hunger is what stops "hide in a bush for ten minutes" from being a winning
 * strategy. Because each species drains at a different rate, it also creates
 * genuinely different rounds: a sloth can afford to sit in a tree and do
 * nothing, while a jaguar has to keep hunting in the open and keeps walking
 * into the hunter as a result.
 */

import {
  EAT_DURATION,
  EAT_REACH,
  HEALTH_REGEN_DELAY,
  HEALTH_REGEN_RATE,
  HUNGER_MAX,
  NOISE_EAT,
  STARVATION_DAMAGE_RATE,
  type FoodTier,
} from '../Systems/Config';
import { ActorFlags, NoiseKind, type PlayerActor } from '../Core/Types';
import { canEat, nutritionOf } from '../Animals/FoodChain';
import type { ResolvedStats } from './Weaknesses';

/** Why an eat attempt failed, for UI feedback. */
export type EatFailure =
  | 'too_far'
  | 'wrong_diet'
  | 'depleted'
  | 'already_eating'
  | 'dead'
  | 'none';

export interface EatAttempt {
  started: boolean;
  reason: EatFailure;
  tier: FoodTier | null;
}

/**
 * Advance hunger, digestion, starvation damage and health regeneration.
 * Returns true if the player died of starvation this tick.
 */
export function updateHunger(
  player: PlayerActor,
  stats: ResolvedStats,
  dt: number,
): boolean {
  if (player.flags & ActorFlags.Dead) return false;

  // --- Drain -------------------------------------------------------------
  player.hunger = Math.max(0, player.hunger - stats.hungerRate * dt);

  // --- Slow digestion: hunger trickles in instead of arriving at once -----
  if (player.digesting > 0) {
    const gain = Math.min(player.digesting, player.digestRate * dt);
    player.hunger = Math.min(HUNGER_MAX, player.hunger + gain);
    player.digesting -= gain;
  }

  // --- Starvation --------------------------------------------------------
  let died = false;
  if (player.hunger <= 0) {
    player.health -= STARVATION_DAMAGE_RATE * dt;
    player.sinceDamage = 0;
    if (player.health <= 0) {
      player.health = 0;
      died = true;
    }
  }

  // --- Regeneration -----------------------------------------------------
  player.sinceDamage += dt;
  if (
    !died &&
    player.hunger > 0 &&
    player.sinceDamage > HEALTH_REGEN_DELAY &&
    player.health < player.maxHealth
  ) {
    player.health = Math.min(player.maxHealth, player.health + HEALTH_REGEN_RATE * dt);
  }

  return died;
}

/** Can this player start eating the given food tier right now? */
export function canStartEating(
  player: PlayerActor,
  tier: FoodTier,
  distance: number,
): EatAttempt {
  if (player.flags & ActorFlags.Dead) return { started: false, reason: 'dead', tier: null };
  if (player.eatTimer > 0) return { started: false, reason: 'already_eating', tier: null };
  if (distance > EAT_REACH) return { started: false, reason: 'too_far', tier: null };
  if (!canEat(player.species, tier)) return { started: false, reason: 'wrong_diet', tier: null };
  return { started: true, reason: 'none', tier };
}

/**
 * Begin a meal. Eating locks the player in place for a while — which is
 * exactly when a hunter wants to find you, and why "Missing Teeth" is such a
 * nasty weakness.
 */
export function startEating(
  player: PlayerActor,
  stats: ResolvedStats,
  targetId: number,
): void {
  player.eatTimer = stats.eatDuration || EAT_DURATION;
  player.eatTargetId = targetId;
  player.flags |= ActorFlags.Eating;
}

/**
 * Advance an in-progress meal. Returns the nutrition to award if it finished
 * this tick, otherwise 0.
 */
export function updateEating(
  player: PlayerActor,
  dt: number,
  emitNoise: (x: number, z: number, volume: number, kind: NoiseKind, id: number) => void,
): boolean {
  if (player.eatTimer <= 0) return false;

  // Moving cancels the meal — you cannot graze while sprinting away.
  if (player.gait > 0.28) {
    cancelEating(player);
    return false;
  }

  player.eatTimer -= dt;
  // Chewing is audible. Quiet, but audible.
  if (Math.random() < dt * 1.6) {
    emitNoise(player.pos.x, player.pos.z, NOISE_EAT, NoiseKind.Eat, player.id);
  }

  if (player.eatTimer <= 0) {
    player.eatTimer = 0;
    player.flags &= ~ActorFlags.Eating;
    return true;
  }
  return false;
}

export function cancelEating(player: PlayerActor): void {
  player.eatTimer = 0;
  player.eatTargetId = 0;
  player.flags &= ~ActorFlags.Eating;
}

/**
 * Award the nutrition from a finished meal.
 *
 * With Slow Digestion the hunger arrives gradually, so a panic meal mid-chase
 * does nothing for you — you had to have eaten earlier.
 */
export function awardNutrition(
  player: PlayerActor,
  tier: FoodTier,
  stats: ResolvedStats,
): void {
  const amount = nutritionOf(tier) * stats.nutritionScale;
  if (stats.digestOverSeconds > 0) {
    player.digesting += amount;
    player.digestRate = amount / stats.digestOverSeconds;
  } else {
    player.hunger = Math.min(HUNGER_MAX, player.hunger + amount);
  }
  player.stats.mealsEaten++;
}

/** Hunger band, for HUD colouring and audio cues. */
export type HungerBand = 'full' | 'ok' | 'hungry' | 'starving' | 'critical';

export function hungerBand(hunger: number): HungerBand {
  if (hunger > 75) return 'full';
  if (hunger > 50) return 'ok';
  if (hunger > 25) return 'hungry';
  if (hunger > 0) return 'starving';
  return 'critical';
}
