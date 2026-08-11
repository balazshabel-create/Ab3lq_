/**
 * Config.ts — every gameplay tunable lives here.
 *
 * Nothing in this file imports anything else, so it is safe to read from the
 * browser client, the Node authority server and the unit tests alike.
 * Designers should be able to rebalance the whole game from this one file.
 */

// ---------------------------------------------------------------------------
// Round / match flow
// ---------------------------------------------------------------------------

/** Length of one round, in seconds. 10 minutes by design. */
export const ROUND_DURATION = 600;

/** Countdown after all players are ready, before the round actually starts. */
export const ROUND_INTRO_DURATION = 8;

/** How long the "ROUND OVER" reveal screen stays up before returning to lobby. */
export const ROUND_OVER_DURATION = 22;

/** Player counts the lobby accepts. */
export const MIN_PLAYERS = 1; // 1 allows solo practice against AI
export const MAX_PLAYERS = 12;

/** Simulation tick rate of the authority (Hz). Rendering is decoupled. */
export const SIM_TICK_RATE = 20;
export const SIM_DT = 1 / SIM_TICK_RATE;

/** How often the authority pushes snapshots to each client (Hz). */
export const SNAPSHOT_RATE = 10;

// ---------------------------------------------------------------------------
// Hunger
// ---------------------------------------------------------------------------

/**
 * Base hunger drain in percent per second, before the species multiplier and
 * before any weakness modifier.
 *
 * Tuned so that hunger is a real clock inside a single ten minute round rather
 * than a decoration. At 0.24 %/s an average animal (multiplier 1.0) empties its
 * bar in about seven minutes, which lands the species spread where the design
 * wants it:
 *
 *   sloth    ×0.34 → ~20 min : never has to eat. That is the sloth's identity.
 *   capybara ×0.72 → ~9.7 min: survives on one careful meal.
 *   caiman   ×1.00 → ~7 min  : must feed once, in the water, in the open.
 *   monkey   ×1.35 → ~5 min  : constantly foraging.
 *   jaguar   ×1.50 → ~4.6 min: has to hunt twice, and hunting is loud.
 *
 * The predators being the hungriest is the point: it drags them out of cover,
 * including the hunter, who has to eat like everything else.
 */
export const HUNGER_DECAY_RATE = 0.24;

/** Hunger starts here (percent). */
export const HUNGER_START = 100;
export const HUNGER_MAX = 100;

/** Below this, the HUD starts warning the player. */
export const HUNGER_WARN_THRESHOLD = 25;

/** Damage per second taken while hunger sits at zero. */
export const STARVATION_DAMAGE_RATE = 4.5;

/** Seconds a normal animal needs to finish one meal. */
export const EAT_DURATION = 2.6;

/** Maximum distance at which a food source can be interacted with (metres). */
export const EAT_REACH = 2.4;

/** Hunger restored by one meal, per food tier. */
export const FOOD_NUTRITION = {
  plant: 18,
  fruit: 26,
  fish: 34,
  smallAnimal: 42,
  largeAnimal: 60,
  carrion: 30,
} as const;

export type FoodTier = keyof typeof FOOD_NUTRITION;

// ---------------------------------------------------------------------------
// Whistle & flies — the signature mechanic
// ---------------------------------------------------------------------------

/**
 * A survivor must whistle at least once every WHISTLE_INTERVAL seconds.
 * The exact moment is up to the player; only the gap between whistles matters.
 */
export const WHISTLE_INTERVAL = 60;

/** The HUD turns amber this many seconds before the deadline. */
export const WHISTLE_WARN_TIME = 12;

/** Cooldown so players cannot spam the whistle to farm safety. */
export const WHISTLE_COOLDOWN = 3.5;

/** How far a whistle can be heard (metres). Louder than footsteps on purpose. */
export const WHISTLE_HEAR_RANGE = 85;

/**
 * After the whistle deadline passes, flies build up over FLY_REVEAL_TIME
 * seconds from the first fly to a full, unmistakable swarm.
 */
export const FLY_REVEAL_TIME = 20;

/** Fly swarm size at full reveal. */
export const FLY_MAX_COUNT = 14;

/** Swarm intensity (0..1) at which the swarm is readable from a distance. */
export const FLY_OBVIOUS_THRESHOLD = 0.55;

/** How far a full fly swarm is visible to the hunter (metres). */
export const FLY_VISIBLE_RANGE = 70;

/** Whistling clears flies over this many seconds instead of instantly. */
export const FLY_DECAY_TIME = 6;

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

export const HEALTH_MAX = 100;

/** Damage a hunter's natural attack deals to a player animal. */
export const HUNTER_DAMAGE = 46;

