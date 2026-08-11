/**
 * AnimalAI.ts — the behaviour that players have to imitate.
 *
 * This file matters more than a normal ambient-wildlife AI, because it defines
 * the "grammar" of animal behaviour that survivors must speak fluently:
 *
 *   • Animals pause. A lot. They wander a few metres, stop, look around, graze.
 *     A player sprinting in a straight line for 40 metres is immediately wrong.
 *   • Animals never walk perfectly straight. Every path has wander noise.
 *   • Animals react to threats *late and imperfectly* — they flee only when a
 *     predator is close and in view, then forget about it after a few seconds.
 *     A player who dodges a crocodile they could not possibly have seen is
 *     telling the hunter exactly what they are.
 *   • Herd animals stay loosely together and drift towards water.
 *   • Behaviour changes with the time of day and the weather.
 *
 * All of it is legible from the outside, which is what makes the deduction fair.
 */

import {
  AI_FLEE_MEMORY,
  AI_HEAR_RANGE,
  AI_PREDATOR_ATTACK_COOLDOWN,
  AI_PREDATOR_DAMAGE,
  AI_SIGHT_ARC,
  AI_SIGHT_RANGE,
  ANIMAL_SPEED,
  CLIMB_SPEED,
  HUNGER_DECAY_RATE,
  JUMP_SPEED,
  NOISE_CALL,
  NOISE_EAT,
  NOISE_RUN,
  NOISE_SPLASH,
  NOISE_WALK,
  TURN_RATE,
  ZONE_AI_FLEE_MARGIN,
} from '../Systems/Config';
import { ANIMALS, BodyPlan, Diet, Species } from '../Animals/AnimalTypes';
import { canPrey, threatLevel } from '../Animals/FoodChain';
import {
  ActorFlags,
  AiBehavior,
  MoveMode,
  NoiseKind,
  Weather,
  dist2D,
  type Actor,
  type AiAnimal,
  type AiContext,
  type Vec3,
} from '../Core/Types';
import { GroundType } from '../World/Terrain';
import { aiMoveStats, applyMovement, emptyIntent, type MoveIntent } from '../Systems/Locomotion';
import { angleDelta, clamp01 } from '../Systems/Noise';

/** Reusable intent object — the AI runs for 200 animals per tick, so no garbage. */
const intent: MoveIntent = emptyIntent();

const moveBase = {
  animalSpeed: ANIMAL_SPEED,
  turnRate: TURN_RATE,
  climbSpeed: CLIMB_SPEED,
  jumpSpeed: JUMP_SPEED,
};

/** Herd bookkeeping, owned by the simulation and passed in. */
export interface Herd {
  id: number;
  species: Species;
  /** Slowly drifting centre the herd tends towards. */
  center: Vec3;
  /** Where the herd is heading next. */
  destination: Vec3;
  /** Seconds until the herd picks a new destination. */
  retargetIn: number;
  memberCount: number;
}

/**
 * Advance one AI animal.
 *
 * `herd` may be null for solitary animals. `lodScale` is >1 for distant animals
 * that are updated less often — their dt is multiplied so they still cover the
 * same ground, just in coarser steps.
 */
