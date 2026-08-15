/**
 * Locomotion.ts — one movement solver, used by both the AI and the player.
 *
 * This shared implementation is a deliberate design decision, not a convenience.
 * The entire premise of Jungle Jukebox is that a player capybara is
 * indistinguishable from an AI capybara, and the fastest way to break that
 * illusion is two different movement code paths: players sliding smoothly while
 * AI snaps to waypoints, players clipping through trunks that AI walk around.
 *
 * So: identical acceleration, identical turn limits, identical water handling,
 * identical tree collision. The only difference is who supplies the wish
 * direction — a keyboard, or a behaviour tree.
 */

import { ANIMALS, Species } from '../Animals/AnimalTypes';
import { GRAVITY, WATER_LEVEL, DEEP_WATER_DEPTH } from './Config';
import { MoveMode, ActorFlags, type Actor } from '../Core/Types';
import { Terrain } from '../World/Terrain';
import { clamp, clamp01, turnTowards } from './Noise';

/** Per-actor movement capabilities, resolved from species + weakness. */
export interface MoveStats {
  walkSpeed: number;
  sprintSpeed: number;
  swimSpeed: number;
  climbSpeed: number;
  turnRate: number;
  jumpPower: number;
}

/** Movement intent for one tick. */
export interface MoveIntent {
  /** Desired heading as a unit-ish vector on the XZ plane. Zero = stand still. */
  dirX: number;
  dirZ: number;
  /** 0..1 throttle. 1 with `sprint` set means full sprint. */
  throttle: number;
  sprint: boolean;
  /** Requested this tick. Ignored if the animal cannot jump or is airborne. */
  jump: boolean;
  /** Requested submerge (crocodiles). */
  submerge: boolean;
  /** Flyers: +1 ascend, -1 descend. */
  ascend: number;
  /** Flyers: true while the animal wants to be airborne at all. */
  wantsFlight: boolean;
}

export function emptyIntent(): MoveIntent {
  return {
    dirX: 0,
    dirZ: 0,
    throttle: 0,
    sprint: false,
    jump: false,
    submerge: false,
    ascend: 0,
    wantsFlight: false,
  };
}

/** Mutable per-actor physics state that is not part of the network snapshot. */
export interface MoveState {
  /** Vertical velocity while airborne or jumping. */
  vy: number;
  airborne: boolean;
  /** Smoothed horizontal speed, so gait animation does not jitter. */
  smoothSpeed: number;
  /** Accumulated distance, for footstep noise and stats. */
  stepAccumulator: number;
}

export function newMoveState(): MoveState {
  return {
    vy: 0,
    airborne: false,
    smoothSpeed: 0,
    stepAccumulator: 0,
  };
}

/** How the environment resisted or helped the move — the caller reacts to this. */
export interface MoveResult {
  mode: MoveMode;
  /** Actual horizontal speed achieved this tick. */
  speed: number;
  /** Distance travelled this tick. */
  distance: number;
  /** True on the tick the actor entered the water. */
  splashed: boolean;
  /** True on the tick the actor landed from a jump/fall. */
  landed: boolean;
  /** Water depth at the actor's feet. */
  waterDepth: number;
  /** True if a footstep "beat" happened this tick (for noise + audio). */
  footfall: boolean;
}

/** Obstacle resolution callback: push the position out of solid props. */
export type ObstacleResolver = (
  x: number,
  z: number,
  radius: number,
  out: { x: number; z: number },
) => boolean;

/** Climb target lookup: is there a climbable trunk near this position? */
export interface LocomotionEnv {
  terrain: Terrain;
  resolveObstacles?: ObstacleResolver;
}

const scratch = { x: 0, z: 0 };

/**
 * Advance one actor's position by `dt` seconds.
 *
 * Returns what happened, so the caller can emit noise, play a splash, or count
 * distance travelled without duplicating the physics reasoning.
 */