/** Hunter attack cooldown (seconds) — deliberately slow, so misses hurt. */
export const HUNTER_ATTACK_COOLDOWN = 2.2;

/** Reach and arc of the hunter's bite/pounce. */
export const HUNTER_ATTACK_RANGE = 3.4;
export const HUNTER_ATTACK_ARC = Math.PI * 0.55;

/**
 * How long a strike is visibly in progress, in seconds.
 *
 * This is the duration the Attacking flag is held for, which is what the renderer
 * uses to trigger the bite animation. Comfortably longer than the gap between
 * snapshots (100 ms), so a strike can never fall between two of them and go
 * undrawn.
 *
 * Named for what it does. It used to be called a "windup" and described as giving
 * prey a chance to react, which it never did — the damage is applied in the same
 * tick the attack is requested, so there is no delay to react inside. Making the
 * bite land late would be a real design change; this constant only governs how
 * long the animal is shown lunging.
 */
export const ATTACK_STRIKE_TIME = 0.34;

/** Damage an AI apex predator deals to a player (less than a real hunter). */
export const AI_PREDATOR_DAMAGE = 16;
export const AI_PREDATOR_ATTACK_COOLDOWN = 3.0;

/** Health regeneration per second while not starving and not recently hit. */
export const HEALTH_REGEN_RATE = 1.4;
export const HEALTH_REGEN_DELAY = 9;

// ---------------------------------------------------------------------------
// Movement & stamina
// ---------------------------------------------------------------------------

/** Baseline walk speed (m/s). Species multiply this. */
export const ANIMAL_SPEED = 4.2;

/** Sprint multiplier applied on top of the species walk speed. */
export const SPRINT_MULTIPLIER = 1.85;

export const STAMINA_MAX = 100;
export const STAMINA_DRAIN_RATE = 17;
export const STAMINA_REGEN_RATE = 11;
export const STAMINA_REGEN_DELAY = 1.4;

/** Below this stamina, sprinting is unavailable until it recovers a little. */
export const STAMINA_EXHAUSTED_THRESHOLD = 8;
export const STAMINA_RECOVERY_THRESHOLD = 22;

/** Gravity, jump impulse, and how fast animals turn (radians/s). */
export const GRAVITY = 22;
export const JUMP_SPEED = 7.4;
export const TURN_RATE = 5.2;

/** Vertical climb speed on tree trunks, for climbers (m/s). */
export const CLIMB_SPEED = 2.6;

/**
 * How fast the player's *steering* heading can swing, in radians per second.
 *
 * Movement is body-relative: W drives along the animal's own facing and A/D steer
 * it, so the camera can look anywhere — including straight backwards — without
 * changing where the animal goes. The client integrates a steering heading from
 * A/D and sends that as the wish direction.
 *
 * Deliberately far above any species' turn rate. The real limit on turning is
 * meant to be the animal's own agility (and the Stiff Joints weakness), enforced
 * by the movement solver; if this were the tighter of the two it would flatten
 * every species to the same handling.
 */
export const STEER_RATE = 9;

/**
 * How far ahead of the body the steering heading may get, in radians.
 *
 * A tether, and it is doing real work. Without it, holding A against a body that
 * cannot turn that fast — a tapir, or anything with Stiff Joints — winds the
 * steering heading round and round while the animal lumbers after it, and letting
 * go leaves the two pointing in unrelated directions. Clamping the lead means the
 * heading always stays just ahead of the nose, so steering stops the instant you
 * release the key.
 */
export const STEER_MAX_LEAD = 0.9;

// ---------------------------------------------------------------------------
// Perception — how easily animals and hunters notice each other
// ---------------------------------------------------------------------------

/** Base sight range for AI animals (metres) before species modifiers. */
export const AI_SIGHT_RANGE = 34;
export const AI_SIGHT_ARC = Math.PI * 1.1;

/** Base hearing range for AI animals. */
export const AI_HEAR_RANGE = 26;

/** How long an AI animal keeps fleeing after losing sight of a threat. */
export const AI_FLEE_MEMORY = 5.5;

/** Sight range of the player, used for interest management / culling. */
export const PLAYER_INTEREST_RANGE = 190;

// ---------------------------------------------------------------------------
// Hunter senses (the tools that keep the hunter from being helpless)
// ---------------------------------------------------------------------------

/** "Listen" — briefly shows the direction of recent noises. */
export const SENSE_LISTEN_DURATION = 4.0;
export const SENSE_LISTEN_COOLDOWN = 18;
export const SENSE_LISTEN_RANGE = 110;

/** Footprint trails left by players and animals. */
export const TRACK_LIFETIME = 34;
export const TRACK_SPAWN_INTERVAL = 0.55;
export const TRACK_VISIBLE_RANGE = 26;