export function updateAnimal(
  animal: AiAnimal,
  ctx: AiContext,
  herd: Herd | null,
  dt: number,
): void {
  if (animal.flags & ActorFlags.Dead) return;

  const def = ANIMALS[animal.species];
  const temper = def.temperament;

  // ---- Timers -----------------------------------------------------------
  animal.behaviorTimer -= dt;
  animal.alertTimer = Math.max(0, animal.alertTimer - dt);
  animal.attackCooldown = Math.max(0, animal.attackCooldown - dt);
  animal.callCooldown = Math.max(0, animal.callCooldown - dt);
  animal.hunger = Math.max(0, animal.hunger - HUNGER_DECAY_RATE * def.hungerRate * dt * 0.35);

  // ---- Threat & prey scan ------------------------------------------------
  // Cheap: the spatial grid means we only look at genuine neighbours. Distant
  // animals scan less often via their LOD divisor.
  const sightRange =
    AI_SIGHT_RANGE * temper.sight * (ctx.weatherKind === Weather.Fog ? 0.55 : 1);
  const hearRange = AI_HEAR_RANGE * temper.hearing;
  const scanRange = Math.max(sightRange, hearRange);

  let threat: Actor | null = null;
  let threatScore = 0;
  let prey: Actor | null = null;
  let preyDist = Infinity;

  ctx.forEachNearby(animal.pos.x, animal.pos.z, scanRange, (other) => {
    if (other.id === animal.id) return;
    if (other.flags & ActorFlags.Dead) return;

    const d = dist2D(animal.pos, other.pos);

    // --- Is it dangerous? ---
    const danger = threatLevel(animal.species, other.species);
    if (danger > 0.05) {
      // Submerged crocodiles and camouflaged animals are much harder to notice.
      let noticeRange = sightRange;
      if (other.flags & ActorFlags.Submerged) noticeRange *= 0.35;
      if (other.flags & ActorFlags.Camouflaged) noticeRange *= 0.45;
      // A running predator is heard even when not seen.
      const loud = other.gait > 0.6;
      const seen = d < noticeRange && inViewCone(animal, other, AI_SIGHT_ARC);
      const heard = loud && d < hearRange;
      if (seen || heard) {
        // Closer threats dominate.
        const score = danger * (1 - clamp01(d / Math.max(1, noticeRange)));
        if (score > threatScore) {
          threatScore = score;
          threat = other;
        }
      }
    }

    // --- Is it food? ---
    if (canPrey(animal.species, other.species) && d < sightRange) {
      if (d < preyDist) {
        preyDist = d;
        prey = other;
      }
    }
  });

  if (threat) {
    animal.focusId = (threat as Actor).id;
    animal.alertTimer = AI_FLEE_MEMORY;
    if (animal.behavior !== AiBehavior.Flee) {
      // Reaction delay: real animals do not pivot instantly, and neither
      // should the AI — otherwise a player's instant reaction stands out less.
      animal.behavior = AiBehavior.Flee;
      animal.behaviorTimer = 0.12 + animal.personality * 0.35;
    }
  }

  // ---- Behaviour selection ----------------------------------------------
  if (animal.behaviorTimer <= 0) {
    chooseBehavior(animal, ctx, herd, prey, def.diet);
  }

  /*
   * ---- The storm overrides everything ----------------------------------
   *
   * Deliberately applied *after* behaviour selection, so it wins over grazing,
   * sleeping and even fleeing a jaguar. An animal does not finish its meal
   * because a predator is the more pressing concern than a tornado; it runs.
   *
   * Each animal aims at its own point well inside the circle rather than at the
   * exact centre — derived from its personality, so it is stable frame to frame.
   * Aiming everything at one pixel produced a tight knot of animals standing on
   * top of each other in the middle of the map, which is both hideous and a
   * gigantic free hint about where the circle is going.
   */
  const zone = ctx.stormZone;
  if (zone) {
    const outward = Math.hypot(animal.pos.x - zone.x, animal.pos.z - zone.z) - zone.radius;
    if (outward > -ZONE_AI_FLEE_MARGIN) {
      const spread = zone.radius * (0.25 + animal.personality * 0.45);
      const a = animal.personality * Math.PI * 2;
      animal.behavior = AiBehavior.FleeStorm;
      animal.behaviorTimer = 0.6;
      animal.target.x = zone.x + Math.cos(a) * spread;
      animal.target.z = zone.z + Math.sin(a) * spread;
    }
  }

  // ---- Behaviour execution ---------------------------------------------
  resetIntent();
  // Eating is re-asserted every tick by whichever behaviour is feeding, so it
  // always reflects this tick rather than lingering from the last one.
  animal.flags &= ~ActorFlags.Eating;
  switch (animal.behavior) {
    case AiBehavior.FleeStorm:
      // Reusing doSeek keeps the panic looking like ordinary travel — wander
      // wobble and all — which is what a player copying the crowd needs.
      doSeek(animal, ctx, 1);
      // Sprint only once the storm has actually caught us. An animal that is
      // merely near the edge trots; one standing in a tornado runs flat out.
      intent.sprint = zone !== null && isInStorm(animal, zone);
      break;
    case AiBehavior.Flee:
      doFlee(animal, ctx);
      break;
    case AiBehavior.Hunt:
      doHunt(animal, ctx);
      break;
    case AiBehavior.Graze:
      doGraze(animal, ctx);
      break;
    case AiBehavior.Drink:
      doSeek(animal, ctx, 0.45);
      break;
    case AiBehavior.Wander:
      doSeek(animal, ctx, 0.5);
      break;
    case AiBehavior.Patrol:
      doSeek(animal, ctx, 0.75);
      break;
    case AiBehavior.Follow:
      doFollow(animal, ctx, herd);
      break;
    case AiBehavior.Vocalise:
      doVocalise(animal, ctx);
      break;
    case AiBehavior.Bask:
    case AiBehavior.Rest:
    case AiBehavior.Sleep:
    case AiBehavior.Idle:
    default:
      doIdle(animal, ctx);
      break;
  }

  // ---- Movement --------------------------------------------------------
  // AiContext satisfies LocomotionEnv, so the AI and the player literally share
  // the same movement solver and the same collision rules.
  const stats = aiMoveStats(animal.species, moveBase);
  const res = applyMovement(animal, intent, stats, animal.move, ctx, dt);

  // ---- Consequences of moving ------------------------------------------
  if (res.speed < 0.08) {
    animal.stillTimer += dt;
  } else {
    animal.stillTimer = 0;
  }

  if (res.footfall) {
    const vol = (res.mode === MoveMode.Swim ? NOISE_SPLASH : animal.gait > 0.55 ? NOISE_RUN : NOISE_WALK) *
      def.noiseMultiplier;
    ctx.emitNoise(animal.pos.x, animal.pos.z, vol, NoiseKind.Footstep, animal.id);
  }
  if (res.splashed) {
    ctx.emitNoise(animal.pos.x, animal.pos.z, NOISE_SPLASH, NoiseKind.Splash, animal.id);
  }

  // Alert flag drives a subtle head-up pose in the renderer, which is one of
  // the readable cues players can copy.
  animal.flags = animal.alertTimer > 0
    ? animal.flags | ActorFlags.Alerted
    : animal.flags & ~ActorFlags.Alerted;

  // Ambush predators submerge or hold still, which is how a hunter crocodile
  // gets to look exactly like scenery.
  const holding = animal.behavior === AiBehavior.Idle || animal.behavior === AiBehavior.Bask;
  if (
    def.locomotion.canSubmerge &&
    temper.aquatic > 0.6 &&
    holding &&
    animal.moveMode === MoveMode.Swim
  ) {
    animal.flags |= ActorFlags.Submerged;
  }
}