export function applyMovement(
  actor: Actor,
  intent: MoveIntent,
  stats: MoveStats,
  state: MoveState,
  env: LocomotionEnv,
  dt: number,
): MoveResult {
  const def = ANIMALS[actor.species];
  const loco = def.locomotion;
  const terrain = env.terrain;

  const result: MoveResult = {
    mode: MoveMode.Idle,
    speed: 0,
    distance: 0,
    splashed: false,
    landed: false,
    waterDepth: 0,
    footfall: false,
  };

  const wasInWater = actor.moveMode === MoveMode.Swim;

  // ---- Direction ---------------------------------------------------------
  const dirLen = Math.hypot(intent.dirX, intent.dirZ);
  const hasInput = dirLen > 1e-4 && intent.throttle > 1e-3;
  let dirX = 0;
  let dirZ = 0;
  if (hasInput) {
    dirX = intent.dirX / dirLen;
    dirZ = intent.dirZ / dirLen;
    // Turn towards the wish direction rather than snapping — this is what
    // gives every animal its own weight and makes a player's panicked
    // 180° turn look different from an AI's lazy arc.
    const wishYaw = Math.atan2(dirZ, dirX);
    actor.yaw = turnTowards(actor.yaw, wishYaw, stats.turnRate * dt);
  }

  /*
   * ---- No climbing -------------------------------------------------------
   *
   * Trees are scenery and cover, not terrain. The climbing implementation that
   * used to live here — grip a trunk, ride it up, clamp to 92% of its height —
   * has been removed outright rather than left switched off, because a mechanic
   * nothing can reach is a trap for the next reader: it looks supported, it
   * typechecks, and it silently rots.
   *
   * `Locomotion.canClimb` and `climbSpeed` stay in the species table as data
   * (they are part of the wire-stable shape and every entry now reads false/0),
   * and `MoveMode.Climb` stays in the protocol enum for the same reason, but
   * nothing sets either any more.
   */

  // ---- Flight ------------------------------------------------------------
  if (loco.canFly && (intent.wantsFlight || state.airborne)) {
    const cruise = terrain.heightAt(actor.pos.x, actor.pos.z) + loco.flyHeight;
    const targetY = intent.wantsFlight
      ? cruise + intent.ascend * 6
      : terrain.surfaceAt(actor.pos.x, actor.pos.z) + def.silhouette.height * 0.5;

    actor.pos.y += clamp(targetY - actor.pos.y, -8 * dt * 2, 8 * dt * 2);

    const speed =
      (intent.sprint ? stats.sprintSpeed : stats.walkSpeed) *
      clamp01(intent.throttle) *
      2.1; // flight is faster than the same animal's walk
    if (hasInput) {
      actor.pos.x += Math.cos(actor.yaw) * speed * dt;
      actor.pos.z += Math.sin(actor.yaw) * speed * dt;
    }
    terrain.clampToBounds(actor.pos);

    const groundY = terrain.surfaceAt(actor.pos.x, actor.pos.z);
    state.airborne = intent.wantsFlight || actor.pos.y > groundY + 0.6;
    if (!state.airborne) actor.pos.y = groundY;

    actor.moveMode = state.airborne ? MoveMode.Fly : MoveMode.Ground;
    actor.flags = state.airborne
      ? actor.flags | ActorFlags.Airborne
      : actor.flags & ~ActorFlags.Airborne;
    state.smoothSpeed += (speed - state.smoothSpeed) * Math.min(1, dt * 8);
    actor.gait = clamp01(state.smoothSpeed / Math.max(0.1, stats.sprintSpeed * 2.1));
    result.mode = actor.moveMode;
    result.speed = speed;
    result.distance = speed * dt;
    return result;
  }

  // ---- Water vs land -----------------------------------------------------
  const groundHeight = terrain.heightAt(actor.pos.x, actor.pos.z);
  const depth = Math.max(0, WATER_LEVEL - groundHeight);
  result.waterDepth = depth;

  const canSwim = loco.swimSpeed > 0.15;
  const inDeep = depth >= DEEP_WATER_DEPTH;
  const swimming = inDeep && canSwim;

  // Animals that cannot swim treat deep water as a wall.
  let blockedByWater = false;
  if (inDeep && !canSwim) blockedByWater = true;

  let speed: number;
  let mode: MoveMode;

  if (swimming) {
    mode = MoveMode.Swim;
    speed = stats.swimSpeed * clamp01(intent.throttle) * (intent.sprint ? 1.3 : 1);
  } else {
    mode = MoveMode.Ground;
    const base = intent.sprint ? stats.sprintSpeed : stats.walkSpeed;
    speed = base * clamp01(intent.throttle);
    // Wading is slow and loud.
    if (depth > 0.15) speed *= 1 - clamp01(depth / DEEP_WATER_DEPTH) * 0.42;
    // Steep ground slows everything down.
    const slope = terrain.slopeAt(actor.pos.x, actor.pos.z);
    if (slope > 0.35) speed *= clamp(1 - (slope - 0.35) * 1.1, 0.35, 1);
  }

  if (!hasInput) speed = 0;

  // ---- Jumping and gravity ----------------------------------------------
  if (intent.jump && !state.airborne && loco.canJump && !swimming) {
    state.vy = stats.jumpPower;
    state.airborne = true;
  }

  // ---- Integrate horizontally ------------------------------------------
  const moveX = Math.cos(actor.yaw) * speed * dt;
  const moveZ = Math.sin(actor.yaw) * speed * dt;
  const prevX = actor.pos.x;
  const prevZ = actor.pos.z;

  let nextX = actor.pos.x + moveX;
  let nextZ = actor.pos.z + moveZ;

  // Refuse to walk into deep water if we cannot swim.
  if (blockedByWater || (!canSwim && terrain.waterDepthAt(nextX, nextZ) >= DEEP_WATER_DEPTH)) {
    // Slide along the shoreline instead of stopping dead: try each axis alone.
    if (terrain.waterDepthAt(nextX, prevZ) < DEEP_WATER_DEPTH) {
      nextZ = prevZ;
    } else if (terrain.waterDepthAt(prevX, nextZ) < DEEP_WATER_DEPTH) {
      nextX = prevX;
    } else {
      nextX = prevX;
      nextZ = prevZ;
    }
  }

  // Land animals also refuse to climb sheer walls.
  const nextGround = terrain.heightAt(nextX, nextZ);
  if (!swimming && nextGround - groundHeight > 1.6 * Math.max(0.2, speed * dt)) {
    const slideZ = terrain.heightAt(nextX, prevZ);
    const slideX = terrain.heightAt(prevX, nextZ);
    if (slideZ - groundHeight <= 1.6 * Math.max(0.2, speed * dt)) {
      nextZ = prevZ;
    } else if (slideX - groundHeight <= 1.6 * Math.max(0.2, speed * dt)) {
      nextX = prevX;
    } else {
      nextX = prevX;
      nextZ = prevZ;
    }
  }

  actor.pos.x = nextX;
  actor.pos.z = nextZ;

  // ---- Obstacles (tree trunks, rocks, huts) ----------------------------
  if (env.resolveObstacles) {
    const radius = Math.max(0.22, def.silhouette.width * 0.5);
    if (env.resolveObstacles(actor.pos.x, actor.pos.z, radius, scratch)) {
      actor.pos.x = scratch.x;
      actor.pos.z = scratch.z;
    }
  }

  terrain.clampToBounds(actor.pos);

  // ---- Integrate vertically --------------------------------------------
  const surface = terrain.surfaceAt(actor.pos.x, actor.pos.z);
  if (swimming) {
    /*
     * Float at the surface, or sit on the bottom while submerged.
     *
     * Submerging is gated on `canSubmerge`, not on being able to swim: only the
     * ambush reptiles get to disappear under the water. See the field's comment
     * in AnimalTypes for why that distinction is worth enforcing.
     *
     * The depth is measured from the bed rather than from the water line, so a
     * submerged animal lies *on the bottom* of a deep channel instead of hovering
     * a fixed distance below the surface — which is both what a crocodile does
     * and what puts it down among the weed that hides it.
     */
    const canSubmerge = loco.canSubmerge && depth > def.silhouette.height * 1.1;
    const submerging = intent.submerge && canSubmerge;
    const targetY = submerging
      ? groundHeight + def.silhouette.height * 0.5
      : WATER_LEVEL - def.silhouette.height * 0.25;
    actor.pos.y += (targetY - actor.pos.y) * Math.min(1, dt * 6);
    state.vy = 0;
    state.airborne = false;
    actor.flags = submerging
      ? actor.flags | ActorFlags.Submerged
      : actor.flags & ~ActorFlags.Submerged;
  } else {
    actor.flags &= ~ActorFlags.Submerged;
    if (state.airborne) {
      state.vy -= GRAVITY * dt;
      actor.pos.y += state.vy * dt;
      if (actor.pos.y <= surface) {
        actor.pos.y = surface;
        state.vy = 0;
        state.airborne = false;
        result.landed = true;
      }
    } else {
      // Glue to the ground, but smoothly so slopes do not look like stairs.
      const targetY = surface;
      const diff = targetY - actor.pos.y;
      if (Math.abs(diff) > 2.5) {
        actor.pos.y = targetY; // teleport-scale correction (spawn, respawn)
      } else {
        actor.pos.y += diff * Math.min(1, dt * 14);
      }
    }
  }

  actor.flags = state.airborne
    ? actor.flags | ActorFlags.Airborne
    : actor.flags & ~ActorFlags.Airborne;

  // ---- Bookkeeping ------------------------------------------------------
  const dx = actor.pos.x - prevX;
  const dz = actor.pos.z - prevZ;
  const travelled = Math.hypot(dx, dz);
  const actualSpeed = dt > 0 ? travelled / dt : 0;

  actor.vel.x = dt > 0 ? dx / dt : 0;
  actor.vel.z = dt > 0 ? dz / dt : 0;
  actor.vel.y = state.vy;

  state.smoothSpeed += (actualSpeed - state.smoothSpeed) * Math.min(1, dt * 9);
  const reference = Math.max(0.2, swimming ? stats.swimSpeed * 1.3 : stats.sprintSpeed);
  actor.gait = clamp01(state.smoothSpeed / reference);
  actor.moveMode = actualSpeed < 0.05 ? (swimming ? MoveMode.Swim : MoveMode.Idle) : mode;

  // Footstep beat: one "step" per body-length travelled, so a tiny frog
  // patters and a tapir thuds at believable intervals.
  const stride = Math.max(0.35, def.silhouette.length * 0.55);
  state.stepAccumulator += travelled;
  if (state.stepAccumulator >= stride) {
    state.stepAccumulator -= stride;
    result.footfall = true;
  }

  result.mode = actor.moveMode;
  result.speed = actualSpeed;
  result.distance = travelled;
  result.splashed = swimming && !wasInWater;

  return result;
}

/** Resolved move stats for an AI animal (no weakness modifiers involved). */
export function aiMoveStats(
  species: Species,
  base: { animalSpeed: number; turnRate: number; climbSpeed: number; jumpSpeed: number },
): MoveStats {
  const loco = ANIMALS[species].locomotion;
  const walk = base.animalSpeed * loco.landSpeed;
  return {
    walkSpeed: walk,
    sprintSpeed: walk * loco.sprintMultiplier,
    swimSpeed: base.animalSpeed * loco.swimSpeed,
    climbSpeed: base.climbSpeed * loco.climbSpeed,
    turnRate: base.turnRate * loco.agility,
    jumpPower: base.jumpSpeed * loco.jumpPower,
  };
}