/** "Focus" — the predator's telescopic stare. */
export const SENSE_FOCUS_FOV = 22;
export const SENSE_FOCUS_COOLDOWN = 6;

/** Hunter sprint bonus over an equivalent survivor of the same species. */
export const HUNTER_SPEED_BONUS = 1.08;

// ---------------------------------------------------------------------------
// Noise emitted by actions (arbitrary units; compared against hear ranges)
// ---------------------------------------------------------------------------

export const NOISE_WALK = 6;
export const NOISE_RUN = 17;
export const NOISE_SWIM = 9;
export const NOISE_SPLASH = 14;
/** An animal call: howler monkeys and macaws are audible a long way off. */
export const NOISE_CALL = 30;
export const NOISE_JUMP = 12;
export const NOISE_EAT = 7;
export const NOISE_WHISTLE = 40;
export const NOISE_ATTACK = 34;
export const NOISE_DEATH = 45;

/** Multiplier applied to noise while it rains (rain masks sound). */
export const RAIN_NOISE_DAMPING = 0.62;

// ---------------------------------------------------------------------------
// World generation
// ---------------------------------------------------------------------------

/**
 * Simulated area is WORLD_SIZE x WORLD_SIZE metres, centred on the origin.
 *
 * Considerably larger than the circle anyone actually plays in, which is the
 * point: the storm zone is drawn at a random spot inside this, so no two rounds
 * take place on the same ground. Beyond WORLD_SIZE the renderer continues the
 * jungle out to the horizon as non-interactive scenery, so the world never
 * visibly ends.
 *
 * The snapshot packs positions as int16 at 1/8 m, giving a ±4096 m budget — this
 * is nowhere near it, so the world can grow further without a protocol change.
 */
export const WORLD_SIZE = 1000;

/** Vertical scale of the terrain. */
export const TERRAIN_HEIGHT = 26;

/** Water plane height in world units. Terrain below this is river/lake. */
export const WATER_LEVEL = 2.2;

/** Depth below which water is "deep": swimming only, no walking. */
export const DEEP_WATER_DEPTH = 1.6;

/** Resolution of the collision/height lookup grid (cells per side). */
export const TERRAIN_GRID = 320;

/** Resolution of the visible terrain mesh per graphics preset. */
export const TERRAIN_MESH_SEGMENTS = { low: 112, medium: 192, high: 272 } as const;

/**
 * How far past the world edge the cosmetic backdrop reaches, and how high the
 * ring of mountains that closes off the basin stands.
 *
 * None of this is simulated — there is no collision, no props with logic, no AI
 * out here. It exists so that looking outward reads as "the rainforest goes on
 * for a hundred kilometres", which is what an Amazon basin actually looks like,
 * instead of "the level ends in fog".
 */
export const BACKDROP_RADIUS = 4200;
export const BACKDROP_MOUNTAIN_HEIGHT = 620;
/** Cosmetic canopy trees scattered between the world edge and the mountains. */
export const BACKDROP_TREES = { low: 1400, medium: 3200, high: 6000 } as const;

/**
 * Prop budget for the jungle. Scaled down on lower graphics presets.
 *
 * Scaled up with the world so density holds, and then pushed well past that for
 * ground cover: grass, flowers and ferns are what make a rainforest floor read
 * as a rainforest floor rather than a green heightfield, and they are the
 * cheapest props we have — one instanced draw per chunk, no collision, no AI.
 */
export const WORLD_PROPS = {
  trees: 4200,
  bushes: 7600,
  /*
   * No grass budget: grass is streamed around the camera rather than scattered
   * over the map, because scattering cannot reach a believable density at this
   * world size. See GrassField.ts.
   */
  flowers: 24000,
  /** Tall flowering spikes, placed in drifts rather than scattered. */
  flowerSpikes: 14000,
  rocks: 900,
  logs: 620,
  ferns: 6400,
  vines: 1300,
  /** Reeds and lilies at the waterline, and weed on the river bed. */
  reeds: 5200,
  underwaterPlants: 4200,
  huts: 11,
  bridges: 8,
  caves: 10,
  clearings: 14,
  fruitBushes: 420,
  fishingSpots: 190,
} as const;

// ---------------------------------------------------------------------------
// The storm zone — the shrinking circle the round is played inside
// ---------------------------------------------------------------------------

