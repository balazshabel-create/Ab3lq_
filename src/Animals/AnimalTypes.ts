/**
 * AnimalTypes.ts — the species table.
 *
 * Everything that distinguishes one animal from another is data in this file:
 * speed, diet, hunger rate, locomotion abilities, silhouette proportions, the
 * colours the procedural model builder uses, and which weaknesses make
 * anatomical sense for it.
 *
 * Adding a species means adding one entry here. The AI, the renderer, the
 * player controller and the role assignment all read from this table, so a new
 * animal is playable and AI-driven without touching any other system.
 */

import type { FoodTier } from '../Systems/Config';

export enum Species {
  Capybara = 'capybara',
  Crocodile = 'crocodile',
  Monkey = 'monkey',
  Sloth = 'sloth',
  Jaguar = 'jaguar',
  Anaconda = 'anaconda',
  Parrot = 'parrot',
  Iguana = 'iguana',
  Peccary = 'peccary',
  Turtle = 'turtle',
  Frog = 'frog',
  Heron = 'heron',
  Ocelot = 'ocelot',
  Armadillo = 'armadillo',
  Anteater = 'anteater',
  Tapir = 'tapir',
  HowlerMonkey = 'howler_monkey',
  Piranha = 'piranha',
  Eagle = 'eagle',
  Bat = 'bat',
  Butterfly = 'butterfly',
  Chameleon = 'chameleon',
  Caiman = 'caiman',
  /*
   * The playable roster, added last on purpose.
   *
   * The snapshot format encodes a species as its index in ALL_SPECIES, so new
   * entries have to go on the end — inserting one anywhere else would silently
   * renumber every species after it and make old clients draw the wrong animal.
   */
  Tiger = 'tiger',
  Leopard = 'leopard',
  Gorilla = 'gorilla',
  /** Ambient only: a column of ants crossing the forest floor. */
  Ant = 'ant',
  /**
   * The hunter. A person, not an animal.
   *
   * Lives in this enum because every actor in the world is addressed through it —
   * the snapshot format, the model builder, the AI's threat checks — and giving
   * the hunter a parallel type would mean a second code path through all of them.
   * It is never playable as a survivor and never spawns as AI; `assignRoles`
   * hands it to exactly one player per round.
   */
  Hunter = 'hunter',
}

/** What an animal eats. Drives the food chain and what it can hunt. */
export enum Diet {
  Herbivore = 'herbivore',
  Carnivore = 'carnivore',
  Omnivore = 'omnivore',
  Insectivore = 'insectivore',
  Piscivore = 'piscivore',
}

/** Broad size class: who can eat whom, and how easy you are to spot. */
export enum SizeClass {
  Tiny = 0, // butterflies, frogs
  Small = 1, // parrot, armadillo, iguana
  Medium = 2, // capybara, monkey, peccary
  Large = 3, // jaguar, crocodile, tapir
  Huge = 4, // full-grown anaconda
}

/** Movement capabilities. Composition rather than an inheritance hierarchy. */
export interface Locomotion {
  /** Ground movement multiplier applied to ANIMAL_SPEED. */
  landSpeed: number;
  /** Swim speed multiplier. 0 means it cannot enter deep water. */
  swimSpeed: number;
  /**
   * Can it climb tree trunks?
   *
   * Always false. Climbing was removed — trees are scenery and cover, not
   * terrain — and the field is kept only so the shape of the table stays stable
   * for anything that reads it. Setting it true will not make an animal climb;
   * the movement solver has no climbing code left.
   */
  canClimb: boolean;
  /** Climb speed multiplier. */
  climbSpeed: number;
  /** Can it jump? */
  canJump: boolean;
  /** Jump impulse multiplier. */
  jumpPower: number;
  /** Can it fly? Flyers ignore ground collision while airborne. */
  canFly: boolean;
  /**
   * Can it dive fully under the water and stay there?
   *
   * Deliberately *not* the same thing as being a good swimmer. A capybara swims
   * better than a caiman and still cannot lie on the river bed waiting; only the
   * ambush reptiles get that, and it is the strongest concealment in the game —
   * a submerged animal is nearly impossible to spot from the bank. Handing it to
   * every strong swimmer would make the river a free hiding place for half the
   * roster and leave the crocodilians with no signature move.
   */
  canSubmerge: boolean;
  /** Cruise altitude above ground while flying. */
  flyHeight: number;
  /** Sprint multiplier override; 1 means "no sprint". */
  sprintMultiplier: number;
  /** Turn rate multiplier — big animals are unwieldy. */
  agility: number;
}

/** Numbers the procedural model builder needs to draw the animal. */
export interface Silhouette {
  /** Overall model scale in metres (body length, roughly). */
  length: number;
  /** Shoulder height in metres. */
  height: number;
  /** Body width in metres — matters for collision and visibility. */
  width: number;
  /** Body colour palette, as hex ints. */
  colors: {
    body: number;
    belly: number;
    accent: number;
    eye: number;
  };
  /** Which of the model builder's body plans to use. */
  bodyPlan: BodyPlan;
  /** Legs per side used by the gait animation. 0 for legless/flyers. */
  legPairs: number;
  /** Tail length as a fraction of body length. 0 = no tail. */
  tail: number;
}

/** The procedural mesh archetypes. */
export enum BodyPlan {
  /** Two legs, two arms, a rifle. Only the hunter uses it. */
  Human = 'human',
  Quadruped = 'quadruped',
  Feline = 'feline',
  Reptile = 'reptile',
  Serpent = 'serpent',
  Primate = 'primate',
  Bird = 'bird',
  Amphibian = 'amphibian',
  Shelled = 'shelled',
  Fish = 'fish',
  Insect = 'insect',
}

/** AI temperament: how an animal reacts to the world. */
export interface Temperament {
  /** How readily it flees (0 = fearless, 1 = bolts at anything). */
  skittishness: number;
  /** How likely it is to attack smaller animals (0..1). */
  aggression: number;
  /** Prefers to be in a herd/flock. */
  social: boolean;
  /** Active at night rather than during the day. */
  nocturnal: boolean;
  /** Fraction of its time spent completely still (ambush predators, sloths). */
  stillness: number;
  /** Water preference: 0 avoids water, 1 lives in it. */
  aquatic: number;
  /** Tree preference: 0 stays on the ground, 1 lives in the canopy. */
  arboreal: number;
  /** Sight range multiplier. */
  sight: number;
  /** Hearing range multiplier. */
  hearing: number;
}