// ---------------------------------------------------------------------------
// Behaviour selection
// ---------------------------------------------------------------------------

/**
 * Pick the next behaviour and how long to hold it.
 *
 * Weighted rather than a strict priority chain: an animal that always makes the
 * optimal choice reads as artificial in the other direction, and gives players
 * an impossible standard to imitate.
 */
function chooseBehavior(
  animal: AiAnimal,
  ctx: AiContext,
  herd: Herd | null,
  prey: Actor | null,
  diet: Diet,
): void {
  const def = ANIMALS[animal.species];
  const temper = def.temperament;
  const night = ctx.nightFactor;

  // Nocturnal animals are sleepy by day and vice versa.
  const sleepiness = temper.nocturnal ? 1 - night : night;

  // Still alert? Keep moving away rather than settling down.
  if (animal.alertTimer > 0 && animal.behavior === AiBehavior.Flee) {
    animal.behavior = AiBehavior.Wander;
    animal.behaviorTimer = 1.4 + animal.personality;
    pickWanderTarget(animal, ctx, 26);
    return;
  }

  const options: AiBehavior[] = [];
  const weights: number[] = [];

  const push = (b: AiBehavior, w: number) => {
    if (w > 0) {
      options.push(b);
      weights.push(w);
    }
  };

  // Hunting: only predators, only when hungry enough to bother.
  const carnivorous = diet === Diet.Carnivore || diet === Diet.Piscivore;
  if (prey && carnivorous && animal.hunger < 78) {
    push(AiBehavior.Hunt, 40 + temper.aggression * 60);
  }

  // Feeding.
  if (animal.hunger < 65) {
    push(AiBehavior.Graze, 34 + (65 - animal.hunger) * 0.7);
  } else {
    push(AiBehavior.Graze, 10);
  }

  // Water: everything in the Amazon goes to the river eventually.
  push(AiBehavior.Drink, 12 + temper.aquatic * 30);

  // Idle / rest / sleep — the behaviours that make the jungle feel alive and
  // give players permission to just stand there.
  push(AiBehavior.Idle, 22 + temper.stillness * 60);
  push(AiBehavior.Sleep, sleepiness * 45 + temper.stillness * 20);
  const coldBlooded = def.silhouette.bodyPlan === BodyPlan.Reptile;
  push(AiBehavior.Bask, temper.aquatic > 0.5 || coldBlooded ? 18 : 4);

  // Movement.
  push(AiBehavior.Wander, 40);
  push(AiBehavior.Patrol, temper.aggression > 0.5 ? 22 : 6);

  // Herding.
  if (herd && temper.social) {
    const distToHerd = dist2D(animal.pos, herd.center);
    push(AiBehavior.Follow, 18 + Math.min(70, distToHerd * 2.4));
  }

  // Vocalising: howler monkeys, macaws, frogs at night.
  if (animal.callCooldown <= 0) {
    const vocal = def.noiseMultiplier > 1.05 ? 22 : 7;
    push(AiBehavior.Vocalise, vocal * (0.5 + night));
  }

  // Rain drives animals under cover.
  if (ctx.rain > 0.4) {
    push(AiBehavior.Rest, 30 * ctx.rain);
  }
  // Fog makes everything cautious and slow.
  if (ctx.weatherKind === Weather.Fog) {
    push(AiBehavior.Idle, 24);
  }

  animal.behavior = ctx.rng.pickWeighted(options, weights);

  // Duration depends on the behaviour: pauses are short, sleeps are long.
  switch (animal.behavior) {
    case AiBehavior.Idle:
      animal.behaviorTimer = ctx.rng.range(1.2, 4.5) * (0.6 + temper.stillness);
      break;
    case AiBehavior.Sleep:
      animal.behaviorTimer = ctx.rng.range(8, 20);
      break;
    case AiBehavior.Bask:
    case AiBehavior.Rest:
      animal.behaviorTimer = ctx.rng.range(4, 12);
      break;
    case AiBehavior.Graze:
      animal.behaviorTimer = ctx.rng.range(3.5, 9);
      pickFoodTarget(animal, ctx);
      break;
    case AiBehavior.Drink:
      animal.behaviorTimer = ctx.rng.range(5, 12);
      pickWaterTarget(animal, ctx);
      break;
    case AiBehavior.Hunt:
      animal.behaviorTimer = ctx.rng.range(3, 7);
      animal.focusId = prey ? prey.id : 0;
      break;
    case AiBehavior.Follow:
      animal.behaviorTimer = ctx.rng.range(2.5, 6);
      if (herd) setTarget(animal, herd.destination.x, herd.destination.z, ctx);
      break;
    case AiBehavior.Vocalise:
      animal.behaviorTimer = ctx.rng.range(1.2, 2.6);
      animal.callCooldown = ctx.rng.range(14, 40);
      break;
    case AiBehavior.Patrol:
      animal.behaviorTimer = ctx.rng.range(4, 10);
      pickWanderTarget(animal, ctx, 45);
      break;
    case AiBehavior.Wander:
    default:
      animal.behaviorTimer = ctx.rng.range(2.5, 7);
      pickWanderTarget(animal, ctx, 22);
      break;
  }
}