/**
 * A circle is drawn at a random spot in the jungle at the start of each round,
 * and it closes in every couple of minutes. Outside it the weather is not
 * weather any more: a standing wall of storm, tornadoes and continuous
 * lightning. Staying out there kills you.
 *
 * Why a game about hiding wants this: hiding has a failure mode where the
 * correct play is to walk to a far corner, stand in a bush and wait out ten
 * minutes. That is unbeatable and extremely boring, for the hider as much as
 * for the hunter. A shrinking circle removes the corner. By the last stage
 * everyone left is inside a clearing-sized space, still pretending to be an
 * animal, and the hunter knows they are all in there somewhere.
 */
export const ZONE_ENABLED = true;

/** Radius of the first circle, and of the last one. */
export const ZONE_INITIAL_RADIUS = 300;
export const ZONE_FINAL_RADIUS = 36;

/** When the first shrink starts, and the gap between shrinks (seconds). */
export const ZONE_FIRST_SHRINK_AT = 120;
export const ZONE_SHRINK_INTERVAL = 120;

/** How long the wall takes to travel to its new position. */
export const ZONE_SHRINK_DURATION = 42;

/** The HUD starts warning this long before a shrink begins. */
export const ZONE_WARNING_TIME = 20;

/**
 * Damage per second in the storm, indexed by how many shrinks have happened.
 *
 * The first ring is survivable — you can cut a corner through the storm to get
 * back, and that is a real, useful, frightening option. By the last one it is
 * simply fatal, because at that point being outside means refusing to play.
 */
export const ZONE_DAMAGE_RATE = [2.4, 4.5, 7.5, 12, 20] as const;

/** AI animals take a fraction of that — they flee inward instead of dying. */
export const ZONE_AI_DAMAGE_SCALE = 0.35;

/** How urgently AI animals outside the circle run for the middle. */
export const ZONE_AI_FLEE_MARGIN = 18;

/**
 * The circle is re-drawn until it contains this much water, so a crocodile is
 * never handed a round with nowhere to swim. The river is the aquatic species'
 * entire habitat and half the map's cover.
 */
export const ZONE_MIN_WATER_FRACTION = 0.045;

// ---------------------------------------------------------------------------
// AI population
// ---------------------------------------------------------------------------

/**
 * Total AI animals alive in the world at once.
 *
 * They are spawned inside the opening circle rather than across the whole
 * world, which is both cheaper and better: the crowd is where the players are,
 * and as the circle closes the density climbs on its own, exactly like real
 * animals crowding away from a storm front.
 */
export const AI_POPULATION = 220;

/**
 * Guaranteed minimum number of AI animals of the same species as each player.
 * This is what makes hiding in the crowd possible — a player capybara is
 * useless as a disguise if there are no AI capybaras around.
 */
export const AI_SPECIES_COVER_MIN = 14;

/** Herd sizes for social species. */
export const HERD_SIZE_MIN = 3;
export const HERD_SIZE_MAX = 9;

/** AI animals farther than this from every player are simulated coarsely. */
export const AI_LOD_DISTANCE = 120;

/** Coarse AI updates run at this fraction of the full tick rate. */
export const AI_LOD_TICK_DIVISOR = 6;

// ---------------------------------------------------------------------------
// Time of day & weather
// ---------------------------------------------------------------------------

/** Round starts mid-afternoon and ends deep in the night. */
export const TIME_OF_DAY_START = 15.2; // hours, 24h clock
export const TIME_OF_DAY_END = 22.4;

/** Weather state minimum/maximum duration in seconds. */
export const WEATHER_MIN_DURATION = 70;
export const WEATHER_MAX_DURATION = 165;

/** Relative likelihood of each weather state being picked next. */
export const WEATHER_WEIGHTS = {
  clear: 26,
  cloudy: 20,
  rain: 22,
  storm: 12,
  fog: 14,
} as const;

// ---------------------------------------------------------------------------
// Random events
// ---------------------------------------------------------------------------

/** Seconds between random-event rolls. */
export const EVENT_INTERVAL_MIN = 55;
export const EVENT_INTERVAL_MAX = 110;

/** Chance a roll actually fires an event. */
export const EVENT_CHANCE = 0.72;

/** No events in the first or last few seconds of a round. */
export const EVENT_LOCKOUT_START = 35;
export const EVENT_LOCKOUT_END = 25;

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------

export const DEFAULT_SERVER_PORT = 8787;

/** Client sends its input/state this often (Hz). */
export const CLIENT_INPUT_RATE = 20;

/** Drop a client that has not sent anything for this long (seconds). */
export const CLIENT_TIMEOUT = 25;

/** Interpolation buffer for remote entities (seconds). */
export const INTERP_DELAY = 0.12;

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Distance from a spawn point to the nearest other spawn point. */
export const SPAWN_MIN_SEPARATION = 55;

/** Corpses linger this long as carrion before disappearing. */
export const CORPSE_LIFETIME = 45;
