/**
 * StormZone.ts — the shrinking circle, and the storm outside it.
 *
 * The whole thing is a *pure function of round time*. `planRings` picks the
 * sequence of circles once, deterministically, when the round is dealt;
 * `evaluateZone` then answers "where is the wall at t = 371.4 seconds?" without
 * any accumulated state at all.
 *
 * That property is worth the small amount of arithmetic it costs. A stateful
 * wall that integrated its own radius every tick would drift between the
 * authority and the client, and the drift would land exactly on the boundary
 * where damage starts — the one place a player will notice a metre of
 * disagreement, because they are standing on it watching their health.
 *
 * No Three.js, no DOM: this runs on the server, in the browser and in the tests.
 */

import {
  ZONE_DAMAGE_RATE,
  ZONE_FINAL_RADIUS,
  ZONE_FIRST_SHRINK_AT,
  ZONE_INITIAL_RADIUS,
  ZONE_MIN_WATER_FRACTION,
  ZONE_SHRINK_DURATION,
  ZONE_SHRINK_INTERVAL,
  ZONE_WARNING_TIME,
  ROUND_DURATION,
  WORLD_SIZE,
} from '../Systems/Config';
import { clamp01, smoothstep } from '../Systems/Noise';
import type { Rng } from '../Systems/Rng';
import type { Terrain } from '../World/Terrain';

/** One circle in the sequence. */
export interface ZoneRing {
  x: number;
  z: number;
  radius: number;
}

/** The wall's state at one instant. Everything the HUD and renderer need. */
export interface ZoneSnapshot {
  /** The circle as it stands right now (interpolated mid-shrink). */
  x: number;
  z: number;
  radius: number;
  /** Which ring we are on, 0-based. */
  stage: number;
  /** How many shrinks the round has in total. */
  totalStages: number;
  /** True while the wall is actually moving. */
  shrinking: boolean;
  /** Seconds until the next shrink starts. Infinity when there are none left. */
  untilShrink: number;
  /** The circle being moved towards, or null on the final ring. */
  next: ZoneRing | null;
  /** Damage per second for anything caught outside, at this stage. */
  damageRate: number;
}

/** How many times the circle closes during a round. */
export function shrinkCount(): number {
  if (ZONE_FIRST_SHRINK_AT >= ROUND_DURATION) return 0;
  return 1 + Math.floor((ROUND_DURATION - 1 - ZONE_FIRST_SHRINK_AT) / ZONE_SHRINK_INTERVAL);
}

// ---------------------------------------------------------------------------
// Planning the sequence
// ---------------------------------------------------------------------------

/**
 * How much of a circle is water.
 *
 * Sampled on a sunflower spiral rather than a square grid, because a spiral
 * covers a disc evenly with any number of samples — a grid would over-weight
 * the middle of the circle, which is exactly where a river is least likely to
 * be if it runs across one side.
 */
function waterFraction(terrain: Terrain, cx: number, cz: number, radius: number): number {
  const samples = 96;
  const golden = Math.PI * (3 - Math.sqrt(5));
  let wet = 0;
  for (let i = 0; i < samples; i++) {
    const r = radius * Math.sqrt((i + 0.5) / samples);
    const a = i * golden;
    if (terrain.isWater(cx + Math.cos(a) * r, cz + Math.sin(a) * r)) wet++;
  }
  return wet / samples;
}

/**
 * Pick the whole sequence of circles for one round.
 *
 * Two constraints, in priority order:
 *
 *  1. **Every circle contains water.** A caiman with no river is not playing the
 *     same game as everyone else — it cannot hide, cannot feed and cannot use
 *     its one ability. So candidate centres are rejected until enough of the
 *     disc is river. This is checked for the final circle too, which is the one
 *     that matters most, and is why the sequence is planned backwards.
 *  2. **Each circle sits inside its predecessor.** Otherwise the wall would
 *     sweep across ground that was already safe, and players who positioned
 *     correctly would be punished for it.
 *
 * Planning backwards from the smallest circle is the trick that makes both hold
 * at once. Forwards, the last circle is whatever is left after four random
 * nudges, and insisting it contain a river at that point usually fails. Choosing
 * the *final* circle first — on a stretch of river, deliberately — and then
 * growing outwards guarantees the endgame happens somewhere worth fighting over.
 */
