/**
 * Simulation.ts — the authoritative world.
 *
 * This runs on the Node server for real multiplayer, and *also* in the browser
 * for single-player and for the "host" in local play. One implementation, no
 * divergence: a bug that only appears online is the worst kind of bug in a
 * deduction game, because it looks like cheating.
 *
 * It is deliberately free of any rendering concern. The renderer consumes
 * snapshots, exactly like a remote client does.
 */

import {
  AI_LOD_DISTANCE,
  AI_LOD_TICK_DIVISOR,
  AI_POPULATION,
  AI_SPECIES_COVER_MIN,
  ANIMAL_SPEED,
  CLIENT_TIMEOUT,
  CLIMB_SPEED,
  CORPSE_LIFETIME,
  EAT_REACH,
  HEALTH_MAX,
  HERD_SIZE_MAX,
  HERD_SIZE_MIN,
  HUNGER_DECAY_RATE,
  HUNGER_START,
  HUNTER_ATTACK_ARC,
  HUNTER_ATTACK_COOLDOWN,
  HUNTER_ATTACK_RANGE,
  HUNTER_ATTACK_WINDUP,
  HUNTER_DAMAGE,
  HUNTER_SPEED_BONUS,
  JUMP_SPEED,
  NOISE_ATTACK,
  NOISE_DEATH,
  NOISE_RUN,
  NOISE_SPLASH,
  NOISE_WALK,
  PLAYER_INTEREST_RANGE,
  SENSE_FOCUS_COOLDOWN,
  SENSE_LISTEN_COOLDOWN,
  SENSE_LISTEN_DURATION,
  SENSE_LISTEN_RANGE,
  SPRINT_MULTIPLIER,
  STAMINA_DRAIN_RATE,
  STAMINA_EXHAUSTED_THRESHOLD,
  STAMINA_MAX,
  STAMINA_RECOVERY_THRESHOLD,
  STAMINA_REGEN_DELAY,
  STAMINA_REGEN_RATE,
  TRACK_LIFETIME,
  TRACK_SPAWN_INTERVAL,
  TRACK_VISIBLE_RANGE,
  TURN_RATE,
  WATER_LEVEL,
  WHISTLE_HEAR_RANGE,
  ZONE_AI_DAMAGE_SCALE,
  ZONE_ENABLED,
} from '../Systems/Config';
import {
  evaluateZone,
  isOutside,
  planRings,
  type ZoneRing,
  type ZoneSnapshot,
} from '../Gameplay/StormZone';
import { Rng, hashString } from '../Systems/Rng';
import { angleDelta, clamp01 } from '../Systems/Noise';
import { SpatialGrid } from '../Systems/SpatialGrid';
import { Terrain } from '../World/Terrain';
import { generateWorld, type FoodSource, type WorldContent } from '../World/WorldGen';
import {
  ANIMALS,
  AbilityId,
  Diet,
  SPAWNABLE_SPECIES,
  Species,
  SizeClass,
  isEnabled,
} from '../Animals/AnimalTypes';
import { canEat, canPrey, tierOfSource } from '../Animals/FoodChain';
import {
  ActorFlags,
  ActorKind,
  AiBehavior,
  MoveMode,
  NoiseKind,
  Role,
  RoundPhase,
  Weather,
  dist2D,
  emptyStats,
  vec3,
  type Actor,
  type AiAnimal,
  type AiContext,
  type NoiseEvent,
  type PlayerActor,
  type Track,
  type Vec3,
} from './Types';
import {
  applyMovement,
  emptyIntent,
  newMoveState,
  type MoveIntent,
  type MoveStats,
} from '../Systems/Locomotion';
import { updateAnimal, updateHerd, type Herd } from '../AI/AnimalAI';
import {
  awardNutrition,
  cancelEating,
  canStartEating,
  startEating,
  updateEating,
  updateHunger,
} from '../Gameplay/HungerSystem';
import {
  tryWhistle,
  updateWhistle,
  whistleVolume,
} from '../Gameplay/WhistleSystem';
import { resolveStats, type ResolvedStats } from '../Gameplay/Weaknesses';
import {
  createWeather,
  noiseDamping,
  updateWeather,
  type WeatherState,
} from '../Environment/WeatherSystem';
import {
  createSchedule,
  eventAiSpeedScale,
  eventForcedWeather,
  eventNoiseScale,
  eventWaterRise,
  updateSchedule,
  type EventDef,
  type EventSchedule,
} from '../Gameplay/RandomEvents';
import {
  assignRoles,
  beginIntro,
  beginPlaying,
  beginRoundOver,
  buildResult,
  checkEndCondition,
  createRound,
  returnToLobby,
  type Round,
  type RoleAssignment,
  type RoundResult,
  type RoundStatus,
} from '../Gameplay/RoundState';
import { InputAction, hasAction, type PlayerInput } from '../Networking/Protocol';

/** Events the simulation reports upward, for the server to broadcast. */
export interface SimEvents {
  onKill?: (
    victim: Actor,
    killer: Actor | null,
    cause: 'hunter' | 'predator' | 'starvation' | 'storm',
  ) => void;
  onEvent?: (def: EventDef) => void;
  onRoundEnd?: (result: RoundResult) => void;
  onRoundStart?: (assignments: RoleAssignment[]) => void;
}

/** A tree entry in the obstacle grid. */
interface Obstacle {
  id: number;
  pos: { x: number; z: number };
  radius: number;
  /** Climbable height, 0 for rocks and huts. */
  climbHeight: number;
}

const statBase = {
  animalSpeed: ANIMAL_SPEED,
  sprintMultiplier: SPRINT_MULTIPLIER,
  turnRate: TURN_RATE,
  healthMax: HEALTH_MAX,
  staminaMax: STAMINA_MAX,
  staminaDrain: STAMINA_DRAIN_RATE,
  staminaRegen: STAMINA_REGEN_RATE,
  hungerDecay: HUNGER_DECAY_RATE,
  eatDuration: 2.6,
  climbSpeed: CLIMB_SPEED,
  jumpSpeed: JUMP_SPEED,
};

export class Simulation implements AiContext {
  readonly seed: number;
  readonly terrain: Terrain;
  readonly world: WorldContent;
  readonly rng: Rng;

  round: Round;
  weather: WeatherState;
  schedule: EventSchedule;

  /**
   * The sequence of storm circles for this round, and where the wall is now.
   *
   * `zone` is recomputed from `round.elapsed` every tick rather than integrated,
   * so it cannot drift — see StormZone.ts for why that matters.
   */
  zoneRings: ZoneRing[] = [];
  zone: ZoneSnapshot;

  /** Simulation time in seconds since this Simulation was constructed. */
  time = 0;
  tick = 0;

  /** All actors by id — players and AI in one map, deliberately. */
  private actors = new Map<number, Actor>();
  private animals: AiAnimal[] = [];
  private players: PlayerActor[] = [];
  private herds = new Map<number, Herd>();
  private nextActorId = 1;
  private nextHerdId = 1;

  private grid = new SpatialGrid<Actor>(26);
  private obstacleGrid = new SpatialGrid<Obstacle>(18);
  private obstacles: Obstacle[] = [];

  private noises: NoiseEvent[] = [];
  private tracks: Track[] = [];
  private corpses: { actorId: number; timeLeft: number }[] = [];

