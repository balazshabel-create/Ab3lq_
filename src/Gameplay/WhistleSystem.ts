/**
 * WhistleSystem.ts — the mechanic the whole game is named after.
 *
 * Every survivor must whistle at least once a minute. The player chooses when.
 * Miss the deadline and flies start gathering, and a swarm of flies is the one
 * thing in the jungle that unambiguously means "this animal is a person".
 *
 * The tension is deliberate and symmetric:
 *   • Whistling is loud. It tells anything nearby roughly where you are.
 *   • Not whistling is worse. It eventually paints a permanent marker on you.
 *   • So the interesting decision is *timing*: do you whistle now, while the
 *     crocodile is thirty metres away and might hear it, or do you hold on and
 *     risk the flies arriving while it is still nearby?
 *
 * The hunter has no whistle obligation, which means a hunter never has flies —
 * but survivors do not know that from the outside, because a fly-free animal
 * might simply be an AI or a survivor who whistled on time.
 */

import {
  FLY_DECAY_TIME,
  FLY_MAX_COUNT,
  FLY_OBVIOUS_THRESHOLD,
  FLY_REVEAL_TIME,
  NOISE_WHISTLE,
  WHISTLE_COOLDOWN,
  WHISTLE_HEAR_RANGE,
  WHISTLE_INTERVAL,
  WHISTLE_WARN_TIME,
} from '../Systems/Config';
import { ActorFlags, NoiseKind, Role, type PlayerActor } from '../Core/Types';
import { clamp01 } from '../Systems/Noise';
import type { ResolvedStats } from './Weaknesses';

/** What the HUD needs to render the whistle widget. */
export interface WhistleStatus {
  /** Seconds until the whistle is overdue. Negative once overdue. */
  timeRemaining: number;
  /** True inside the warning window. */
  warning: boolean;
  /** True once the deadline has passed and flies are accumulating. */
  overdue: boolean;
  /** Fly swarm intensity, 0..1. */
  flyIntensity: number;
  /** How many fly sprites to show. */
  flyCount: number;
  /** True once the swarm is big enough for the hunter to read at distance. */
  exposed: boolean;
  /** True while the whistle is on cooldown. */
  onCooldown: boolean;
  /** Does this player have a whistle obligation at all? */
  required: boolean;
}

/** Result of attempting to whistle. */
export interface WhistleResult {
  whistled: boolean;
  /** Reason it failed, for UI feedback. */
  reason?: 'cooldown' | 'dead' | 'not_required';
  /** How far the whistle carried. */
  range: number;
  /** True if the player left it late enough for flies to have appeared. */
  wasLate: boolean;
}

/**
 * Advance one player's whistle timer and fly swarm.
 *
 * Call once per simulation tick, for every player.
 */
export function updateWhistle(player: PlayerActor, dt: number): void {
  // The hunter is exempt: predators do not announce themselves, and this is
  // the asymmetry that makes hunting possible at all.
  if (player.role !== Role.Survivor) {
    player.flies = 0;
    player.sinceWhistle = 0;
    return;
  }

  if (player.flags & ActorFlags.Dead) {
    player.flies = 0;
    return;
  }

  player.sinceWhistle += dt;
  player.whistleCooldown = Math.max(0, player.whistleCooldown - dt);

  const overdueBy = player.sinceWhistle - WHISTLE_INTERVAL;
  if (overdueBy > 0) {
    // Flies gather over FLY_REVEAL_TIME, so there is a window in which a player
    // can still fix the problem before the swarm becomes obvious.
    player.flies = clamp01(overdueBy / FLY_REVEAL_TIME);
  } else {
    // Whistled in time: the swarm disperses rather than vanishing, which keeps
    // a near-miss visible for a few seconds. That lingering evidence is often
    // what gets somebody killed.
    if (player.flies > 0) {
      player.flies = Math.max(0, player.flies - dt / FLY_DECAY_TIME);
    }
  }

  if (player.flies > player.stats.peakFlies) player.stats.peakFlies = player.flies;
  if (player.flies > 0.01) player.stats.timeWithFlies += dt;
}

/** Read-only status for the HUD. */
export function whistleStatus(player: PlayerActor): WhistleStatus {
  const required = player.role === Role.Survivor && !(player.flags & ActorFlags.Dead);
  const remaining = WHISTLE_INTERVAL - player.sinceWhistle;
  return {
    timeRemaining: remaining,
    warning: required && remaining <= WHISTLE_WARN_TIME && remaining > 0,
    overdue: required && remaining <= 0,
    flyIntensity: player.flies,
    flyCount: Math.round(player.flies * FLY_MAX_COUNT),
    exposed: player.flies >= FLY_OBVIOUS_THRESHOLD,
    onCooldown: player.whistleCooldown > 0,
    required,
  };
}

/**
 * Attempt a whistle. Returns what happened so the caller can emit the noise,
 * play the sound and update statistics.
 */
export function tryWhistle(player: PlayerActor, stats: ResolvedStats): WhistleResult {
  const range = WHISTLE_HEAR_RANGE * stats.whistleRangeScale;

  if (player.flags & ActorFlags.Dead) {
    return { whistled: false, reason: 'dead', range, wasLate: false };
  }
  // The hunter *can* whistle — and absolutely should, as camouflage. It simply
  // has no deadline and gains nothing mechanically.
  if (player.whistleCooldown > 0) {
    return { whistled: false, reason: 'cooldown', range, wasLate: false };
  }

  const wasLate = player.role === Role.Survivor && player.sinceWhistle > WHISTLE_INTERVAL;

  player.sinceWhistle = 0;
  player.whistleCooldown = WHISTLE_COOLDOWN * stats.whistleCooldownScale;
  player.flags |= ActorFlags.Whistling;
  player.stats.whistles++;
  if (wasLate) player.stats.lateWhistles++;

  return { whistled: true, range, wasLate };
}

/** Loudness of a whistle, after weakness scaling. */
export function whistleVolume(stats: ResolvedStats): number {
  return NOISE_WHISTLE * stats.whistleRangeScale;
}

export const WHISTLE_NOISE_KIND = NoiseKind.Whistle;

/**
 * How visible a player's flies are from an observer's position.
 *
 * Returns 0..1. The hunter's client uses this to decide whether to draw the
 * swarm at all, so a distant player's flies do not leak information the hunter
 * has not actually earned by getting close.
 */
export function flyVisibility(
  flies: number,
  distance: number,
  maxRange: number,
  rain: number,
): number {
  if (flies <= 0.01) return 0;
  const falloff = 1 - clamp01(distance / maxRange);
  // Heavy rain knocks the flies down — a genuine tactical reason to move in a
  // downpour even though it also masks the hunter's footsteps.
  const weather = 1 - rain * 0.55;
  return clamp01(flies * falloff * weather);
}
