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

/** Windup before the bite lands, giving prey a chance to react. */
export const HUNTER_ATTACK_WINDUP = 0.32;

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

/** Playable area is WORLD_SIZE x WORLD_SIZE metres, centred on the origin. */
export const WORLD_SIZE = 620;

/** Vertical scale of the terrain. */
export const TERRAIN_HEIGHT = 26;

/** Water plane height in world units. Terrain below this is river/lake. */
export const WATER_LEVEL = 2.2;

/** Depth below which water is "deep": swimming only, no walking. */
export const DEEP_WATER_DEPTH = 1.6;

/** Resolution of the collision/height lookup grid (cells per side). */
export const TERRAIN_GRID = 256;

/** Resolution of the visible terrain mesh per graphics preset. */
export const TERRAIN_MESH_SEGMENTS = { low: 96, medium: 160, high: 224 } as const;

/** Prop budget for the jungle. Scaled down on lower graphics presets. */
export const WORLD_PROPS = {
  trees: 1500,
  bushes: 2600,
  grassPatches: 9000,
  rocks: 420,
  logs: 260,
  ferns: 1800,
  vines: 520,
  huts: 7,
  bridges: 5,
  caves: 6,
  clearings: 9,
  fruitBushes: 190,
  fishingSpots: 90,
} as const;

// ---------------------------------------------------------------------------
// AI population
// ---------------------------------------------------------------------------

/** Total AI animals alive in the world at once. */
export const AI_POPULATION = 190;

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