// ---------------------------------------------------------------------------
// Behaviour implementations
// ---------------------------------------------------------------------------

/** Has the storm already reached this animal, as opposed to being nearby? */
function isInStorm(animal: AiAnimal, zone: { x: number; z: number; radius: number }): boolean {
  return Math.hypot(animal.pos.x - zone.x, animal.pos.z - zone.z) > zone.radius;
}

function resetIntent(): void {
  intent.dirX = 0;
  intent.dirZ = 0;
  intent.throttle = 0;
  intent.sprint = false;
  intent.jump = false;
  intent.climb = 0;
  intent.submerge = false;
  intent.ascend = 0;
  intent.wantsFlight = false;
}

/** Stand still. Flyers land, climbers stay put, everything else just breathes. */
function doIdle(animal: AiAnimal, ctx: AiContext): void {
  const def = ANIMALS[animal.species];
  if (def.locomotion.canFly) {
    // Perching birds settle; some keep circling so the sky is never empty.
    intent.wantsFlight = animal.personality > 0.65;
    if (intent.wantsFlight) {
      intent.dirX = Math.cos(animal.yaw);
      intent.dirZ = Math.sin(animal.yaw);
      intent.throttle = 0.35;
      // Slow circling.
      animal.yaw += 0.25 * ctx.rng.range(0.4, 1) * (animal.personality > 0.8 ? 1 : -1) * 0.05;
    }
  }
  if (ANIMALS[animal.species].temperament.aquatic > 0.6 && ctx.terrain.isDeepWater(animal.pos.x, animal.pos.z)) {
    intent.submerge = animal.personality > 0.4;
  }
}

