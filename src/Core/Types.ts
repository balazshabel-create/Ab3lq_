/**
 * Types.ts — the shared vocabulary of the simulation.
 *
 * Deliberately free of any Three.js or DOM types: this file is imported by the
 * Node authority server, the browser client and the tests alike.
 */

import type { Species } from '../Animals/AnimalTypes';
import type { WeaknessId } from '../Gameplay/Weaknesses';
import type { Terrain } from '../World/Terrain';
import type { Rng } from '../Systems/Rng';
// Type-only import: erased at compile time, so this does not create a runtime
// cycle with Locomotion (which imports the Actor types from here).
import type {
  MoveState,
  ObstacleResolver,
} from '../Systems/Locomotion';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function dist2D(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function dist2DSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function dist3D(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Is this actor driven by a person or by the AI? */
export enum ActorKind {
  AI = 0,
  Player = 1,
}

/** How the actor is currently getting around. Drives animation and speed. */
export enum MoveMode {
  Ground = 0,
  Swim = 1,
  Climb = 2,
  Fly = 3,
  Idle = 4,
}

/**
 * Per-actor boolean state, packed into one integer so a snapshot stays small.
 * Anything the renderer or another client needs to *see* belongs here; anything
 * secret (weakness, role) must not.
 */
export enum ActorFlags {
  None = 0,
  Sprinting = 1 << 0,
  Eating = 1 << 1,
  Submerged = 1 << 2,
  Dead = 1 << 3,
  Attacking = 1 << 4,
  Whistling = 1 << 5,
  Curled = 1 << 6,
  Alerted = 1 << 7,
  Flinching = 1 << 8,
  Camouflaged = 1 << 9,
  Airborne = 1 << 10,
}

export function hasFlag(flags: number, flag: ActorFlags): boolean {
  return (flags & flag) !== 0;
}

/**
 * The publicly visible state of one animal — player or AI.
 *
 * Crucially this is *identical in shape* for players and AI. That is the whole
 * premise of the game: a client receiving a snapshot cannot tell from the data
 * whether a capybara is a person or a script.
 */
export interface Actor {
  id: number;
  kind: ActorKind;
  species: Species;
  pos: Vec3;
  vel: Vec3;
  /** Facing, radians, 0 = +X. */
  yaw: number;
  /** Head pitch, used by flyers and by the player camera. */
  pitch: number;
  moveMode: MoveMode;
  /** Current speed as a fraction of this animal's sprint speed (0..1). */
  gait: number;
  health: number;
  maxHealth: number;
  flags: number;
  /** Fly swarm intensity, 0..1. Non-zero only for exposed survivors. */
  flies: number;
  /** Animation phase accumulator, advanced by the renderer. */
  animPhase: number;
  /** Herd this actor belongs to, or -1. */
  herdId: number;
}

/** Server-side extras for an AI animal. Never sent to clients. */
export interface AiAnimal extends Actor {
  kind: ActorKind.AI;
  behavior: AiBehavior;
  /** Seconds remaining in the current behaviour before re-evaluating. */
  behaviorTimer: number;
  /** Where the animal is currently trying to get to. */
  target: Vec3;
  /** Actor it is fleeing from or hunting, or 0. */
  focusId: number;
  /** Seconds of "I know something scary is nearby" left. */
  alertTimer: number;
  /** Cooldown on its next attack. */
  attackCooldown: number;
  /** Personal hunger, drives grazing/hunting decisions. */
  hunger: number;
  /** Small per-individual variation so a herd does not move in lockstep. */
  personality: number;
  /** Set for coarse (distant) simulation. */
  lod: number;
  /** Physics scratch state, shared with the player's movement solver. */
  move: MoveState;
  /** How long this animal has been standing still, for the stillness behaviours. */
  stillTimer: number;
  /** Cooldown before it vocalises again. */
  callCooldown: number;
}

/** A person's animal, plus everything the person needs to survive. */
export interface PlayerActor extends Actor {
  kind: ActorKind.Player;
  /** Stable network id of the owning client. */
  clientId: string;
  name: string;
  role: Role;
  /** Null for the hunter, by design. */
  weakness: WeaknessId | null;
  hunger: number;
  stamina: number;
  /** Seconds since the last whistle. Survivors must keep this under the limit. */
  sinceWhistle: number;
  whistleCooldown: number;
  /** Pending hunger from a slow-digestion meal. */
  digesting: number;
  digestRate: number;
  eatTimer: number;
  eatTargetId: number;
  attackCooldown: number;
  attackWindup: number;
  /** Time since last taking damage, for regeneration. */
  sinceDamage: number;
  /** Hunter ability cooldowns. */
  listenCooldown: number;
  listenTimer: number;
  focusCooldown: number;
  abilityCooldown: number;
  abilityTimer: number;
  /** Score tracking. */
  stats: PlayerStats;
  /** Set once the player is out. */
  deathTime: number;
  killerId: number;
  /** Connection bookkeeping. */
  lastInputTime: number;
  connected: boolean;
  /** Physics scratch state, identical to the AI's. */
  move: MoveState;
  /** Set while a predator is actively chasing, to measure escape length. */
  chasedFor: number;
}

export enum Role {
  Survivor = 'survivor',
  Hunter = 'hunter',
  Spectator = 'spectator',
}

/** Per-round statistics, used for the round-over screen and its awards. */
export interface PlayerStats {
  kills: number;
  missedAttacks: number;
  mealsEaten: number;
  whistles: number;
  lateWhistles: number;
  distanceTravelled: number;
  timeSprinting: number;
  timeInWater: number;
  timeStill: number;
  timeWithFlies: number;
  /** Longest continuous chase this player survived, in seconds. */
  longestEscape: number;
  /** Peak fly swarm intensity reached. */
  peakFlies: number;
  /** Species of the best (largest) thing this hunter killed. */
  bestKill: Species | null;
  /** AI animals eaten. */
  animalsEaten: number;
  survivedSeconds: number;
  timesNearlyCaught: number;
  /**
   * The player's score.
   *
   * Kept on the authority and never computed on a client: it decides the
   * result board, so a client that could add to its own would be deciding who
   * won. See SCORE_* in Config for what earns it.
   */
  score: number;
  /**
   * Whole minutes of survival already paid out.
   *
   * The award is per completed minute, and `survivedSeconds` is a running
   * total, so without a record of what has been paid the same minute is
   * awarded on every tick that follows it.
   */
  scoredMinutes: number;
}

export function emptyStats(): PlayerStats {
  return {
    kills: 0,
    missedAttacks: 0,
    mealsEaten: 0,
    whistles: 0,
    lateWhistles: 0,
    distanceTravelled: 0,
    timeSprinting: 0,
    timeInWater: 0,
    timeStill: 0,
    timeWithFlies: 0,
    longestEscape: 0,
    peakFlies: 0,
    bestKill: null,
    animalsEaten: 0,
    survivedSeconds: 0,
    timesNearlyCaught: 0,
    score: 0,
    scoredMinutes: 0,
  };
}

/** What an AI animal is currently doing. */
export enum AiBehavior {
  Idle = 0,
  Wander = 1,
  Graze = 2,
  Drink = 3,
  Flee = 4,
  Hunt = 5,
  Rest = 6,
  Sleep = 7,
  Bask = 8,
  Follow = 9,
  Patrol = 10,
  Vocalise = 11,
  /** Running for the middle of the storm circle. Overrides everything else. */
  FleeStorm = 12,
}

/** A transient noise in the world. The hunter's "listen" sense reads these. */
export interface NoiseEvent {
  x: number;
  z: number;
  /** Loudness in the same units as the hear-range constants. */
  volume: number;
  /** Who made it (0 for the world). */
  sourceId: number;
  /** What kind of noise, for the UI's icon. */
  kind: NoiseKind;
  /** Simulation time it happened. */
  time: number;
}

export enum NoiseKind {
  Footstep = 'footstep',
  Splash = 'splash',
  Whistle = 'whistle',
  Attack = 'attack',
  Death = 'death',
  Eat = 'eat',
  Call = 'call',
  /**
   * A gunshot.
   *
   * Separate from Attack on purpose. A shot is not a bite: it is twenty times
   * louder, it carries across the whole map, and it is *supposed* to tell every
   * survivor in earshot roughly where the hunter is and that he has just fired.
   * Sharing the bite's sound threw that information away.
   */
  Gunshot = 'gunshot',
}

/** A footprint left behind, readable by the hunter. */
export interface Track {
  x: number;
  z: number;
  yaw: number;
  species: Species;
  /** Simulation time it was made. */
  time: number;
  /** True if a player made it — but the hunter is never told this directly. */
  fromPlayer: boolean;
}

/** Weather states. */
export enum Weather {
  Clear = 'clear',
  Cloudy = 'cloudy',
  Rain = 'rain',
  Storm = 'storm',
  Fog = 'fog',
}

/** The phase a match is in. */
export enum RoundPhase {
  Lobby = 'lobby',
  Intro = 'intro',
  Playing = 'playing',
  RoundOver = 'round_over',
}

/**
 * The read-only view of the world that AI behaviours are given.
 * Keeping this an interface (rather than handing the AI the whole Simulation)
 * makes the AI trivially unit-testable.
 */
export interface AiContext {
  terrain: Terrain;
  /**
   * Collision and climbing hooks. Declared here so an AiContext is also a
   * valid LocomotionEnv — the AI and the player then provably run through the
   * same movement solver with the same world constraints.
   */
  resolveObstacles?: ObstacleResolver;
  rng: Rng;
  /** Simulation time in seconds since the round started. */
  time: number;
  /** 0..1, where 1 is full night. */
  nightFactor: number;
  /** 0..1 rainfall intensity. */
  rain: number;
  /**
   * The current weather state. Named `weatherKind` rather than `weather` so the
   * Simulation can implement this interface while keeping its own richer
   * `weather: WeatherState` field.
   */
  weatherKind: Weather;
  /** Visit every actor within `radius` of a point. */
  forEachNearby(x: number, z: number, radius: number, fn: (actor: Actor) => void): void;
  /** Look up an actor by id. */
  getActor(id: number): Actor | undefined;
  /** Nearest available food source of a kind this species eats. */
  findFood(x: number, z: number, species: Species, radius: number): Vec3 | null;
  /** Report a noise into the world. */
  emitNoise(x: number, z: number, volume: number, kind: NoiseKind, sourceId: number): void;
  /** Deal damage to an actor. Returns true if it died. */
  damageActor(
    targetId: number,
    amount: number,
    attackerId: number,
    source?: 'attack' | 'starvation' | 'storm',
  ): boolean;
  /**
   * The storm circle as it stands this tick, or null if the round has none.
   *
   * Animals need to know about it for the same reason players do: an animal that
   * stands placidly in a tornado is a tell. If the crowd outside the wall behaves
   * normally while the crowd inside runs, the wall stops being frightening and
   * starts being scenery.
   */
  readonly stormZone: { x: number; z: number; radius: number } | null;
}