export interface AnimalDef {
  species: Species;
  /** Display name shown in menus and the round summary. */
  name: string;
  /** Emoji used throughout the UI. */
  emoji: string;
  /** One-line flavour text for the animal-select screen. */
  tagline: string;
  diet: Diet;
  size: SizeClass;
  locomotion: Locomotion;
  silhouette: Silhouette;
  temperament: Temperament;
  /** Hunger decay multiplier applied to HUNGER_DECAY_RATE. */
  hungerRate: number;
  /** Max health multiplier. */
  healthMultiplier: number;
  /** Footstep/movement noise multiplier — big feet are loud. */
  noiseMultiplier: number;
  /**
   * How hard this species hits, as a multiplier on HUNTER_DAMAGE.
   *
   * Explicit data rather than something derived from diet and size class, which
   * is what it used to be. The derivation could not express the roster: a leopard
   * is a large carnivore that is *supposed* to hit softly, and a gorilla is an
   * omnivore that is supposed to hit hardest of all. Guessing from the food chain
   * produced the opposite of both.
   *
   * Defaults to 0.5 when omitted, which is where the incidental species sit.
   */
  attackPower?: number;
  /** What food tiers it can consume. */
  eats: FoodTier[];
  /** Species it will hunt as an AI, and can eat as a player. */
  preys: Species[];
  /** Selectable by survivors in the animal-select screen. */
  playable: boolean;
  /** Eligible to be assigned the hunter role. */
  canBeHunter: boolean;
  /**
   * Set to false to withdraw a species from the game without deleting it.
   *
   * Disabled species are never spawned, never dealt to a player and never
   * offered in the lobby, but their definition stays in the table so that the
   * snapshot format's species indices — and any prey lists that mention them —
   * remain valid. Defaults to enabled when omitted.
   */
  enabled?: boolean;
  /** Ability descriptions shown on the select screen. */
  pros: string[];
  cons: string[];
  /** Signature ability id, handled by AbilitySystem. */
  ability?: AbilityId;
}

/** Signature abilities, one per playable archetype. */
export enum AbilityId {
  /** Crocodile: submerge with only the eyes above the surface. */
  Submerge = 'submerge',
  /** Capybara: freeze and blend with a nearby AI herd. */
  HerdBlend = 'herd_blend',
  /** Monkey: leap between branches. */
  BranchLeap = 'branch_leap',
  /** Sloth: hang motionless and become almost undetectable. */
  DeadHang = 'dead_hang',
  /** Jaguar: a short explosive pounce. */
  Pounce = 'pounce',
  /** Anaconda: total silence while slithering through undergrowth. */
  SilentSlither = 'silent_slither',
  /** Parrot/Eagle: short glide. */
  Glide = 'glide',
  /** Iguana/Chameleon: colour-shift while motionless. */
  ColorShift = 'color_shift',
  /** Armadillo: curl into an armoured ball. */
  CurlUp = 'curl_up',
}

// ---------------------------------------------------------------------------
// Helpers to keep the table below readable
// ---------------------------------------------------------------------------

function loco(partial: Partial<Locomotion>): Locomotion {
  return {
    landSpeed: 1,
    swimSpeed: 0.5,
    canClimb: false,
      climbSpeed: 0,
    canJump: true,
    jumpPower: 1,
    canFly: false,
    canSubmerge: false,
    flyHeight: 0,
    sprintMultiplier: 1,
    agility: 1,
    ...partial,
  };
}