  /** Per-player resolved stats, recomputed when role/species/weakness changes. */
  private statsCache = new Map<number, ResolvedStats>();
  /** Latest input per player actor id. */
  private inputs = new Map<number, PlayerInput>();
  private trackTimers = new Map<number, number>();

  private events: SimEvents;
  private waterRise = 0;
  private aiSpeedScale = 1;
  private noiseScale = 1;

  constructor(seed: number, events: SimEvents = {}, cosmetic = false) {
    this.seed = seed;
    this.events = events;
    this.rng = new Rng(seed).fork('sim');
    this.terrain = new Terrain(seed);
    this.world = generateWorld(this.terrain, seed, {
      cosmetic,
      cosmeticDensity: 1,
    });
    this.round = createRound(seed);
    this.weather = createWeather(this.rng.fork('weather'));
    this.schedule = createSchedule(this.rng.fork('events'));
    // Plan a circle straight away so the menu and lobby worlds have somewhere
    // sensible to put animals, even before a round is dealt.
    this.zoneRings = ZONE_ENABLED ? planRings(this.terrain, this.rng.fork('zone')) : [];
    this.zone = evaluateZone(this.zoneRings, 0);
    this.buildObstacles();
  }

  /** The disc that spawns are drawn from: the opening circle of this round. */
  private get spawnArea(): { x: number; z: number; radius: number } {
    const first = this.zoneRings[0];
    if (!first) return Terrain.WHOLE_MAP;
    return { x: first.x, z: first.z, radius: first.radius };
  }

  // =========================================================================
  // AiContext implementation
  // =========================================================================

  get nightFactor(): number {
    return this.weather.nightFactor;
  }

  get rain(): number {
    return this.weather.rain;
  }

  /** AiContext's view of the sky. */
  get weatherKind(): Weather {
    return this.weather.current;
  }

  /** AiContext's view of the storm circle. */
  get stormZone(): { x: number; z: number; radius: number } | null {
    if (this.zoneRings.length === 0) return null;
    return this.zone;
  }

  forEachNearby(x: number, z: number, radius: number, fn: (actor: Actor) => void): void {
    this.grid.forEachInRadius(x, z, radius, fn);
  }

  getActor(id: number): Actor | undefined {
    return this.actors.get(id);
  }