/** Head to the current target, with wander noise so the path is never a line. */
function doSeek(animal: AiAnimal, ctx: AiContext, throttle: number): void {
  const dx = animal.target.x - animal.pos.x;
  const dz = animal.target.z - animal.pos.z;
  const d = Math.hypot(dx, dz);

  if (d < 1.8) {
    // Arrived: pause here for a beat, which is the single most imitable
    // behaviour in the game.
    animal.behavior = AiBehavior.Idle;
    animal.behaviorTimer = ctx.rng.range(0.8, 3.2);
    return;
  }

  // Wander noise: a slow sine wobble keyed off this individual's personality.
  const wobble = Math.sin(ctx.time * (0.5 + animal.personality * 0.6) + animal.personality * 10) * 0.35;
  const heading = Math.atan2(dz, dx) + wobble;
  intent.dirX = Math.cos(heading);
  intent.dirZ = Math.sin(heading);
  intent.throttle = throttle * (0.82 + animal.personality * 0.3);

  const def = ANIMALS[animal.species];
  if (def.locomotion.canFly) intent.wantsFlight = d > 14;
  if (def.locomotion.canClimb && def.temperament.arboreal > 0.7) {
    // Arboreal animals prefer to be up a tree; climb when one is to hand.
    intent.climb = animal.move.climbTreeId !== 0 ? 0 : ctx.rng.chance(0.02) ? 1 : 0;
  }
}

/** Nose to the ground, shuffling in small steps. */
function doGraze(animal: AiAnimal, ctx: AiContext): void {
  const dx = animal.target.x - animal.pos.x;
  const dz = animal.target.z - animal.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > 2.2) {
    doSeek(animal, ctx, 0.42);
    return;
  }
  // At the food: small idle shuffles and the eating flag.
  animal.flags |= ActorFlags.Eating;
  animal.hunger = Math.min(100, animal.hunger + 9 * 0.05);
  if (ctx.rng.chance(0.02)) {
    ctx.emitNoise(animal.pos.x, animal.pos.z, NOISE_EAT, NoiseKind.Eat, animal.id);
  }
  if (ctx.rng.chance(0.03)) {
    // Take a step to the next mouthful.
    intent.dirX = ctx.rng.range(-1, 1);
    intent.dirZ = ctx.rng.range(-1, 1);
    intent.throttle = 0.22;
  }
}

/** Run away from whatever scared us, preferring water or dense cover. */
function doFlee(animal: AiAnimal, ctx: AiContext): void {
  const threat = ctx.getActor(animal.focusId);
  const def = ANIMALS[animal.species];

  if (!threat || animal.alertTimer <= 0) {
    animal.behavior = AiBehavior.Wander;
    animal.behaviorTimer = ctx.rng.range(1, 3);
    return;
  }

  let away = Math.atan2(animal.pos.z - threat.pos.z, animal.pos.x - threat.pos.x);
  // Bias the escape towards the animal's preferred refuge.
  if (def.temperament.aquatic > 0.5) {
    const river = nearestWaterDirection(animal, ctx);
    if (river !== null) away = blendAngles(away, river, 0.45);
  } else if (def.temperament.arboreal > 0.6) {
    intent.climb = 1;
  }

  // Panicked animals do not run in a perfectly straight line either.
  away += Math.sin(ctx.time * 3.1 + animal.personality * 6) * 0.22;

  intent.dirX = Math.cos(away);
  intent.dirZ = Math.sin(away);
  intent.throttle = 1;
  intent.sprint = true;
  if (def.locomotion.canFly) {
    intent.wantsFlight = true;
    intent.ascend = 1;
  }
  if (def.locomotion.canJump && ctx.rng.chance(0.02)) intent.jump = true;
}