export function planRings(terrain: Terrain, rng: Rng): ZoneRing[] {
  const stages = shrinkCount();
  const radii: number[] = [];
  for (let i = 0; i <= stages; i++) {
    // Geometric, so each step feels like the same proportional squeeze.
    const t = stages === 0 ? 1 : i / stages;
    radii.push(ZONE_INITIAL_RADIUS * Math.pow(ZONE_FINAL_RADIUS / ZONE_INITIAL_RADIUS, t));
  }

  // How far a centre may sit from the origin before the circle would overhang
  // the impassable rim hills.
  const playable = (WORLD_SIZE / 2) * 0.86;

  // --- The final circle, on water if we can manage it ---------------------
  const finalRadius = radii[stages];
  let best = { x: 0, z: 0, score: -1 };
  for (let attempt = 0; attempt < 400; attempt++) {
    const p = rng.inCircle(Math.max(0, playable - ZONE_INITIAL_RADIUS * 0.55));
    const wet = waterFraction(terrain, p.x, p.y, finalRadius);
    // Want river, but not a circle that is *entirely* river — a final ring with
    // no dry land at all locks out every animal that cannot swim.
    const score = wet > 0.75 ? 0.1 : wet;
    if (score > best.score) best = { x: p.x, z: p.y, score };
    if (wet >= ZONE_MIN_WATER_FRACTION * 3 && wet < 0.7) break;
  }

  // --- Grow outwards ------------------------------------------------------
  const rings: ZoneRing[] = new Array(stages + 1);
  rings[stages] = { x: best.x, z: best.z, radius: finalRadius };

  for (let i = stages - 1; i >= 0; i--) {
    const child = rings[i + 1];
    const radius = radii[i];
    // The parent must contain the child, and must itself stay on the map.
    const slack = radius - child.radius;
    let chosen = { x: child.x, z: child.z, score: -1 };
    for (let attempt = 0; attempt < 200; attempt++) {
      // Offset the parent from the child so the wall visibly travels rather than
      // closing concentrically, which reads as much more threatening.
      const p = rng.inCircle(slack * 0.82);
      const x = child.x + p.x;
      const z = child.z + p.y;
      if (Math.hypot(x, z) > Math.max(0, playable - radius)) continue;
      const wet = waterFraction(terrain, x, z, radius);
      const score = wet > 0.8 ? 0.05 : wet;
      if (score > chosen.score) chosen = { x, z, score };
      if (wet >= ZONE_MIN_WATER_FRACTION) break;
    }
    rings[i] = { x: chosen.x, z: chosen.z, radius };
  }

  return rings;
}

// ---------------------------------------------------------------------------
// Evaluating it
// ---------------------------------------------------------------------------

/** The wall's state at `elapsed` seconds into the round. */
export function evaluateZone(rings: ZoneRing[], elapsed: number): ZoneSnapshot {
  const totalStages = rings.length - 1;
  if (rings.length === 0) {
    return {
      x: 0,
      z: 0,
      radius: WORLD_SIZE,
      stage: 0,
      totalStages: 0,
      shrinking: false,
      untilShrink: Infinity,
      next: null,
      damageRate: 0,
    };
  }

  // Which shrink, if any, are we in or past?
  let stage = 0;
  let progress = 0;
  let shrinking = false;
  let untilShrink = Infinity;

  for (let i = 0; i < totalStages; i++) {
    const start = ZONE_FIRST_SHRINK_AT + i * ZONE_SHRINK_INTERVAL;
    const end = start + ZONE_SHRINK_DURATION;
    if (elapsed < start) {
      stage = i;
      untilShrink = start - elapsed;
      break;
    }
    if (elapsed < end) {
      stage = i;
      progress = (elapsed - start) / ZONE_SHRINK_DURATION;
      shrinking = true;
      untilShrink = 0;
      break;
    }
    // This shrink has finished; we are at least on ring i+1.
    stage = i + 1;
  }

  const from = rings[Math.min(stage, totalStages)];
  const to = rings[Math.min(stage + 1, totalStages)];
  // Smoothstep rather than linear: the wall eases off its mark and eases onto
  // the next one, which makes it look like weather moving in rather than a
  // radius being animated.
  const t = shrinking ? smoothstep(0, 1, clamp01(progress)) : 0;

  const damageRate =
    ZONE_DAMAGE_RATE[Math.min(stage, ZONE_DAMAGE_RATE.length - 1)] ??
    ZONE_DAMAGE_RATE[ZONE_DAMAGE_RATE.length - 1];

  return {
    x: from.x + (to.x - from.x) * t,
    z: from.z + (to.z - from.z) * t,
    radius: from.radius + (to.radius - from.radius) * t,
    stage,
    totalStages,
    shrinking,
    untilShrink,
    next: stage < totalStages ? rings[stage + 1] : null,
    damageRate,
  };
}

/** Metres outside the circle. Zero or negative means safe. */
export function distanceOutside(zone: { x: number; z: number; radius: number }, x: number, z: number): number {
  return Math.hypot(x - zone.x, z - zone.z) - zone.radius;
}

/** Is this position in the storm? */
export function isOutside(zone: { x: number; z: number; radius: number }, x: number, z: number): boolean {
  return distanceOutside(zone, x, z) > 0;
}

/** True while the HUD should be shouting about the next shrink. */
export function isWarning(zone: ZoneSnapshot): boolean {
  return !zone.shrinking && zone.untilShrink <= ZONE_WARNING_TIME;
}

/**
 * 0..1 "how bad is it here", used for the storm's visual and audio intensity.
 *
 * Ramps over the first 60 m outside so crossing the boundary is a gradient
 * rather than a light switch — you can feel yourself walking into it, which is
 * the warning a player deserves before the damage starts mattering.
 */
export function stormIntensity(
  zone: { x: number; z: number; radius: number },
  x: number,
  z: number,
): number {
  return clamp01(distanceOutside(zone, x, z) / 60);
}