  findFood(x: number, z: number, species: Species, radius: number): Vec3 | null {
    let best: FoodSource | null = null;
    let bestDist = radius * radius;
    for (const food of this.world.foodSources) {
      if (!food.available) continue;
      if (!canEat(species, tierOfSource(food.kind))) continue;
      const dx = food.x - x;
      const dz = food.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = food;
      }
    }
    return best ? vec3(best.x, best.y, best.z) : null;
  }

  emitNoise(x: number, z: number, volume: number, kind: NoiseKind, sourceId: number): void {
    // Rain and events change how far sound carries, which is a real tactical
    // consideration for both sides.
    const scaled = volume * noiseDamping(this.weather) * this.noiseScale;
    if (scaled < 1) return;
    this.noises.push({ x, z, volume: scaled, kind, sourceId, time: this.time });
    // Bound the buffer: only the last couple of seconds are ever queried.
    if (this.noises.length > 512) this.noises.splice(0, this.noises.length - 512);
  }

  /**
   * Apply damage. Returns true if the target died.
   *
   * This is the single choke point for death in the game, so kill attribution,
   * corpse creation and statistics can never disagree with each other.
   */
  damageActor(
    targetId: number,
    amount: number,
    attackerId: number,
    /**
     * What is doing the damage, for sources with no attacker actor.
     *
     * Without this every attacker-less death was reported as starvation, which
     * would have labelled everyone the storm killed as having starved. It also
     * separates "something bit me" from environmental attrition, which matters
     * because only the former is a near miss worth counting.
     */
    source: 'attack' | 'starvation' | 'storm' = 'attack',
  ): boolean {
    const target = this.actors.get(targetId);
    if (!target || target.flags & ActorFlags.Dead) return false;

    target.health -= amount;
    if (target.kind === ActorKind.Player) {
      const p = target as PlayerActor;
      p.sinceDamage = 0;
      // Only a bite is a near miss. Ticking this for the storm would count
      // twenty "closest calls" per second of standing in the rain and hand the
      // award to whoever wandered out of the circle for longest.
      if (source === 'attack') p.stats.timesNearlyCaught++;
      cancelEating(p);
    }

    if (target.health > 0) return false;

    target.health = 0;
    target.flags |= ActorFlags.Dead;

    const attacker = this.actors.get(attackerId) ?? null;
    this.emitNoise(target.pos.x, target.pos.z, NOISE_DEATH, NoiseKind.Death, target.id);

    // Attribute the kill.
    let cause: 'hunter' | 'predator' | 'starvation' | 'storm' = 'predator';
    if (attacker && attacker.kind === ActorKind.Player) {
      const killer = attacker as PlayerActor;
      cause = killer.role === Role.Hunter ? 'hunter' : 'predator';
      killer.stats.kills++;
      const size = ANIMALS[target.species].size;
      const bestSize = killer.stats.bestKill ? ANIMALS[killer.stats.bestKill].size : -1;
      if (size > bestSize) killer.stats.bestKill = target.species;
    } else if (attackerId === 0) {
      cause = source === 'storm' ? 'storm' : 'starvation';
    }

    if (target.kind === ActorKind.Player) {
      const p = target as PlayerActor;
      p.deathTime = this.time;
      p.killerId = attackerId;
      // The role is deliberately left intact: the reveal screen needs it.
    }

    // Corpses become carrion, which is a genuine food source and a genuine
    // clue: a fresh body tells a survivor the hunter was just here.
    this.corpses.push({ actorId: target.id, timeLeft: CORPSE_LIFETIME });
    this.events.onKill?.(target, attacker, cause);
    return true;
  }

  // =========================================================================
  // Setup
  // =========================================================================

  /** Build the obstacle grid from trees, rocks and huts. */
  private buildObstacles(): void {
    let id = 1;
    for (const tree of this.world.trees) {
      this.obstacles.push({
        id: id++,
        pos: { x: tree.x, z: tree.z },
        radius: tree.radius,
        climbHeight: tree.height,
      });
    }
    for (const rock of this.world.rocks) {
      if (rock.scale < 1.1) continue; // small rocks are steppable
      this.obstacles.push({
        id: id++,
        pos: { x: rock.x, z: rock.z },
        radius: rock.scale * 0.55,
        climbHeight: 0,
      });
    }
    for (const hut of this.world.huts) {
      this.obstacles.push({
        id: id++,
        pos: { x: hut.x, z: hut.z },
        radius: 2.4 * hut.scale,
        climbHeight: 0,
      });
    }
    this.obstacleGrid.rebuild(this.obstacles);
  }

  /** LocomotionEnv hook: push a position out of any solid prop. */
  resolveObstacles = (
    x: number,
    z: number,
    radius: number,
    out: { x: number; z: number },
  ): boolean => {
    let moved = false;
    out.x = x;
    out.z = z;
    // Radius 4 covers the largest trunk plus the largest body.
    this.obstacleGrid.forEachInRadius(x, z, radius + 4, (o) => {
      const dx = out.x - o.pos.x;
      const dz = out.z - o.pos.z;
      const minDist = o.radius + radius;
      const d = Math.hypot(dx, dz);
      if (d < minDist && d > 1e-4) {
        const push = (minDist - d) / d;
        out.x += dx * push;
        out.z += dz * push;
        moved = true;
      } else if (d <= 1e-4) {
        // Exactly on the trunk centre: nudge out deterministically.
        out.x += minDist;
        moved = true;
      }
    });
    return moved;
  };

  /** LocomotionEnv hook: find a climbable trunk in reach. */
  findClimbTarget = (x: number, z: number, reach: number) => {
    const found = this.obstacleGrid.findNearest(x, z, reach + 2, (o) => o.climbHeight > 3);
    if (!found) return null;
    const d = Math.hypot(found.pos.x - x, found.pos.z - z);
    if (d > found.radius + reach) return null;
    return {
      id: found.id,
      x: found.pos.x,
      z: found.pos.z,
      height: found.climbHeight,
      radius: found.radius,
    };
  };

  /**
   * Populate the world with AI animals.
   *
   * `coverSpecies` are the species chosen by players; the spawner guarantees a
   * healthy crowd of each so hiding in plain sight is actually possible. This
   * is the single most important spawn rule in the game — a lone player
   * capybara in a world with no other capybaras is just a target.
   */
  populate(coverSpecies: Species[] = []): void {
    this.animals = [];
    this.herds.clear();
    for (const [id, actor] of [...this.actors]) {
      if (actor.kind === ActorKind.AI) this.actors.delete(id);
    }

    const rng = this.rng.fork('population');
    let budget = AI_POPULATION;

    // 1. Guaranteed cover for every species a player is using.
    const unique = [...new Set(coverSpecies)];
    for (const species of unique) {
      const count = Math.max(AI_SPECIES_COVER_MIN, Math.round(AI_SPECIES_COVER_MIN * 1.2));
      this.spawnGroup(species, count, rng);
      budget -= count;
    }

    // 2. Fill the rest with a believable spread of the whole ecosystem.
    // Weight towards common, harmless species so predators stay special.
    // SPAWNABLE_SPECIES rather than ALL_SPECIES: withdrawn species keep their
    // table entry (the wire format indexes into it) but must never be spawned.
    const fillers = SPAWNABLE_SPECIES.filter((s) => !unique.includes(s));
    const weights = fillers.map((s) => {
      const def = ANIMALS[s];
      let w = 10;
      if (def.size >= SizeClass.Large) w = 2.5; // apex predators are rare
      if (!def.playable) w = 8; // ambient life is common
      if (def.temperament.social) w *= 1.5;
      return w;
    });

    while (budget > 0 && fillers.length > 0) {
      const species = rng.pickWeighted(fillers, weights);
      const def = ANIMALS[species];
      const groupSize = def.temperament.social
        ? rng.int(HERD_SIZE_MIN, HERD_SIZE_MAX)
        : rng.int(1, 2);
      const n = Math.min(budget, groupSize);
      this.spawnGroup(species, n, rng);
      budget -= n;
    }

    this.rebuildGrid();
  }

  /** Spawn `count` animals of one species, as a herd if the species is social. */
  private spawnGroup(species: Species, count: number, rng: Rng): void {
    const def = ANIMALS[species];
    const aquatic = def.temperament.aquatic;
    const area = this.spawnArea;
    const anchor =
      aquatic > 0.8
        ? this.terrain.findWaterPosition(rng, area)
        : aquatic > 0.4
          ? this.terrain.findShorePosition(rng, area)
          : this.terrain.findLandPosition(rng, area);

    let herd: Herd | null = null;
    if (def.temperament.social && count > 1) {
      herd = {
        id: this.nextHerdId++,
        species,
        center: vec3(anchor.x, this.terrain.surfaceAt(anchor.x, anchor.z), anchor.z),
        destination: vec3(anchor.x, 0, anchor.z),
        retargetIn: rng.range(4, 30),
        memberCount: count,
      };
      this.herds.set(herd.id, herd);
    }

    for (let i = 0; i < count; i++) {
      // Cluster herd members around the anchor; scatter solitary animals.
      const spread = herd ? rng.range(1, 14) : rng.range(1, 60);
      const a = rng.range(0, Math.PI * 2);
      let x = anchor.x + Math.cos(a) * spread;
      let z = anchor.z + Math.sin(a) * spread;
      // Both constraints matter: inside the heightfield, and inside the circle.
      // The scatter radius is wide enough to fling a solitary animal into the
      // storm, and an animal that spawns there spends the round running for its
      // life instead of behaving like scenery to hide among.
      if (!this.terrain.inBounds(x, z) || Math.hypot(x - area.x, z - area.z) > area.radius * 0.94) {
        x = anchor.x;
        z = anchor.z;
      }
      // Do not strand a land animal in the river, or a fish on the bank.
      const deep = this.terrain.isDeepWater(x, z);
      if (deep && def.locomotion.swimSpeed < 0.4) {
        const p = this.terrain.findLandPosition(rng, area);
        x = p.x;
        z = p.z;
      } else if (!deep && aquatic > 0.9) {
        const p = this.terrain.findWaterPosition(rng, area);
        x = p.x;
        z = p.z;
      }
      this.spawnAnimal(species, x, z, herd?.id ?? -1, rng);
    }
  }

  private spawnAnimal(
    species: Species,
    x: number,
    z: number,
    herdId: number,
    rng: Rng,
  ): AiAnimal {
    const def = ANIMALS[species];
    const animal: AiAnimal = {
      id: this.nextActorId++,
      kind: ActorKind.AI,
      species,
      pos: vec3(x, this.terrain.surfaceAt(x, z), z),
      vel: vec3(),
      yaw: rng.range(0, Math.PI * 2),
      pitch: 0,
      moveMode: MoveMode.Idle,
      gait: 0,
      health: HEALTH_MAX * def.healthMultiplier,
      maxHealth: HEALTH_MAX * def.healthMultiplier,
      flags: ActorFlags.None,
      flies: 0,
      animPhase: rng.range(0, Math.PI * 2),
      herdId,
      behavior: AiBehavior.Idle,
      behaviorTimer: rng.range(0.2, 4),
      target: vec3(x, 0, z),
      focusId: 0,
      alertTimer: 0,
      attackCooldown: 0,
      hunger: rng.range(45, 100),
      personality: rng.next(),
      lod: 0,
      move: newMoveState(),
      stillTimer: 0,
      callCooldown: rng.range(0, 30),
    };
    this.animals.push(animal);
    this.actors.set(animal.id, animal);
    return animal;
  }

  // =========================================================================
  // Players
  // =========================================================================

  /** Add a player and return their actor. Called on join, before role dealing. */
  addPlayer(clientId: string, name: string): PlayerActor {
    const rng = this.rng.fork(`spawn:${clientId}`);
    const spot = this.terrain.findShelteredPosition(rng, this.spawnArea);
    const species = Species.Capybara; // placeholder until roles are dealt
    const def = ANIMALS[species];

    const player: PlayerActor = {
      id: this.nextActorId++,
      kind: ActorKind.Player,
      clientId,
      name,
      species,
      pos: vec3(spot.x, this.terrain.surfaceAt(spot.x, spot.z), spot.z),
      vel: vec3(),
      yaw: rng.range(0, Math.PI * 2),
      pitch: 0,
      moveMode: MoveMode.Idle,
      gait: 0,
      health: HEALTH_MAX * def.healthMultiplier,
      maxHealth: HEALTH_MAX * def.healthMultiplier,
      flags: ActorFlags.None,
      flies: 0,
      animPhase: 0,
      herdId: -1,
      role: Role.Survivor,
      weakness: null,
      hunger: HUNGER_START,
      stamina: STAMINA_MAX,
      sinceWhistle: 0,
      whistleCooldown: 0,
      digesting: 0,
      digestRate: 0,
      eatTimer: 0,
      eatTargetId: 0,
      attackCooldown: 0,
      attackWindup: 0,
      sinceDamage: 999,
      listenCooldown: 0,
      listenTimer: 0,
      focusCooldown: 0,
      abilityCooldown: 0,
      abilityTimer: 0,
      stats: emptyStats(),
      deathTime: 0,
      killerId: 0,
      lastInputTime: this.time,
      connected: true,
      move: newMoveState(),
      chasedFor: 0,
    };

    this.players.push(player);
    this.actors.set(player.id, player);
    this.refreshStats(player);
    return player;
  }

  removePlayer(clientId: string): void {
    const idx = this.players.findIndex((p) => p.clientId === clientId);
    if (idx < 0) return;
    const player = this.players[idx];
    player.connected = false;
    // Keep the actor around during a round so the reveal still lists them.
    if (this.round.phase === RoundPhase.Lobby) {
      this.actors.delete(player.id);
      this.players.splice(idx, 1);
      this.statsCache.delete(player.id);
      this.inputs.delete(player.id);
    }
  }

  getPlayer(clientId: string): PlayerActor | undefined {
    return this.players.find((p) => p.clientId === clientId);
  }

  getPlayers(): readonly PlayerActor[] {
    return this.players;
  }

  getAnimalCount(): number {
    return this.animals.length;
  }

  /** Recompute a player's stat block after a role or species change. */
  refreshStats(player: PlayerActor): void {
    const stats = resolveStats(
      player.species,
      player.weakness,
      statBase,
      player.role === Role.Hunter,
    );
    if (player.role === Role.Hunter) {
      // The hunter's edge: slightly faster, no weakness. Not overwhelming —
      // a hunter who can simply run everything down does not have to deduce.
      stats.walkSpeed *= HUNTER_SPEED_BONUS;
      stats.sprintSpeed *= HUNTER_SPEED_BONUS;
      stats.swimSpeed *= HUNTER_SPEED_BONUS;
    }
    this.statsCache.set(player.id, stats);
    player.maxHealth = stats.maxHealth;
    player.health = Math.min(player.health, stats.maxHealth);
  }

  statsFor(player: PlayerActor): ResolvedStats {
    let s = this.statsCache.get(player.id);
    if (!s) {
      this.refreshStats(player);
      s = this.statsCache.get(player.id)!;
    }
    return s;
  }

  /** Queue a player's input for the next tick. */
  applyInput(clientId: string, input: PlayerInput): void {
    const player = this.getPlayer(clientId);
    if (!player) return;
    const existing = this.inputs.get(player.id);
    // Ignore out-of-order packets.
    if (existing && input.seq < existing.seq) return;
    this.inputs.set(player.id, input);
    player.lastInputTime = this.time;
  }

  // =========================================================================
  // Round flow
  // =========================================================================

  /** Deal roles and start the intro countdown. */
  startRound(): RoleAssignment[] {
    const ids = this.players.filter((p) => p.connected).map((p) => p.clientId);
    const assignments = assignRoles(ids, this.rng.fork(`roles:${this.tick}`));

    // Draw this round's circle before anything is placed, since every spawn —
    // players, herds, solitary animals — is sampled from inside it.
    this.zoneRings = ZONE_ENABLED
      ? planRings(this.terrain, this.rng.fork(`zone:${this.tick}`))
      : [];
    this.zone = evaluateZone(this.zoneRings, 0);
    const area = this.spawnArea;

    for (const a of assignments) {
      const player = this.getPlayer(a.clientId);
      if (!player) continue;
      player.role = a.role;
      player.species = a.species;
      player.weakness = a.weakness;
      player.stats = emptyStats();
      player.hunger = HUNGER_START;
      player.stamina = STAMINA_MAX;
      player.sinceWhistle = 0;
      player.whistleCooldown = 0;
      player.flies = 0;
      player.flags = ActorFlags.None;
      player.digesting = 0;
      player.eatTimer = 0;
      player.deathTime = 0;
      player.killerId = 0;
      player.move = newMoveState();
      player.chasedFor = 0;
      this.refreshStats(player);
      player.health = player.maxHealth;

      // Respawn each player somewhere appropriate for their species, well away
      // from everyone else.
      const rng = this.rng.fork(`respawn:${a.clientId}:${this.tick}`);
      const aquatic = ANIMALS[a.species].temperament.aquatic;
      /*
       * Only genuinely aquatic animals (caimans, anacondas) start in the water.
       * Everything else — including strong swimmers like the capybara, whose
       * aquatic preference is 0.65 — starts under cover on land.
       *
       * Spawning a capybara at the waterline sounds thematic but plays badly:
       * the opening view is an empty water plane, there is no foliage to hide
       * in because nothing grows in a river, and the player is silhouetted in
       * the open from the first second. They can walk to the water themselves.
       */
      const spot =
        aquatic > 0.8
          ? this.terrain.findWaterPosition(rng, area)
          : this.terrain.findShelteredPosition(rng, area);
      player.pos.x = spot.x;
      player.pos.z = spot.z;
      player.pos.y = this.terrain.surfaceAt(spot.x, spot.z);
    }

    this.round.hunterClientId =
      assignments.find((a) => a.role === Role.Hunter)?.clientId ?? null;

    // Repopulate so every player's species has a crowd to hide in.
    this.populate(assignments.map((a) => a.species));

    // Reset the round's environment.
    this.weather = createWeather(this.rng.fork(`weather:${this.tick}`));
    this.schedule = createSchedule(this.rng.fork(`events:${this.tick}`));
    this.noises.length = 0;
    this.tracks.length = 0;
    this.corpses.length = 0;
    for (const food of this.world.foodSources) {
      food.available = true;
      food.respawnIn = 0;
    }

    beginIntro(this.round);
    this.events.onRoundStart?.(assignments);
    return assignments;
  }

  /** Public round status, safe for everyone. */
  roundStatus(): RoundStatus {
    const survivors = this.players.filter((p) => p.role === Role.Survivor && p.connected);
    return {
      phase: this.round.phase,
      timeLeft: Math.max(0, this.round.phaseTimer),
      elapsed: this.round.elapsed,
      survivorsAlive: survivors.filter((p) => p.health > 0).length,
      survivorsTotal: survivors.length,
      result: this.round.result,
    };
  }

  // =========================================================================
  // The tick
  // =========================================================================

  /** Advance the whole world by `dt` seconds. */
  update(dt: number): void {
    this.time += dt;
    this.tick++;

    // --- Environment -----------------------------------------------------
    const started = updateSchedule(this.schedule, this.rng, this.round.elapsed, dt);
    for (const def of started) {
      this.applyEventOneShot(def);
      this.events.onEvent?.(def);
    }
    updateWeather(this.weather, this.rng, this.round.elapsed, dt);
    const forced = eventForcedWeather(this.schedule);
    if (forced) {
      this.weather.current = forced;
      this.weather.next = forced;
      this.weather.blend = 1;
    }
    this.waterRise = eventWaterRise(this.schedule);
    this.aiSpeedScale = eventAiSpeedScale(this.schedule);
    this.noiseScale = eventNoiseScale(this.schedule);

    // --- Round phase -----------------------------------------------------
    this.updatePhase(dt);

    // --- The storm circle ------------------------------------------------
    // A pure function of elapsed round time, so this is a recompute rather than
    // an integration and the wall is in exactly the same place on every machine.
    this.zone = evaluateZone(this.zoneRings, this.round.elapsed);

    // --- Spatial index ---------------------------------------------------
    this.rebuildGrid();

    // --- Actors ----------------------------------------------------------
    const simulating = this.round.phase === RoundPhase.Playing;
    this.updateAnimals(dt, simulating);
    if (simulating) {
      for (const player of this.players) this.updatePlayer(player, dt);
      this.applyStormToAnimals(dt);
    }

    // --- Housekeeping ----------------------------------------------------
    this.updateFood(dt);
    this.updateCorpses(dt);
    this.pruneNoises();
    this.pruneTracks();
    this.timeoutIdlePlayers();
  }

  private updatePhase(dt: number): void {
    switch (this.round.phase) {
      case RoundPhase.Intro:
        this.round.phaseTimer -= dt;
        if (this.round.phaseTimer <= 0) beginPlaying(this.round);
        break;
      case RoundPhase.Playing: {
        this.round.phaseTimer -= dt;
        this.round.elapsed += dt;
        const check = checkEndCondition(this.round, this.players);
        if (check.ended) {
          // Bank survival time before building the reveal.
          for (const p of this.players) {
            if (p.health > 0) p.stats.survivedSeconds = this.round.elapsed;
          }
          const result = buildResult(this.round, this.players, check.winner);
          beginRoundOver(this.round, result);
          this.events.onRoundEnd?.(result);
        }
        break;
      }
      case RoundPhase.RoundOver:
        this.round.phaseTimer -= dt;
        if (this.round.phaseTimer <= 0) returnToLobby(this.round);
        break;
      default:
        break;
    }
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const a of this.animals) {
      if (a.flags & ActorFlags.Dead) continue;
      this.grid.insert(a);
    }
    for (const p of this.players) {
      if (p.flags & ActorFlags.Dead) continue;
      this.grid.insert(p);
    }
  }

  /**
   * Update AI animals, with distance-based level of detail.
   *
   * Animals far from every player run at a fraction of the tick rate with a
   * correspondingly larger dt. They still travel the same distance and make the
   * same decisions — they just do it in coarser steps that nobody can see.
   * This is what keeps 200 animals affordable.
   */
  private updateAnimals(dt: number, full: boolean): void {
    // Herd centres first, so members steer towards an up-to-date target.
    for (const herd of this.herds.values()) updateHerd(herd, this, dt);

    const scaledDt = dt * this.aiSpeedScale;

    for (let i = 0; i < this.animals.length; i++) {
      const animal = this.animals[i];
      if (animal.flags & ActorFlags.Dead) continue;

      // Distance to the nearest player decides the LOD band.
      let nearest = Infinity;
      for (const p of this.players) {
        if (!p.connected || p.flags & ActorFlags.Dead) continue;
        const d = dist2D(animal.pos, p.pos);
        if (d < nearest) nearest = d;
      }

      if (!full) {
        // Between rounds the jungle keeps moving, just cheaply — the main menu
        // and the lobby both show a live world.
        if ((this.tick + i) % AI_LOD_TICK_DIVISOR !== 0) continue;
        updateAnimal(animal, this, this.herdOf(animal), scaledDt * AI_LOD_TICK_DIVISOR);
        continue;
      }

      if (nearest > AI_LOD_DISTANCE) {
        animal.lod = 1;
        if ((this.tick + i) % AI_LOD_TICK_DIVISOR !== 0) continue;
        updateAnimal(animal, this, this.herdOf(animal), scaledDt * AI_LOD_TICK_DIVISOR);
      } else {
        animal.lod = 0;
        updateAnimal(animal, this, this.herdOf(animal), scaledDt);
      }
    }
  }

  private herdOf(animal: AiAnimal): Herd | null {
    return animal.herdId >= 0 ? this.herds.get(animal.herdId) ?? null : null;
  }

  /**
   * The storm bites AI animals too, but gently.
   *
   * They already run for the middle of the circle (see the storm behaviour in
   * AnimalAI), so most never take a scratch. The damage exists for the ones that
   * get cornered against a cliff or a river they cannot cross: without it they
   * would stand in the tornado forever, and a player could learn to read the
   * storm's edge for a suspiciously calm crowd. A third of the player rate means
   * a stuck animal dies in its own time instead of vanishing on cue.
   */
  private applyStormToAnimals(dt: number): void {
    if (this.zoneRings.length === 0) return;
    const rate = this.zone.damageRate * ZONE_AI_DAMAGE_SCALE * dt;
    if (rate <= 0) return;
    for (const animal of this.animals) {
      if (animal.flags & ActorFlags.Dead) continue;
      if (!isOutside(this.zone, animal.pos.x, animal.pos.z)) continue;
      this.damageActor(animal.id, rate, 0, 'storm');
    }
  }

  // =========================================================================
  // Player update
  // =========================================================================

  private updatePlayer(player: PlayerActor, dt: number): void {
    const stats = this.statsFor(player);

    if (player.flags & ActorFlags.Dead) {
      player.gait = 0;
      return;
    }

    const input = this.inputs.get(player.id);
    const intent = this.buildIntent(player, input);

    // --- Cooldowns -------------------------------------------------------
    player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    player.listenCooldown = Math.max(0, player.listenCooldown - dt);
    player.listenTimer = Math.max(0, player.listenTimer - dt);
    player.focusCooldown = Math.max(0, player.focusCooldown - dt);
    player.abilityCooldown = Math.max(0, player.abilityCooldown - dt);
    player.abilityTimer = Math.max(0, player.abilityTimer - dt);

    // --- Stamina ---------------------------------------------------------
    const wantsSprint = intent.sprint;
    const canSprint =
      player.stamina > STAMINA_EXHAUSTED_THRESHOLD ||
      (player.stamina > STAMINA_RECOVERY_THRESHOLD && wantsSprint);
    const sprinting = wantsSprint && canSprint && intent.throttle > 0.4;
    intent.sprint = sprinting;

    if (sprinting) {
      player.stamina = Math.max(0, player.stamina - stats.staminaDrain * dt);
      player.stats.timeSprinting += dt;
      player.sinceDamage = Math.min(player.sinceDamage, STAMINA_REGEN_DELAY);
    } else if (player.stamina < stats.maxStamina) {
      player.stamina = Math.min(stats.maxStamina, player.stamina + stats.staminaRegen * dt);
    }

    // --- The "Easily Scared" weakness ------------------------------------
    // A flinch the player did not ask for. Subtle, brief, and never takes
    // control away for long — but a hunter watching closely will notice an
    // animal twitch at exactly the wrong moment.
    if (stats.flinchChance > 0 && player.abilityTimer <= 0) {
      let predatorNear = false;
      this.grid.forEachInRadius(player.pos.x, player.pos.z, 14, (other) => {
        if (other.id === player.id) return;
        if (ANIMALS[other.species].temperament.aggression > 0.55) predatorNear = true;
      });
      if (predatorNear && this.rng.chance(stats.flinchChance * dt)) {
        player.flags |= ActorFlags.Flinching;
        player.abilityTimer = 0.42;
        // A real, visible stumble: the animal jerks sideways.
        player.yaw += this.rng.range(-0.9, 0.9);
        intent.throttle *= 0.15;
      }
    }
    if (player.abilityTimer <= 0) player.flags &= ~ActorFlags.Flinching;

    // --- Movement --------------------------------------------------------
    const moveStats: MoveStats = {
      walkSpeed: stats.walkSpeed,
      sprintSpeed: stats.sprintSpeed,
      swimSpeed: stats.swimSpeed,
      climbSpeed: stats.climbSpeed,
      turnRate: stats.turnRate,
      jumpPower: stats.jumpPower,
    };
    const res = applyMovement(player, intent, moveStats, player.move, this, dt);

    player.stats.distanceTravelled += res.distance;
    if (res.mode === MoveMode.Swim) player.stats.timeInWater += dt;
    if (res.speed < 0.1) player.stats.timeStill += dt;

    // --- Noise -----------------------------------------------------------
    if (res.footfall) {
      const base = res.mode === MoveMode.Swim ? NOISE_SPLASH : sprinting ? NOISE_RUN : NOISE_WALK;
      this.emitNoise(
        player.pos.x,
        player.pos.z,
        base * stats.noiseScale,
        NoiseKind.Footstep,
        player.id,
      );
      this.maybeLeaveTrack(player, true);
    }
    if (res.splashed) {
      this.emitNoise(player.pos.x, player.pos.z, NOISE_SPLASH, NoiseKind.Splash, player.id);
    }

    // --- Eating ----------------------------------------------------------
    if (updateEating(player, dt, (x, z, v, k, id) => this.emitNoise(x, z, v, k, id))) {
      this.finishMeal(player, stats);
    }

    // --- The storm -------------------------------------------------------
    // Damage is applied at the boundary the server computed this tick, and the
    // client draws the wall from that same authoritative circle — so what you
    // see is where it hurts.
    if (this.zoneRings.length > 0 && isOutside(this.zone, player.pos.x, player.pos.z)) {
      this.damageActor(player.id, this.zone.damageRate * dt, 0, 'storm');
      // Being out here also resets regeneration, so you cannot heal in the storm
      // by standing still: the only cure is getting back inside.
      player.sinceDamage = 0;
      if (player.flags & ActorFlags.Dead) return;
    }

    // --- Hunger, health --------------------------------------------------
    const starved = updateHunger(player, stats, dt);
    if (starved) this.damageActor(player.id, 0, 0);

    // --- Whistle & flies -------------------------------------------------
    updateWhistle(player, dt);
    player.flags &= ~ActorFlags.Whistling;

    // --- Actions ---------------------------------------------------------
    if (input) this.handleActions(player, input, stats);

    // --- Chase tracking, for the "longest escape" award -------------------
    let beingChased = false;
    this.grid.forEachInRadius(player.pos.x, player.pos.z, 22, (other) => {
      if (other.id === player.id) return;
      if (other.flags & ActorFlags.Dead) return;
      const aggressive = ANIMALS[other.species].temperament.aggression > 0.5;
      const hunterActor =
        other.kind === ActorKind.Player && (other as PlayerActor).role === Role.Hunter;
      if (!aggressive && !hunterActor) return;
      // Only count it as a chase if the thing is actually moving towards us.
      const toMe = Math.atan2(player.pos.z - other.pos.z, player.pos.x - other.pos.x);
      if (Math.abs(angleDelta(other.yaw, toMe)) < 0.9 && other.gait > 0.35) beingChased = true;
    });
    if (beingChased) {
      player.chasedFor += dt;
      if (player.chasedFor > player.stats.longestEscape) {
        player.stats.longestEscape = player.chasedFor;
      }
    } else {
      player.chasedFor = 0;
    }

    player.stats.survivedSeconds = this.round.elapsed;
  }

  /** Translate a network input packet into a movement intent. */
  private buildIntent(player: PlayerActor, input: PlayerInput | undefined): MoveIntent {
    const intent = emptyIntent();
    if (!input) return intent;

    intent.dirX = input.moveX;
    intent.dirZ = input.moveZ;
    const mag = Math.hypot(input.moveX, input.moveZ);
    intent.throttle = clamp01(mag);
    intent.sprint = hasAction(input.actions, InputAction.Sprint);
    intent.jump = hasAction(input.actions, InputAction.Jump);
    intent.submerge = hasAction(input.actions, InputAction.Submerge);
    intent.climb =
      (hasAction(input.actions, InputAction.ClimbUp) ? 1 : 0) -
      (hasAction(input.actions, InputAction.ClimbDown) ? 1 : 0);
    intent.wantsFlight = hasAction(input.actions, InputAction.Fly);
    intent.ascend =
      (hasAction(input.actions, InputAction.Ascend) ? 1 : 0) -
      (hasAction(input.actions, InputAction.Descend) ? 1 : 0);

    // The player's own look direction is authoritative for aiming; the movement
    // solver still enforces the species' turn rate for the *body*.
    player.pitch = input.pitch;

    // Camouflage abilities require standing still, checked here so it cannot be
    // faked by a client that lies about its state.
    if (player.abilityTimer > 0 && intent.throttle > 0.1) {
      const ability = ANIMALS[player.species].ability;
      if (ability === AbilityId.ColorShift || ability === AbilityId.DeadHang) {
        player.abilityTimer = 0;
        player.flags &= ~ActorFlags.Camouflaged;
      }
    }

    return intent;
  }

  /** Handle one-shot actions: whistle, eat, attack, senses, abilities. */
  private handleActions(player: PlayerActor, input: PlayerInput, stats: ResolvedStats): void {
    // --- Whistle ---------------------------------------------------------
    if (hasAction(input.actions, InputAction.Whistle)) {
      const result = tryWhistle(player, stats);
      if (result.whistled) {
        this.emitNoise(
          player.pos.x,
          player.pos.z,
          whistleVolume(stats),
          NoiseKind.Whistle,
          player.id,
        );
        // Nearby AI animals react to a whistle, which is a genuine risk: a
        // startled herd is a signal in itself.
        this.grid.forEachInRadius(
          player.pos.x,
          player.pos.z,
          WHISTLE_HEAR_RANGE * stats.whistleRangeScale * 0.4,
          (other) => {
            if (other.kind !== ActorKind.AI) return;
            const ai = other as AiAnimal;
            if (ANIMALS[ai.species].temperament.skittishness > 0.55 && this.rng.chance(0.35)) {
              ai.alertTimer = 1.6;
              ai.behavior = AiBehavior.Wander;
              ai.behaviorTimer = 0.4;
            }
          },
        );
      }
    }

    // --- Eat -------------------------------------------------------------
    if (hasAction(input.actions, InputAction.Eat) && player.eatTimer <= 0) {
      this.tryEat(player, stats);
    }

    // --- Attack ----------------------------------------------------------
    if (hasAction(input.actions, InputAction.Attack)) {
      this.tryAttack(player, stats);
    }

    // --- Hunter senses ---------------------------------------------------
    if (hasAction(input.actions, InputAction.Listen) && player.listenCooldown <= 0) {
      player.listenCooldown = SENSE_LISTEN_COOLDOWN;
      player.listenTimer = SENSE_LISTEN_DURATION;
    }
    if (hasAction(input.actions, InputAction.Focus) && player.focusCooldown <= 0) {
      player.focusCooldown = SENSE_FOCUS_COOLDOWN;
    }

    // --- Signature ability ----------------------------------------------
    if (hasAction(input.actions, InputAction.Ability) && player.abilityCooldown <= 0) {
      this.useAbility(player);
    }
  }

  /** Find something edible in reach and start a meal. */
  private tryEat(player: PlayerActor, stats: ResolvedStats): void {
    // 1. Carcasses in reach. Live prey has to be killed first — that is what
    //    the attack is for, and it is what drags predators into the open.
    let bestActor: Actor | null = null;
    let bestDist = EAT_REACH;
    // The spatial grid only holds the living, so corpses are scanned directly.
    for (const corpse of this.corpses) {
      const other = this.actors.get(corpse.actorId);
      if (!other || other.id === player.id) continue;
      const d = dist2D(player.pos, other.pos);
      if (d < bestDist) {
        bestDist = d;
        bestActor = other;
      }
    }
    if (bestActor) {
      const target = bestActor as Actor;
      const attempt = canStartEating(player, 'carrion', bestDist);
      if (attempt.started) {
        startEating(player, stats, target.id);
        return;
      }
    }

    // 2. World food sources.
    let bestFood: FoodSource | null = null;
    let bestFoodDist = EAT_REACH;
    for (const food of this.world.foodSources) {
      if (!food.available) continue;
      const tier = tierOfSource(food.kind);
      if (!canEat(player.species, tier)) continue;
      const d = Math.hypot(food.x - player.pos.x, food.z - player.pos.z);
      if (d < bestFoodDist) {
        bestFoodDist = d;
        bestFood = food;
      }
    }
    if (bestFood) {
      const attempt = canStartEating(player, tierOfSource(bestFood.kind), bestFoodDist);
      if (attempt.started) {
        startEating(player, stats, -bestFood.id);
        return;
      }
    }

    // 3. Grazing: herbivores can eat the undergrowth itself, anywhere lush.
    if (canEat(player.species, 'plant')) {
      const density = this.terrain.foliageAt(player.pos.x, player.pos.z);
      if (density > 0.28 && !this.terrain.isDeepWater(player.pos.x, player.pos.z)) {
        startEating(player, stats, 0);
      }
    }
  }

  /** Resolve a completed meal into hunger. */
  private finishMeal(player: PlayerActor, stats: ResolvedStats): void {
    const targetId = player.eatTargetId;
    player.eatTargetId = 0;

    if (targetId < 0) {
      // A world food source: deplete it and start it regrowing.
      const food = this.world.foodSources.find((f) => f.id === -targetId);
      if (food) {
        food.available = false;
        food.respawnIn = 45 + this.rng.range(0, 40);
        awardNutrition(player, tierOfSource(food.kind), stats);
      }
      return;
    }

    if (targetId > 0) {
      const corpse = this.actors.get(targetId);
      if (corpse) {
        awardNutrition(player, 'carrion', stats);
        player.stats.animalsEaten++;
        // A carcass feeds more than one meal, so remove it only sometimes.
        if (this.rng.chance(0.5)) this.removeActor(targetId);
      }
      return;
    }

    // Grazing on the undergrowth.
    awardNutrition(player, 'plant', stats);
  }

  /**
   * The hunter's (and any predator player's) attack.
   *
   * Deliberately unforgiving: a narrow arc, a windup, and a long cooldown on a
   * miss. A hunter who guesses wrong pays for it — and a missed lunge is a very
   * loud, very public event that tells every survivor nearby exactly what just
   * happened.
   */
  private tryAttack(player: PlayerActor, stats: ResolvedStats): void {
    if (player.attackCooldown > 0) return;
    const def = ANIMALS[player.species];

    /*
     * Every animal can attack. Whether it *should* is another matter.
     *
     * This used to refuse outright for anything that was not a decent-sized
     * meat eater, which read as the button being broken. Letting everyone swing
     * is better: a cornered capybara biting back is a real (desperate) option,
     * and a frog attacking a jaguar is its own kind of answer. The balance lives
     * in the damage instead of in a refusal — a herbivore's bite is a third of a
     * predator's, and body size scales it further, so a tiny herbivore is doing
     * little more than making a point.
     */
    const meatEater =
      def.diet === Diet.Carnivore ||
      def.diet === Diet.Piscivore ||
      def.diet === Diet.Omnivore;
    const sizeFactor = [0.22, 0.5, 0.8, 1.0, 1.15][def.size] ?? 0.8;
    const attackPower = (meatEater ? 1 : 0.34) * sizeFactor;

    player.attackCooldown = HUNTER_ATTACK_COOLDOWN;
    player.flags |= ActorFlags.Attacking;
    player.attackWindup = HUNTER_ATTACK_WINDUP;
    cancelEating(player);

    this.emitNoise(
      player.pos.x,
      player.pos.z,
      NOISE_ATTACK * stats.noiseScale,
      NoiseKind.Attack,
      player.id,
    );

    // Find the best target inside the bite arc.
    const range = HUNTER_ATTACK_RANGE + def.silhouette.length * 0.35;
    let target: Actor | null = null;
    let bestScore = -Infinity;
    this.grid.forEachInRadius(player.pos.x, player.pos.z, range, (other) => {
      if (other.id === player.id) return;
      if (other.flags & ActorFlags.Dead) return;
      const toOther = Math.atan2(other.pos.z - player.pos.z, other.pos.x - player.pos.x);
      const off = Math.abs(angleDelta(player.yaw, toOther));
      if (off > HUNTER_ATTACK_ARC * 0.5) return;
      // Prefer whatever is most directly in front.
      const d = dist2D(player.pos, other.pos);
      const score = -off * 2 - d * 0.1;
      if (score > bestScore) {
        bestScore = score;
        target = other;
      }
    });

    if (!target) {
      player.stats.missedAttacks++;
      return;
    }

    const victim = target as Actor;
    const armoured = (victim.flags & ActorFlags.Curled) !== 0;

    /*
     * Damage depends on what was bitten, and the difference is deliberate.
     *
     * Against another *player* the bite is intentionally survivable: at
     * HUNTER_DAMAGE it takes three of them, on a slow cooldown, so being found
     * is not the same as being dead and a chase is a real contest.
     *
     * Against an *AI animal* that would be nonsense. A fleeing capybara at 100
     * HP would need three connected bites across seven seconds, so predators
     * could never actually feed — which broke the food chain the whole design
     * rests on, and made the attack feel like it did nothing at all. A predator
     * taking natural prey therefore kills outright, exactly as it does when the
     * AI hunts. Anything else it can reach still takes a heavy hit.
     */
    let damage: number;
    if (victim.kind === ActorKind.Player) {
      const roleScale = player.role === Role.Hunter ? 1 : 0.55;
      damage = HUNTER_DAMAGE * roleScale * attackPower;
    } else if (canPrey(player.species, victim.species)) {
      // A predator taking its natural prey succeeds outright, as the AI does.
      damage = victim.maxHealth;
    } else {
      damage = HUNTER_DAMAGE * 1.8 * attackPower;
    }

    this.damageActor(victim.id, armoured ? damage * 0.3 : damage, player.id);
  }

  /** Activate the species' signature ability. */
  private useAbility(player: PlayerActor): void {
    const ability = ANIMALS[player.species].ability;
    if (!ability) return;

    switch (ability) {
      case AbilityId.Submerge:
        // Handled continuously via the submerge input; the ability button gives
        // a burst of extra concealment.
        player.abilityTimer = 6;
        player.abilityCooldown = 12;
        player.flags |= ActorFlags.Submerged;
        break;
      case AbilityId.DeadHang:
      case AbilityId.ColorShift:
      case AbilityId.HerdBlend:
        // Concealment abilities: they only hold while the player stays still,
        // enforced in buildIntent.
        player.abilityTimer = 10;
        player.abilityCooldown = 16;
        player.flags |= ActorFlags.Camouflaged;
        break;
      case AbilityId.Pounce: {
        // A short explosive leap in the facing direction.
        player.abilityTimer = 0.45;
        player.abilityCooldown = 9;
        const stats = this.statsFor(player);
        player.move.vy = stats.jumpPower * 0.8;
        player.move.airborne = true;
        player.pos.x += Math.cos(player.yaw) * 2.2;
        player.pos.z += Math.sin(player.yaw) * 2.2;
        break;
      }
      case AbilityId.BranchLeap: {
        player.abilityTimer = 0.4;
        player.abilityCooldown = 5;
        const stats = this.statsFor(player);
        player.move.vy = stats.jumpPower * 1.15;
        player.move.airborne = true;
        break;
      }
      case AbilityId.SilentSlither:
        player.abilityTimer = 9;
        player.abilityCooldown = 15;
        player.flags |= ActorFlags.Camouflaged;
        break;
      case AbilityId.Glide:
        player.abilityTimer = 5;
        player.abilityCooldown = 8;
        player.move.airborne = true;
        player.move.vy = Math.max(player.move.vy, 3.5);
        break;
      case AbilityId.CurlUp:
        player.abilityTimer = 5;
        player.abilityCooldown = 11;
        player.flags |= ActorFlags.Curled;
        break;
      default:
        break;
    }
  }

  /** Leave a footprint, at most every TRACK_SPAWN_INTERVAL seconds. */
  private maybeLeaveTrack(actor: Actor, fromPlayer: boolean): void {
    // No tracks in water or in the air.
    if (actor.moveMode === MoveMode.Swim || actor.moveMode === MoveMode.Fly) return;
    const last = this.trackTimers.get(actor.id) ?? -99;
    if (this.time - last < TRACK_SPAWN_INTERVAL) return;
    this.trackTimers.set(actor.id, this.time);
    this.tracks.push({
      x: actor.pos.x,
      z: actor.pos.z,
      yaw: actor.yaw,
      species: actor.species,
      time: this.time,
      fromPlayer,
    });
    if (this.tracks.length > 900) this.tracks.splice(0, this.tracks.length - 900);
  }

  // =========================================================================
  // Housekeeping
  // =========================================================================

  private applyEventOneShot(def: EventDef): void {
    // An event must never resurrect a withdrawn species.
    if (def.spawnBurst && isEnabled(def.spawnBurst.species)) {
      const rng = this.rng.fork(`burst:${def.id}:${this.tick}`);
      this.spawnGroup(def.spawnBurst.species, def.spawnBurst.count, rng);
      this.rebuildGrid();
    }
    if (def.refillFood) {
      for (const food of this.world.foodSources) {
        food.available = true;
        food.respawnIn = 0;
      }
    }
  }

  private updateFood(dt: number): void {
    for (const food of this.world.foodSources) {
      if (food.available) continue;
      food.respawnIn -= dt;
      if (food.respawnIn <= 0) food.available = true;
    }
  }

  private updateCorpses(dt: number): void {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.timeLeft -= dt;
      if (c.timeLeft <= 0) {
        this.corpses.splice(i, 1);
        const actor = this.actors.get(c.actorId);
        // Dead players stay in the world as spectator anchors until the reveal.
        if (actor && actor.kind === ActorKind.AI) this.removeActor(c.actorId);
      }
    }
  }

  private removeActor(id: number): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    this.actors.delete(id);
    if (actor.kind === ActorKind.AI) {
      const idx = this.animals.findIndex((a) => a.id === id);
      if (idx >= 0) this.animals.splice(idx, 1);
    }
    this.trackTimers.delete(id);
  }

  private pruneNoises(): void {
    // Keep two seconds of history — enough for the hunter's listen window to
    // sample, cheap to scan.
    const cutoff = this.time - 2.5;
    let i = 0;
    while (i < this.noises.length && this.noises[i].time < cutoff) i++;
    if (i > 0) this.noises.splice(0, i);
  }

  private pruneTracks(): void {
    const cutoff = this.time - TRACK_LIFETIME;
    let i = 0;
    while (i < this.tracks.length && this.tracks[i].time < cutoff) i++;
    if (i > 0) this.tracks.splice(0, i);
  }

  private timeoutIdlePlayers(): void {
    for (const p of this.players) {
      if (!p.connected) continue;
      if (this.time - p.lastInputTime > CLIENT_TIMEOUT) p.connected = false;
    }
  }

  // =========================================================================
  // Snapshots
  // =========================================================================

  /** The water plane height, raised during a flash flood. */
  get currentWaterLevel(): number {
    return WATER_LEVEL + this.waterRise;
  }

  /**
   * Build the snapshot for one client.
   *
   * Interest management: only actors within PLAYER_INTEREST_RANGE are sent.
   * This keeps frames small, and it also means a client that inspects its own
   * network traffic learns nothing about the far side of the map.
   */
  buildSnapshotFor(clientId: string): {
    actors: Actor[];
    self: PlayerActor | null;
    noises: NoiseEvent[];
    tracks: Track[];
  } {
    const self = this.getPlayer(clientId) ?? null;
    const origin = self ? self.pos : vec3();
    const actors: Actor[] = [];

    this.grid.forEachInRadius(origin.x, origin.z, PLAYER_INTEREST_RANGE, (actor) => {
      actors.push(actor);
    });

    // Always include the player themselves and any corpse actors nearby, which
    // the grid skips because they are dead.
    if (self && !actors.includes(self)) actors.push(self);
    for (const c of this.corpses) {
      const actor = this.actors.get(c.actorId);
      if (!actor) continue;
      if (dist2D(actor.pos, origin) <= PLAYER_INTEREST_RANGE) actors.push(actor);
    }

    // Noises are only revealed while the "listen" sense is active — otherwise
    // the client would receive positional audio data it has not earned.
    let noises: NoiseEvent[] = [];
    if (self && self.listenTimer > 0) {
      noises = this.noises.filter(
        (n) =>
          n.sourceId !== self.id &&
          Math.hypot(n.x - origin.x, n.z - origin.z) <= SENSE_LISTEN_RANGE &&
          n.volume > 8,
      );
    }

    // Footprints are visible to everyone, but only up close: you have to be
    // standing on the trail to read it.
    const tracks = self
      ? this.tracks.filter(
          (t) => Math.hypot(t.x - origin.x, t.z - origin.z) <= TRACK_VISIBLE_RANGE,
        )
      : [];

    return { actors, self, noises, tracks };
  }

  /** Total actor count, for the debug overlay. */
  get actorCount(): number {
    return this.actors.size;
  }

  /** Deterministic room code derived from the seed. */
  get roomCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let h = hashString(`room:${this.seed}`);
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += alphabet[h % alphabet.length];
      h = Math.floor(h / alphabet.length) + 7919;
    }
    return code;
  }
}