/** Close on prey and bite it. AI predators are a real (if minor) hazard. */
function doHunt(animal: AiAnimal, ctx: AiContext): void {
  const target = ctx.getActor(animal.focusId);
  if (!target || target.flags & ActorFlags.Dead) {
    animal.behavior = AiBehavior.Wander;
    animal.behaviorTimer = 1;
    animal.focusId = 0;
    return;
  }

  const d = dist2D(animal.pos, target.pos);
  const def = ANIMALS[animal.species];

  if (d > AI_SIGHT_RANGE * 1.6) {
    // Lost it.
    animal.behavior = AiBehavior.Wander;
    animal.behaviorTimer = 1.5;
    animal.focusId = 0;
    return;
  }

  const heading = Math.atan2(target.pos.z - animal.pos.z, target.pos.x - animal.pos.x);
  intent.dirX = Math.cos(heading);
  intent.dirZ = Math.sin(heading);

  const reach = 1.2 + def.silhouette.length * 0.5;
  if (d <= reach) {
    intent.throttle = 0.2;
    if (animal.attackCooldown <= 0) {
      animal.attackCooldown = AI_PREDATOR_ATTACK_COOLDOWN;
      animal.flags |= ActorFlags.Attacking;
      ctx.emitNoise(animal.pos.x, animal.pos.z, NOISE_RUN * 1.4, NoiseKind.Attack, animal.id);
      const killed = ctx.damageActor(target.id, AI_PREDATOR_DAMAGE, animal.id);
      if (killed) {
        animal.hunger = 100;
        animal.behavior = AiBehavior.Graze;
        animal.behaviorTimer = 6;
        animal.focusId = 0;
      }
    }
  } else {
    intent.throttle = 1;
    // Stalk when far, sprint when close: readable, and copyable by a player
    // hunter who wants to look like an AI jaguar.
    intent.sprint = d < 18;
    animal.flags &= ~ActorFlags.Attacking;
  }
}

/** Stay near the herd's drifting centre. */
function doFollow(animal: AiAnimal, ctx: AiContext, herd: Herd | null): void {
  if (!herd) {
    doSeek(animal, ctx, 0.5);
    return;
  }
  const d = dist2D(animal.pos, herd.center);
  // Personal space: do not pile onto the exact centre point.
  if (d < 4 + animal.personality * 4) {
    doIdle(animal, ctx);
    return;
  }
  setTarget(animal, herd.center.x, herd.center.z, ctx);
  doSeek(animal, ctx, d > 22 ? 0.8 : 0.45);
}

/** Howl, screech or croak — and give away your position doing it. */
function doVocalise(animal: AiAnimal, ctx: AiContext): void {
  if (ctx.rng.chance(0.08)) {
    ctx.emitNoise(
      animal.pos.x,
      animal.pos.z,
      NOISE_CALL * ANIMALS[animal.species].noiseMultiplier,
      NoiseKind.Call,
      animal.id,
    );
  }
}

// ---------------------------------------------------------------------------
// Target helpers
// ---------------------------------------------------------------------------

function setTarget(animal: AiAnimal, x: number, z: number, ctx: AiContext): void {
  animal.target.x = x;
  animal.target.z = z;
  animal.target.y = ctx.terrain.surfaceAt(x, z);
}

function pickWanderTarget(animal: AiAnimal, ctx: AiContext, radius: number): void {
  const def = ANIMALS[animal.species];
  for (let i = 0; i < 6; i++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const r = ctx.rng.range(radius * 0.3, radius);
    const x = animal.pos.x + Math.cos(a) * r;
    const z = animal.pos.z + Math.sin(a) * r;
    if (!ctx.terrain.inBounds(x, z)) continue;
    const deep = ctx.terrain.isDeepWater(x, z);
    // Water animals want water, land animals do not.
    if (deep && def.locomotion.swimSpeed < 0.4) continue;
    if (!deep && def.temperament.aquatic > 0.85) continue;
    setTarget(animal, x, z, ctx);
    return;
  }
  // Fall back to drifting towards the map centre so nothing gets stuck on the rim.
  setTarget(animal, animal.pos.x * 0.9, animal.pos.z * 0.9, ctx);
}