function temper(partial: Partial<Temperament>): Temperament {
  return {
    skittishness: 0.5,
    aggression: 0.1,
    social: false,
    nocturnal: false,
    stillness: 0.15,
    aquatic: 0.1,
    arboreal: 0,
    sight: 1,
    hearing: 1,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// The species table
// ---------------------------------------------------------------------------

export const ANIMALS: Record<Species, AnimalDef> = {
  // === Playable core three (the vertical slice) ============================

  [Species.Capybara]: {
    species: Species.Capybara,
    name: 'Capybara',
    emoji: '🦫',
    tagline: 'Unbothered. Moisturised. In a herd. Thriving.',
    diet: Diet.Herbivore,
    size: SizeClass.Medium,
    hungerRate: 0.72,
    healthMultiplier: 1,
    noiseMultiplier: 0.9,
    // It can bite. That is about all that can be said for it.
    attackPower: 0.12,
    eats: ['plant', 'fruit'],
    preys: [],
    playable: true,
    canBeHunter: false,
    ability: AbilityId.HerdBlend,
    pros: ['Slow hunger drain', 'Excellent swimmer', 'Hides well in bushes', 'Big AI herds to blend into'],
    cons: ['Cannot fight back', 'Prey for everything with teeth'],
    locomotion: loco({ /*
       * Fast enough to outrun a tiger, not a leopard.
       *
       * That gap is the capybara's entire defence: it cannot fight (attackPower
       * 0.12) and it cannot hide especially well, so escape has to be real against
       * most of the roster and hopeless against the one animal built for chasing.
       */
      landSpeed: 1.32, swimSpeed: 1.15, sprintMultiplier: 2.1, agility: 1.1 }),
    silhouette: {
      length: 1.15,
      height: 0.6,
      width: 0.48,
      colors: { body: 0x8a6642, belly: 0x6b4f33, accent: 0x5a4029, eye: 0x120c08 },
      bodyPlan: BodyPlan.Quadruped,
      legPairs: 2,
      tail: 0.04,
    },
    temperament: temper({ skittishness: 0.62, social: true, aquatic: 0.65, hearing: 1.15 }),
  },

  [Species.Crocodile]: {
    species: Species.Crocodile,
    name: 'Black Caiman',
    emoji: '🐊',
    tagline: 'A log with opinions.',
    diet: Diet.Carnivore,
    size: SizeClass.Large,
    hungerRate: 1.0,
    healthMultiplier: 1.35,
    noiseMultiplier: 0.7,
    // A death roll on anything it gets hold of — in the water.
    attackPower: 1.7,
    eats: ['fish', 'smallAnimal', 'largeAnimal', 'carrion'],
    preys: [Species.Capybara, Species.Piranha, Species.Turtle, Species.Frog, Species.Heron, Species.Peccary],
    playable: true,
    canBeHunter: true,
    ability: AbilityId.Submerge,
    pros: ['Devastating in water', 'Can hold perfectly still', 'Tough hide', 'Reads as scenery when submerged'],
    cons: ['Sluggish on land', 'Large silhouette', 'Too big for most bushes'],
    locomotion: loco({
      landSpeed: 0.62,
      swimSpeed: 1.45,
      sprintMultiplier: 1.9,
      agility: 0.62,
      canJump: false,
      canSubmerge: true,
    }),
    silhouette: {
      length: 3.4,
      height: 0.5,
      width: 0.78,
      colors: { body: 0x2f3a2a, belly: 0x6a6f52, accent: 0x1d2419, eye: 0xc9a227 },
      bodyPlan: BodyPlan.Reptile,
      legPairs: 2,
      tail: 0.85,
    },
    temperament: temper({
      skittishness: 0.12,
      aggression: 0.75,
      aquatic: 0.92,
      stillness: 0.55,
      sight: 0.9,
    }),
  },

  [Species.Monkey]: {
    species: Species.Monkey,
    name: 'Spider Monkey',
    // Withdrawn at the designer's request. The table entry stays because the
    // snapshot format encodes a species as its index in ALL_SPECIES.
    enabled: false,
    emoji: '🐒',
    tagline: 'Chaos with opposable thumbs.',
    diet: Diet.Omnivore,
    size: SizeClass.Medium,
    hungerRate: 1.35,
    healthMultiplier: 0.85,
    noiseMultiplier: 1.15,
    eats: ['fruit', 'plant', 'smallAnimal'],
    preys: [Species.Butterfly, Species.Frog],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.BranchLeap,
    pros: ['Very agile', 'Hard to corner'],
    cons: ['Hungry constantly', 'Fragile', 'Noisy in the branches'],
    locomotion: loco({
      landSpeed: 1.12,
      swimSpeed: 0.35,
      canClimb: false,
      climbSpeed: 0,
      jumpPower: 1.45,
      sprintMultiplier: 1.7,
      agility: 1.4,
    }),
    silhouette: {
      length: 0.78,
      height: 0.55,
      width: 0.3,
      colors: { body: 0x3a2c20, belly: 0x715638, accent: 0x24190f, eye: 0x0a0705 },
      bodyPlan: BodyPlan.Primate,
      legPairs: 2,
      tail: 1.25,
    },
    temperament: temper({
      skittishness: 0.72,
      social: true,
      arboreal: 0.85,
      sight: 1.2,
      hearing: 1.1,
    }),
  },

  // === Additional playable animals ========================================

  [Species.Sloth]: {
    species: Species.Sloth,
    name: 'Three-toed Sloth',
    enabled: false,
    emoji: '🦥',
    tagline: 'Speedrunning nothing.',
    diet: Diet.Herbivore,
    size: SizeClass.Small,
    hungerRate: 0.34,
    healthMultiplier: 0.9,
    noiseMultiplier: 0.35,
    eats: ['plant', 'fruit'],
    preys: [],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.DeadHang,
    pros: ['Barely ever hungry', 'Almost silent', 'Lives in the canopy', 'Indistinguishable when still'],
    cons: ['Painfully slow', 'No escape once spotted'],
    locomotion: loco({
      landSpeed: 0.26,
      swimSpeed: 0.55,
      canClimb: false,
      climbSpeed: 0,
      canJump: false,
      sprintMultiplier: 1.2,
      agility: 0.4,
    }),
    silhouette: {
      length: 0.62,
      height: 0.4,
      width: 0.32,
      colors: { body: 0x8c8168, belly: 0xa89b7c, accent: 0x5d5443, eye: 0x1a1410 },
      bodyPlan: BodyPlan.Primate,
      legPairs: 2,
      tail: 0.1,
    },
    temperament: temper({
      skittishness: 0.2,
      arboreal: 0.95,
      stillness: 0.8,
      sight: 0.7,
      hearing: 0.8,
    }),
  },

  [Species.Jaguar]: {
    species: Species.Jaguar,
    name: 'Jaguar',
    enabled: false,
    emoji: '🐆',
    tagline: 'The reason everything else is nervous.',
    diet: Diet.Carnivore,
    size: SizeClass.Large,
    hungerRate: 1.5,
    healthMultiplier: 1.2,
    noiseMultiplier: 0.6,
    eats: ['smallAnimal', 'largeAnimal', 'carrion', 'fish'],
    preys: [
      Species.Capybara,
      Species.Peccary,
      Species.Monkey,
      Species.Sloth,
      Species.Armadillo,
      Species.Iguana,
      Species.Tapir,
    ],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.Pounce,
    pros: ['Explosive sprint', 'Pounces from cover', 'Swims well for a cat'],
    cons: ['Starves fast', 'Every animal flees on sight', 'Few AI jaguars to hide among'],
    locomotion: loco({
      landSpeed: 1.32,
      swimSpeed: 0.85,
      canClimb: false,
      climbSpeed: 0,
      jumpPower: 1.3,
      sprintMultiplier: 2.05,
      agility: 1.25,
    }),
    silhouette: {
      length: 1.7,
      height: 0.78,
      width: 0.5,
      colors: { body: 0xc99a4a, belly: 0xe4d3ac, accent: 0x2b2117, eye: 0xd9c25a },
      bodyPlan: BodyPlan.Feline,
      legPairs: 2,
      tail: 0.65,
    },
    temperament: temper({
      skittishness: 0.08,
      aggression: 0.9,
      aquatic: 0.35,
      arboreal: 0.3,
      stillness: 0.3,
      sight: 1.3,
      hearing: 1.25,
    }),
  },

  [Species.Anaconda]: {
    species: Species.Anaconda,
    name: 'Green Anaconda',
    enabled: false,
    emoji: '🐍',
    tagline: 'You will not hear it coming.',
    diet: Diet.Carnivore,
    size: SizeClass.Huge,
    hungerRate: 0.6,
    healthMultiplier: 1.25,
    noiseMultiplier: 0.15,
    eats: ['smallAnimal', 'largeAnimal', 'fish', 'carrion'],
    preys: [Species.Capybara, Species.Peccary, Species.Turtle, Species.Heron, Species.Frog],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.SilentSlither,
    pros: ['Effectively silent', 'Vanishes in undergrowth', 'Ambush attacks', 'Strong swimmer'],
    cons: ['Slow in the open', 'Long body is hard to hide in short grass'],
    locomotion: loco({
      landSpeed: 0.72,
      swimSpeed: 1.25,
      canJump: false,
      sprintMultiplier: 1.6,
      agility: 0.85,
      canSubmerge: true,
    }),
    silhouette: {
      length: 4.6,
      height: 0.26,
      width: 0.34,
      colors: { body: 0x4b5a2c, belly: 0x8f9a5e, accent: 0x28301a, eye: 0xb9a13c },
      bodyPlan: BodyPlan.Serpent,
      legPairs: 0,
      tail: 0,
    },
    temperament: temper({
      skittishness: 0.18,
      aggression: 0.72,
      aquatic: 0.7,
      stillness: 0.62,
      sight: 0.75,
      hearing: 1.3,
    }),
  },

  [Species.Caiman]: {
    species: Species.Caiman,
    name: 'Spectacled Caiman',
    enabled: false,
    emoji: '🐊',
    tagline: 'Smaller cousin, same bad intentions.',
    diet: Diet.Piscivore,
    size: SizeClass.Medium,
    hungerRate: 0.95,
    healthMultiplier: 1.1,
    noiseMultiplier: 0.7,
    eats: ['fish', 'smallAnimal', 'carrion'],
    preys: [Species.Piranha, Species.Frog, Species.Turtle],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.Submerge,
    pros: ['Fast in water', 'Small enough to hide', 'Many AI caimans about'],
    cons: ['Weaker bite than a black caiman', 'Clumsy on land'],
    locomotion: loco({
      landSpeed: 0.7,
      swimSpeed: 1.35,
      canJump: false,
      sprintMultiplier: 1.8,
      agility: 0.72,
      canSubmerge: true,
    }),
    silhouette: {
      length: 2.1,
      height: 0.38,
      width: 0.55,
      colors: { body: 0x4a5334, belly: 0x8b8e63, accent: 0x2c3120, eye: 0xb08d2a },
      bodyPlan: BodyPlan.Reptile,
      legPairs: 2,
      tail: 0.8,
    },
    temperament: temper({ skittishness: 0.25, aggression: 0.6, aquatic: 0.88, stillness: 0.5 }),
  },

  [Species.Ocelot]: {
    species: Species.Ocelot,
    name: 'Ocelot',
    enabled: false,
    emoji: '🐈',
    tagline: 'Pocket-sized apex predator.',
    diet: Diet.Carnivore,
    size: SizeClass.Small,
    hungerRate: 1.25,
    healthMultiplier: 0.8,
    noiseMultiplier: 0.45,
    eats: ['smallAnimal', 'carrion'],
    preys: [Species.Iguana, Species.Frog, Species.Armadillo, Species.Parrot],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.Pounce,
    pros: ['Quiet and quick', 'Small target', 'Easy to mistake for scenery at dusk'],
    cons: ['Fragile', 'Cannot take down large prey', 'Hungry'],
    locomotion: loco({
      landSpeed: 1.2,
      swimSpeed: 0.6,
      canClimb: false,
      climbSpeed: 0,
      jumpPower: 1.25,
      sprintMultiplier: 1.95,
      agility: 1.45,
    }),
    silhouette: {
      length: 0.9,
      height: 0.45,
      width: 0.28,
      colors: { body: 0xd0a45e, belly: 0xf0e2c0, accent: 0x3a2a1a, eye: 0x9ec46a },
      bodyPlan: BodyPlan.Feline,
      legPairs: 2,
      tail: 0.55,
    },
    temperament: temper({
      skittishness: 0.35,
      aggression: 0.7,
      arboreal: 0.35,
      nocturnal: true,
      sight: 1.25,
      hearing: 1.3,
    }),
  },

  [Species.Eagle]: {
    species: Species.Eagle,
    name: 'Harpy Eagle',
    // Withdrawn: the flying body plan reads poorly in play.
    enabled: false,
    emoji: '🦅',
    tagline: 'Death from directly above.',
    diet: Diet.Carnivore,
    size: SizeClass.Medium,
    hungerRate: 1.3,
    healthMultiplier: 0.75,
    noiseMultiplier: 0.3,
    eats: ['smallAnimal', 'carrion'],
    preys: [Species.Monkey, Species.Sloth, Species.Parrot, Species.Iguana],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.Glide,
    pros: ['Flies', 'Sees the whole clearing', 'Diving attack', 'Untouchable in the air'],
    cons: ['Very fragile', 'Obvious in an empty sky', 'Must land to eat'],
    locomotion: loco({
      landSpeed: 0.5,
      swimSpeed: 0,
      canFly: true,
      flyHeight: 22,
      jumpPower: 1.2,
      sprintMultiplier: 1.75,
      agility: 1.5,
    }),
    silhouette: {
      length: 1.0,
      height: 0.5,
      width: 0.4,
      colors: { body: 0x4a4a52, belly: 0xdcdcd4, accent: 0x23232a, eye: 0xe0b53c },
      bodyPlan: BodyPlan.Bird,
      legPairs: 1,
      tail: 0.5,
    },
    temperament: temper({ skittishness: 0.3, aggression: 0.8, sight: 1.7, arboreal: 0.7 }),
  },

  [Species.Parrot]: {
    species: Species.Parrot,
    name: 'Scarlet Macaw',
    // Withdrawn: the flying body plan reads poorly in play.
    emoji: '🦜',
    tagline: 'Loud, gorgeous, terrible at hiding.',
    diet: Diet.Herbivore,
    size: SizeClass.Small,
    hungerRate: 1.05,
    healthMultiplier: 0.65,
    noiseMultiplier: 1.3,
    eats: ['fruit', 'plant'],
    preys: [],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.Glide,
    pros: ['Can fly short distances', 'Escapes ground predators', 'Flocks are everywhere'],
    cons: ['Extremely fragile', 'Bright red', 'Naturally noisy'],
    locomotion: loco({
      landSpeed: 0.55,
      swimSpeed: 0,
      canFly: true,
      flyHeight: 14,
      jumpPower: 1.1,
      sprintMultiplier: 1.6,
      agility: 1.6,
    }),
    silhouette: {
      length: 0.55,
      height: 0.3,
      width: 0.22,
      colors: { body: 0xd02b1f, belly: 0xe8592c, accent: 0x1e5fbe, eye: 0xf2e6c8 },
      bodyPlan: BodyPlan.Bird,
      legPairs: 1,
      tail: 1.1,
    },
    temperament: temper({ skittishness: 0.85, social: true, arboreal: 0.8, sight: 1.3 }),
  },

  [Species.Iguana]: {
    species: Species.Iguana,
    name: 'Green Iguana',
    enabled: false,
    emoji: '🦎',
    tagline: 'Professional sunbather.',
    diet: Diet.Herbivore,
    size: SizeClass.Small,
    hungerRate: 0.55,
    healthMultiplier: 0.7,
    noiseMultiplier: 0.5,
    eats: ['plant', 'fruit'],
    preys: [],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.ColorShift,
    pros: ['Low hunger', 'Blends into foliage', 'Swims'],
    cons: ['Weak', 'Slow when cold', 'Basks in the open by instinct'],
    locomotion: loco({
      landSpeed: 0.85,
      swimSpeed: 0.9,
      canClimb: false,
      climbSpeed: 0,
      sprintMultiplier: 1.7,
      agility: 1.1,
    }),
    silhouette: {
      length: 1.1,
      height: 0.22,
      width: 0.26,
      colors: { body: 0x6f8f3a, belly: 0x9fb268, accent: 0x3f5320, eye: 0xc2872e },
      bodyPlan: BodyPlan.Reptile,
      legPairs: 2,
      tail: 1.4,
    },
    temperament: temper({ skittishness: 0.6, arboreal: 0.4, stillness: 0.55, aquatic: 0.3 }),
  },

  [Species.Peccary]: {
    species: Species.Peccary,
    name: 'Collared Peccary',
    enabled: false,
    emoji: '🐗',
    tagline: 'Travels in gangs. Holds grudges.',
    diet: Diet.Omnivore,
    size: SizeClass.Medium,
    hungerRate: 1.0,
    healthMultiplier: 1.05,
    noiseMultiplier: 1.35,
    eats: ['plant', 'fruit', 'carrion'],
    preys: [],
    playable: false,
    canBeHunter: false,
    pros: ['Sturdy', 'Big noisy herds to hide in', 'Decent sprint'],
    cons: ['Very loud', 'Poor swimmer'],
    locomotion: loco({ landSpeed: 1.05, swimSpeed: 0.45, sprintMultiplier: 1.75, agility: 1 }),
    silhouette: {
      length: 1.0,
      height: 0.55,
      width: 0.42,
      colors: { body: 0x3b3630, belly: 0x5c554a, accent: 0x2a2622, eye: 0x0d0a08 },
      bodyPlan: BodyPlan.Quadruped,
      legPairs: 2,
      tail: 0.08,
    },
    temperament: temper({ skittishness: 0.55, aggression: 0.25, social: true, hearing: 1.2 }),
  },

  [Species.Tapir]: {
    species: Species.Tapir,
    name: 'Lowland Tapir',
    enabled: false,
    emoji: '🐖',
    tagline: 'A nose that happens to have a body.',
    diet: Diet.Herbivore,
    size: SizeClass.Large,
    hungerRate: 0.85,
    healthMultiplier: 1.3,
    noiseMultiplier: 1.4,
    eats: ['plant', 'fruit'],
    preys: [],
    playable: false,
    canBeHunter: false,
    pros: ['High health', 'Strong swimmer', 'Can shrug off one hit'],
    cons: ['Huge and loud', 'Cannot hide anywhere', 'Slow to turn'],
    locomotion: loco({ landSpeed: 0.92, swimSpeed: 1.05, sprintMultiplier: 1.6, agility: 0.7 }),
    silhouette: {
      length: 1.9,
      height: 0.95,
      width: 0.62,
      colors: { body: 0x36322e, belly: 0x504a42, accent: 0x24211e, eye: 0x0a0806 },
      bodyPlan: BodyPlan.Quadruped,
      legPairs: 2,
      tail: 0.1,
    },
    temperament: temper({ skittishness: 0.5, aquatic: 0.55, nocturnal: true }),
  },

  [Species.Armadillo]: {
    species: Species.Armadillo,
    name: 'Giant Armadillo',
    enabled: false,
    emoji: '🦔',
    tagline: 'Rolls to disagree.',
    diet: Diet.Insectivore,
    size: SizeClass.Small,
    hungerRate: 0.8,
    healthMultiplier: 1.15,
    noiseMultiplier: 0.8,
    eats: ['plant', 'smallAnimal'],
    preys: [],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.CurlUp,
    pros: ['Armour plating', 'Curls up to survive a hit', 'Low profile'],
    cons: ['Slow', 'Poor eyesight', 'Cannot swim'],
    locomotion: loco({ landSpeed: 0.7, swimSpeed: 0.2, canJump: false, sprintMultiplier: 1.5, agility: 0.8 }),
    silhouette: {
      length: 0.85,
      height: 0.32,
      width: 0.42,
      colors: { body: 0x6b6154, belly: 0x9c8f7c, accent: 0x484034, eye: 0x120e0a },
      bodyPlan: BodyPlan.Shelled,
      legPairs: 2,
      tail: 0.6,
    },
    temperament: temper({ skittishness: 0.45, nocturnal: true, sight: 0.55, hearing: 1.2 }),
  },

  [Species.Anteater]: {
    species: Species.Anteater,
    name: 'Giant Anteater',
    enabled: false,
    emoji: '🐜',
    tagline: 'Vacuum cleaner with claws.',
    diet: Diet.Insectivore,
    size: SizeClass.Medium,
    hungerRate: 0.9,
    healthMultiplier: 1.1,
    noiseMultiplier: 1,
    eats: ['plant', 'smallAnimal'],
    preys: [],
    playable: false,
    canBeHunter: false,
    pros: ['Finds food almost anywhere', 'Surprisingly tough', 'Common enough to blend in'],
    cons: ['Very poor eyesight', 'Slow', 'Distinctive silhouette'],
    locomotion: loco({ landSpeed: 0.78, swimSpeed: 0.6, sprintMultiplier: 1.5, agility: 0.75 }),
    silhouette: {
      length: 1.5,
      height: 0.6,
      width: 0.38,
      colors: { body: 0x4a423a, belly: 0x8b8073, accent: 0x201c18, eye: 0x0c0a08 },
      bodyPlan: BodyPlan.Quadruped,
      legPairs: 2,
      tail: 0.95,
    },
    temperament: temper({ skittishness: 0.4, sight: 0.45, hearing: 1.1 }),
  },

  [Species.Turtle]: {
    species: Species.Turtle,
    name: 'Yellow-footed Tortoise',
    emoji: '🐢',
    tagline: 'Has nowhere to be.',
    diet: Diet.Herbivore,
    size: SizeClass.Small,
    /*
     * Barely hungers and very hard to kill: the tortoise's whole proposition.
     *
     * The health multiplier has to clear every predator on the roster (the tiger
     * is 1.35), or "very high HP" is just a sentence in the tagline. It buys
     * time, not safety — nothing here lets it escape, only survive being found.
     */
    hungerRate: 0.25,
    healthMultiplier: 2.4,
    noiseMultiplier: 0.3,
    // A beak nip. The tortoise wins by not dying, not by fighting.
    attackPower: 0.18,
    eats: ['plant', 'fruit'],
    preys: [],
    playable: true,
    canBeHunter: false,
    pros: ['Barely hungry', 'Shell absorbs damage', 'Almost silent', 'Nobody suspects the tortoise'],
    cons: ['Extremely slow', 'No escape at all'],
    locomotion: loco({
      landSpeed: 0.3,
      /*
       * Cannot enter deep water at all.
       *
       * `canSwim` is defined as swimSpeed > 0.15 and the movement solver refuses
       * to walk a non-swimmer into deep water, so zero here is what makes the
       * river a wall for the tortoise rather than a slow crossing.
       */
      swimSpeed: 0,
      canJump: false,
      sprintMultiplier: 1.15,
      agility: 0.5,
    }),
    silhouette: {
      length: 0.6,
      height: 0.28,
      width: 0.44,
      colors: { body: 0x53442c, belly: 0x8a7448, accent: 0xb99a48, eye: 0x100c08 },
      bodyPlan: BodyPlan.Shelled,
      legPairs: 2,
      tail: 0.08,
    },
    temperament: temper({ skittishness: 0.3, stillness: 0.6, aquatic: 0.25 }),
  },

  [Species.Frog]: {
    species: Species.Frog,
    name: 'Poison Dart Frog',
    enabled: false,
    emoji: '🐸',
    tagline: 'Small. Bright. Deeply unpleasant to bite.',
    diet: Diet.Insectivore,
    size: SizeClass.Tiny,
    hungerRate: 0.7,
    healthMultiplier: 0.5,
    noiseMultiplier: 0.2,
    eats: ['plant', 'smallAnimal'],
    preys: [Species.Butterfly],
    playable: false,
    canBeHunter: false,
    pros: ['Tiny and easily missed', 'Big hops', 'Toxic — predators think twice'],
    cons: ['Dies to almost anything', 'Bright warning colours'],
    locomotion: loco({
      landSpeed: 0.6,
      swimSpeed: 1.0,
      jumpPower: 1.9,
      sprintMultiplier: 1.4,
      agility: 1.5,
    }),
    silhouette: {
      length: 0.14,
      height: 0.09,
      width: 0.1,
      colors: { body: 0x1f8cd0, belly: 0x0b2f52, accent: 0x111111, eye: 0x0a0a0a },
      bodyPlan: BodyPlan.Amphibian,
      legPairs: 2,
      tail: 0,
    },
    temperament: temper({ skittishness: 0.75, aquatic: 0.5, stillness: 0.4, nocturnal: true }),
  },

  [Species.Heron]: {
    species: Species.Heron,
    name: 'Cocoi Heron',
    // Withdrawn: the flying body plan reads poorly in play.
    emoji: '🪶',
    tagline: 'Standing perfectly still, judging you.',
    diet: Diet.Piscivore,
    size: SizeClass.Medium,
    hungerRate: 0.95,
    healthMultiplier: 0.7,
    noiseMultiplier: 0.5,
    eats: ['fish', 'smallAnimal'],
    preys: [Species.Piranha, Species.Frog],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.Glide,
    pros: ['Can fly', 'Fishes the shallows safely', 'Natural at standing still'],
    cons: ['Fragile', 'Tall and visible', 'Needs water to feed'],
    locomotion: loco({
      landSpeed: 0.72,
      swimSpeed: 0.5,
      canFly: true,
      flyHeight: 12,
      sprintMultiplier: 1.5,
      agility: 1.2,
    }),
    silhouette: {
      length: 0.8,
      height: 0.95,
      width: 0.24,
      colors: { body: 0x8d949c, belly: 0xe4e6e2, accent: 0x2a2f36, eye: 0xd6c24a },
      bodyPlan: BodyPlan.Bird,
      legPairs: 1,
      tail: 0.35,
    },
    temperament: temper({ skittishness: 0.7, aquatic: 0.6, stillness: 0.7, sight: 1.35 }),
  },

  [Species.Chameleon]: {
    species: Species.Chameleon,
    name: 'Jungle Chameleon',
    enabled: false,
    emoji: '🦎',
    tagline: 'Technically not from here. Nobody has noticed.',
    diet: Diet.Insectivore,
    size: SizeClass.Tiny,
    hungerRate: 0.6,
    healthMultiplier: 0.55,
    noiseMultiplier: 0.15,
    eats: ['plant', 'smallAnimal'],
    preys: [Species.Butterfly],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.ColorShift,
    pros: ['Best camouflage in the game', 'Silent'],
    cons: ['Painfully slow', 'Dies instantly', 'Camouflage breaks if you move'],
    locomotion: loco({
      landSpeed: 0.4,
      swimSpeed: 0.1,
      canClimb: false,
      climbSpeed: 0,
      canJump: false,
      sprintMultiplier: 1.3,
      agility: 0.8,
    }),
    silhouette: {
      length: 0.3,
      height: 0.14,
      width: 0.12,
      colors: { body: 0x5f8a45, belly: 0x8fae62, accent: 0x3c5a2a, eye: 0xd4b23c },
      bodyPlan: BodyPlan.Reptile,
      legPairs: 2,
      tail: 1.0,
    },
    temperament: temper({ skittishness: 0.5, arboreal: 0.75, stillness: 0.8, sight: 1.2 }),
  },

  [Species.HowlerMonkey]: {
    species: Species.HowlerMonkey,
    name: 'Howler Monkey',
    // Withdrawn alongside the spider monkey — see that entry.
    enabled: false,
    emoji: '🙊',
    tagline: 'Audible from three kilometres away.',
    diet: Diet.Herbivore,
    size: SizeClass.Medium,
    hungerRate: 1.1,
    healthMultiplier: 0.9,
    noiseMultiplier: 1.5,
    eats: ['fruit', 'plant'],
    preys: [],
    playable: false,
    canBeHunter: false,
    ability: AbilityId.BranchLeap,
    pros: ['Constant AI howling masks your noise'],
    cons: ['The loudest animal alive', 'Slow on the ground'],
    locomotion: loco({
      landSpeed: 0.85,
      swimSpeed: 0.3,
      canClimb: false,
      climbSpeed: 0,
      jumpPower: 1.3,
      sprintMultiplier: 1.55,
      agility: 1.2,
    }),
    silhouette: {
      length: 0.7,
      height: 0.5,
      width: 0.32,
      colors: { body: 0x5b3320, belly: 0x7d4c2a, accent: 0x2e1a10, eye: 0x0a0705 },
      bodyPlan: BodyPlan.Primate,
      legPairs: 2,
      tail: 1.15,
    },
    temperament: temper({ skittishness: 0.6, social: true, arboreal: 0.9, hearing: 1.15 }),
  },

  // === Ambience-only species (AI, not player-selectable) ==================

  [Species.Piranha]: {
    species: Species.Piranha,
    name: 'Red-bellied Piranha',
    emoji: '🐟',
    tagline: 'Rarely alone.',
    diet: Diet.Carnivore,
    size: SizeClass.Tiny,
    hungerRate: 1,
    healthMultiplier: 0.3,
    noiseMultiplier: 0.1,
    eats: ['smallAnimal', 'carrion'],
    preys: [],
    playable: false,
    canBeHunter: false,
    pros: [],
    cons: [],
    locomotion: loco({ landSpeed: 0, swimSpeed: 1.3, canJump: false, agility: 1.6 }),
    silhouette: {
      length: 0.25,
      height: 0.16,
      width: 0.07,
      colors: { body: 0x5a6068, belly: 0xc23a2a, accent: 0x2c3138, eye: 0xd8d2c0 },
      bodyPlan: BodyPlan.Fish,
      legPairs: 0,
      tail: 0.3,
    },
    temperament: temper({ skittishness: 0.4, aggression: 0.6, social: true, aquatic: 1 }),
  },

  [Species.Bat]: {
    species: Species.Bat,
    name: 'Fruit Bat',
    // Withdrawn: the flying body plan reads poorly in play.
    enabled: false,
    emoji: '🦇',
    tagline: 'Comes out when the light goes.',
    diet: Diet.Herbivore,
    size: SizeClass.Tiny,
    hungerRate: 1,
    healthMultiplier: 0.3,
    noiseMultiplier: 0.2,
    eats: ['fruit'],
    preys: [],
    playable: false,
    canBeHunter: false,
    pros: [],
    cons: [],
    locomotion: loco({ landSpeed: 0.2, swimSpeed: 0, canFly: true, flyHeight: 16, agility: 1.8 }),
    silhouette: {
      length: 0.22,
      height: 0.14,
      width: 0.5,
      colors: { body: 0x2c2429, belly: 0x453a40, accent: 0x1a1518, eye: 0x8a5a2a },
      bodyPlan: BodyPlan.Bird,
      legPairs: 1,
      tail: 0.1,
    },
    temperament: temper({ skittishness: 0.8, nocturnal: true, arboreal: 0.9, social: true }),
  },

  [Species.Butterfly]: {
    species: Species.Butterfly,
    name: 'Blue Morpho',
    emoji: '🦋',
    tagline: 'Pure decoration, and it knows it.',
    diet: Diet.Herbivore,
    size: SizeClass.Tiny,
    hungerRate: 1,
    healthMultiplier: 0.1,
    noiseMultiplier: 0,
    eats: ['plant'],
    preys: [],
    playable: false,
    canBeHunter: false,
    pros: [],
    cons: [],
    locomotion: loco({ landSpeed: 0.1, swimSpeed: 0, canFly: true, flyHeight: 2.4, agility: 2 }),
    silhouette: {
      length: 0.12,
      height: 0.04,
      width: 0.18,
      colors: { body: 0x1a1a24, belly: 0x2b6fd0, accent: 0x59a8f0, eye: 0x000000 },
      bodyPlan: BodyPlan.Insect,
      legPairs: 0,
      tail: 0,
    },
    temperament: temper({ skittishness: 0.9, stillness: 0.2 }),
  },

  // === The playable six ====================================================
  //
  // These are the only species a player is ever dealt. Each one is meant to play
  // differently enough that knowing what you are changes how you play, so the
  // numbers below are deliberately spiky rather than balanced into a mush:
  //
  //   crocodile  owns the water and is helpless away from it
  //   tiger      the all-rounder — fast, tough, patient
  //   tortoise   cannot be killed quickly and cannot go anywhere quickly
  //   leopard    fastest thing alive, always hungry, hits like a slap
  //   gorilla    lethal on land, drowns in water
  //   capybara   cannot fight, cannot starve, can outrun almost anything
  //
  // Crocodile and Turtle already have entries above (Black Caiman and
  // Yellow-footed Tortoise); the three new predators and the ambient ants are
  // defined here.

  [Species.Tiger]: {
    species: Species.Tiger,
    name: 'Tiger',
    emoji: '🐅',
    tagline: 'Patient, tireless, and never in a hurry to eat.',
    diet: Diet.Carnivore,
    size: SizeClass.Large,
    // Barely hungers: the tiger can afford to sit and watch, which is exactly
    // the playstyle it is meant to reward.
    hungerRate: 0.55,
    healthMultiplier: 1.35,
    noiseMultiplier: 0.65,
    // A heavy, committed bite.
    attackPower: 1.5,
    eats: ['smallAnimal', 'largeAnimal', 'carrion', 'fish'],
    preys: [Species.Capybara, Species.Turtle, Species.Gorilla, Species.Leopard],
    playable: true,
    canBeHunter: true,
    ability: AbilityId.Pounce,
    pros: ['Deep stamina', 'Hardly ever hungry', 'Heavy bite', 'Swims when it must'],
    cons: ['Slower than a leopard', 'Big and easy to see', 'Loud in undergrowth'],
    locomotion: loco({
      landSpeed: 1.24,
      swimSpeed: 0.9,
      canClimb: false,
      climbSpeed: 0,
      jumpPower: 1.25,
      sprintMultiplier: 1.95,
      agility: 1.1,
    }),
    silhouette: {
      length: 2.1,
      height: 0.95,
      width: 0.62,
      colors: { body: 0xd18434, belly: 0xefe0c4, accent: 0x241a12, eye: 0xd8c95c },
      bodyPlan: BodyPlan.Feline,
      legPairs: 2,
      tail: 0.62,
    },
    temperament: temper({
      skittishness: 0.05,
      aggression: 0.95,
      aquatic: 0.4,
      stillness: 0.4,
      sight: 1.35,
      hearing: 1.3,
    }),
  },

  [Species.Leopard]: {
    species: Species.Leopard,
    name: 'Leopard',
    emoji: '🐆',
    tagline: 'The fastest thing in the jungle, and the hungriest.',
    diet: Diet.Carnivore,
    size: SizeClass.Medium,
    // The cost of all that speed: a leopard that stops hunting starves.
    hungerRate: 2.3,
    healthMultiplier: 0.85,
    noiseMultiplier: 0.5,
    // Built for speed, not for power: it wins chases, not fights.
    attackPower: 0.75,
    eats: ['smallAnimal', 'largeAnimal', 'carrion', 'fish'],
    preys: [Species.Capybara, Species.Turtle],
    playable: true,
    canBeHunter: true,
    ability: AbilityId.Pounce,
    pros: ['Fastest animal alive', 'Huge stamina', 'Nearly silent'],
    cons: ['Starves fast', 'Weak bite for a cat', 'Thin hide'],
    locomotion: loco({
      landSpeed: 1.5,
      swimSpeed: 0.7,
      canClimb: false,
      climbSpeed: 0,
      jumpPower: 1.45,
      sprintMultiplier: 2.35,
      agility: 1.4,
    }),
    silhouette: {
      length: 1.6,
      height: 0.74,
      width: 0.44,
      colors: { body: 0xd8b055, belly: 0xf2e7c8, accent: 0x2a2016, eye: 0xc9d95a },
      bodyPlan: BodyPlan.Feline,
      legPairs: 2,
      tail: 0.78,
    },
    temperament: temper({
      skittishness: 0.12,
      aggression: 0.85,
      aquatic: 0.2,
      arboreal: 0.45,
      stillness: 0.25,
      sight: 1.4,
      hearing: 1.35,
    }),
  },

  [Species.Gorilla]: {
    species: Species.Gorilla,
    name: 'Silverback Gorilla',
    emoji: '🦍',
    tagline: 'Unstoppable on land. Do not go near the water.',
    diet: Diet.Omnivore,
    size: SizeClass.Large,
    hungerRate: 1.0,
    healthMultiplier: 1.1,
    noiseMultiplier: 1.1,
    // Strongest attack in the game, by design.
    attackPower: 2.1,
    eats: ['fruit', 'plant', 'smallAnimal', 'carrion'],
    preys: [Species.Capybara, Species.Leopard],
    playable: true,
    canBeHunter: true,
    ability: AbilityId.HerdBlend,
    pros: ['Strongest attack in the game', 'Stands up to look around'],
    cons: ['Cannot swim — deep water drowns it', 'Noisy', 'Only average speed'],
    /*
     * swimSpeed 0 is load-bearing, not a rounding of "swims badly".
     *
     * `canSwim` is defined as swimSpeed > 0.15, and the movement solver refuses
     * to let an animal that cannot swim walk into deep water at all — which is
     * what makes the river a wall for a gorilla rather than a hazard it can
     * blunder into and die in.
     */
    locomotion: loco({
      landSpeed: 1.05,
      swimSpeed: 0,
      canClimb: false,
      climbSpeed: 0,
      jumpPower: 0.9,
      sprintMultiplier: 1.7,
      agility: 0.85,
    }),
    silhouette: {
      length: 1.5,
      height: 1.05,
      width: 0.72,
      // Lifted off true black. A gorilla is black, but a black animal in a dark
          // forest is a hole in the screen — there has to be enough value range
          // left inside the silhouette for the saddle and the muzzle to read.
          colors: { body: 0x3c3739, belly: 0x5c5457, accent: 0x9d9891, eye: 0x3a2a18 },
      bodyPlan: BodyPlan.Primate,
      legPairs: 2,
      tail: 0,
    },
    temperament: temper({
      skittishness: 0.1,
      aggression: 1.0,
      aquatic: 0,
      arboreal: 0.35,
      stillness: 0.35,
      sight: 1.15,
      hearing: 1.1,
    }),
  },

  [Species.Ant]: {
    species: Species.Ant,
    name: 'Leafcutter Ant',
    emoji: '🐜',
    tagline: 'A column of them crossing the trail.',
    diet: Diet.Herbivore,
    size: SizeClass.Tiny,
    hungerRate: 0,
    healthMultiplier: 0.05,
    noiseMultiplier: 0,
    eats: ['plant'],
    preys: [],
    playable: false,
    canBeHunter: false,

    pros: [],
    cons: [],
    locomotion: loco({ landSpeed: 0.16, swimSpeed: 0, agility: 1.4 }),
    silhouette: {
      length: 0.09,
      height: 0.04,
      width: 0.05,
      colors: { body: 0x3a1f12, belly: 0x24140c, accent: 0x5a3520, eye: 0x000000 },
      bodyPlan: BodyPlan.Insect,
      legPairs: 3,
      tail: 0,
    },
    temperament: temper({ skittishness: 0.95, social: true, stillness: 0.05 }),
  },

  /**
   * The hunter: a person with a rifle.
   *
   * Not playable as a survivor and never spawned as AI — `assignRoles` gives it
   * to exactly one player and nothing else ever uses it. It sits in the same
   * table as the animals because every system in the game addresses an actor by
   * species, and a parallel type for the hunter would fork all of them.
   *
   * Deliberately unremarkable numbers. The hunter's power is the rifle and the
   * fact that nothing can be sure whether the animal in front of it is a player;
   * making them fast or tough as well would just make them a monster.
   */
  [Species.Hunter]: {
    species: Species.Hunter,
    name: 'The Hunter',
    emoji: '\u{1F52B}',
    tagline: 'The only thing out here wearing boots.',
    diet: Diet.Carnivore,
    size: SizeClass.Large,
    hungerRate: 0.5,
    healthMultiplier: 1.0,
    noiseMultiplier: 1.25,
    attackPower: 1.0,
    eats: ['carrion'],
    preys: [],
    playable: false,
    canBeHunter: true,
    pros: ['Carries a rifle', 'Kills at range', 'Nothing in the jungle matches it in a fight'],
    cons: ['Impossible to mistake for wildlife', 'Loud', 'Shooting the wrong animal is fatal'],
    locomotion: loco({
      landSpeed: 1.1,
      swimSpeed: 0.6,
      jumpPower: 1.0,
      sprintMultiplier: 1.75,
      agility: 1.2,
    }),
    silhouette: {
      length: 0.5,
      height: 1.75,
      width: 0.46,
      // Blue shirt, green trousers, brown boots and cap.
      colors: { body: 0x2f5f9e, belly: 0x3c5a2a, accent: 0x4a3524, eye: 0x1a1a1a },
      bodyPlan: BodyPlan.Human,
      legPairs: 1,
      tail: 0,
    },
    temperament: temper({
      skittishness: 0,
      aggression: 1,
      aquatic: 0.2,
      stillness: 0.2,
      sight: 1.4,
      hearing: 1.2,
    }),
  },
};

/**
 * All species as an array, in table order.
 *
 * Includes withdrawn ones. The snapshot format encodes a species as its index
 * here, so this list must stay stable even when a species is disabled.
 */
export const ALL_SPECIES: Species[] = Object.keys(ANIMALS) as Species[];

/** True unless the species has been explicitly withdrawn. */
export function isEnabled(species: Species): boolean {
  return ANIMALS[species].enabled !== false;
}

/**
 * Species the world may spawn on its own.
 *
 * The hunter is excluded here rather than by `enabled: false`, and the
 * distinction matters: he is very much in the game, he simply is not *wildlife*.
 * Exactly one exists per round and he arrives through `assignRoles`, so any
 * spawner that reached for him would be putting a second man in the jungle.
 */
export const SPAWNABLE_SPECIES: Species[] = ALL_SPECIES.filter(
  (s) => isEnabled(s) && s !== Species.Hunter,
);

/** Species a survivor may choose. */
export const PLAYABLE_SPECIES: Species[] = ALL_SPECIES.filter(
  (s) => ANIMALS[s].playable && isEnabled(s),
);

/** Species that only exist as ambient AI. */
export const AMBIENT_SPECIES: Species[] = SPAWNABLE_SPECIES.filter((s) => !ANIMALS[s].playable);

export function getAnimal(species: Species): AnimalDef {
  return ANIMALS[species];
}

/** True if `predator` naturally hunts `prey`. Drives AI and player eating. */
export function isPreyOf(predator: Species, prey: Species): boolean {
  return ANIMALS[predator].preys.includes(prey);
}

/** True if the species can survive in deep water. */
export function canSwim(species: Species): boolean {
  return ANIMALS[species].locomotion.swimSpeed > 0.15;
}

/**
 * How well this species blends into a given ground type — used by the AI to
 * pick resting spots and by the UI to hint at good hiding places.
 */
export function concealment(species: Species, foliageDensity: number, inWater: boolean): number {
  const def = ANIMALS[species];
  // Small animals disappear into undergrowth; large ones stick out.
  const sizePenalty = [0.0, 0.08, 0.22, 0.42, 0.5][def.size];
  let value = foliageDensity * (1 - sizePenalty);
  if (inWater) value = Math.max(value, def.temperament.aquatic * 0.8);
  return Math.max(0, Math.min(1, value));
}