function pickFoodTarget(animal: AiAnimal, ctx: AiContext): void {
  const food = ctx.findFood(animal.pos.x, animal.pos.z, animal.species, 60);
  if (food) {
    setTarget(animal, food.x, food.z, ctx);
    return;
  }
  // Herbivores can graze anywhere with foliage; head for the thickest nearby.
  let bestX = animal.pos.x;
  let bestZ = animal.pos.z;
  let best = -1;
  for (let i = 0; i < 8; i++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const r = ctx.rng.range(4, 34);
    const x = animal.pos.x + Math.cos(a) * r;
    const z = animal.pos.z + Math.sin(a) * r;
    if (!ctx.terrain.inBounds(x, z) || ctx.terrain.isDeepWater(x, z)) continue;
    const f = ctx.terrain.foliageAt(x, z);
    if (f > best) {
      best = f;
      bestX = x;
      bestZ = z;
    }
  }
  setTarget(animal, bestX, bestZ, ctx);
}

function pickWaterTarget(animal: AiAnimal, ctx: AiContext): void {
  for (let i = 0; i < 12; i++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const r = ctx.rng.range(6, 70);
    const x = animal.pos.x + Math.cos(a) * r;
    const z = animal.pos.z + Math.sin(a) * r;
    if (!ctx.terrain.inBounds(x, z)) continue;
    const g = ctx.terrain.groundTypeAt(x, z);
    const wantsDeep = ANIMALS[animal.species].temperament.aquatic > 0.7;
    if (wantsDeep ? g === GroundType.DeepWater : g === GroundType.ShallowWater) {
      setTarget(animal, x, z, ctx);
      return;
    }
  }
  pickWanderTarget(animal, ctx, 30);
}

/** Direction of the nearest water, or null if none is close. */
function nearestWaterDirection(animal: AiAnimal, ctx: AiContext): number | null {
  let bestAngle: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    for (let r = 8; r <= 48; r += 10) {
      const x = animal.pos.x + Math.cos(a) * r;
      const z = animal.pos.z + Math.sin(a) * r;
      if (ctx.terrain.isWater(x, z) && r < bestDist) {
        bestDist = r;
        bestAngle = a;
        break;
      }
    }
  }
  return bestAngle;
}

function blendAngles(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/** Is `other` inside `animal`'s view cone? */
function inViewCone(animal: Actor, other: Actor, arc: number): boolean {
  const toOther = Math.atan2(other.pos.z - animal.pos.z, other.pos.x - animal.pos.x);
  return Math.abs(angleDelta(animal.yaw, toOther)) < arc * 0.5;
}

// ---------------------------------------------------------------------------
// Herd management
// ---------------------------------------------------------------------------

/** Drift a herd's centre towards its destination and pick new ones. */
export function updateHerd(herd: Herd, ctx: AiContext, dt: number): void {
  herd.retargetIn -= dt;
  if (herd.retargetIn <= 0) {
    herd.retargetIn = ctx.rng.range(18, 46);
    const def = ANIMALS[herd.species];
    // Herds drift towards water, or towards food-rich jungle.
    const wantsWater = def.temperament.aquatic > 0.4 && ctx.rng.chance(0.55);
    const p = wantsWater
      ? ctx.terrain.findShorePosition(ctx.rng)
      : ctx.terrain.findLandPosition(ctx.rng);
    // Keep the destination reachable rather than teleporting across the map.
    const dx = p.x - herd.center.x;
    const dz = p.z - herd.center.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.min(d, 120);
    herd.destination.x = herd.center.x + (dx / d) * step;
    herd.destination.z = herd.center.z + (dz / d) * step;
  }

  const dx = herd.destination.x - herd.center.x;
  const dz = herd.destination.z - herd.center.z;
  const d = Math.hypot(dx, dz);
  if (d > 1) {
    const speed = ANIMAL_SPEED * ANIMALS[herd.species].locomotion.landSpeed * 0.28;
    herd.center.x += (dx / d) * speed * dt;
    herd.center.z += (dz / d) * speed * dt;
  }
  herd.center.y = ctx.terrain.surfaceAt(herd.center.x, herd.center.z);
}
