/**
 * Weaknesses.ts — the secret handicap every survivor carries.
 *
 * Design rules baked into this file:
 *   • Only survivors get a weakness. The hunter never has one.
 *   • A player sees only their own weakness. It is never rendered above an
 *     animal, and it is never sent to other clients — the hunter has to infer
 *     it from behaviour ("why is that capybara limping?").
 *   • Weaknesses must be anatomically plausible for the species: a snake cannot
 *     have an injured leg, a sloth cannot have noisy footsteps.
 *   • Rarer does not mean strictly worse — it means more interesting. A rare
 *     weakness changes how you play the round, not just a stat.
 */

import { Rng } from '../Systems/Rng';
import { Species, ANIMALS, BodyPlan } from '../Animals/AnimalTypes';

export enum WeaknessId {
  InjuredLeg = 'injured_leg',
  MissingTeeth = 'missing_teeth',
  BadEye = 'bad_eye',
  WeakLungs = 'weak_lungs',
  FastMetabolism = 'fast_metabolism',
  NoisySteps = 'noisy_steps',
  SlowDigestion = 'slow_digestion',
  EasilyScared = 'easily_scared',
  WeakBody = 'weak_body',
  ShortLegs = 'short_legs',
  HeavyBreather = 'heavy_breather',
  StiffJoints = 'stiff_joints',
  DullSenses = 'dull_senses',
  HoarseWhistle = 'hoarse_whistle',
}

export enum Rarity {
  Common = 'common',
  Uncommon = 'uncommon',
  Rare = 'rare',
}

/**
 * Multiplicative/additive modifiers applied on top of the species stats.
 * Everything defaults to "no change", so a weakness only lists what it touches.
 */
export interface WeaknessModifiers {
  /** Multiplier on walk and sprint speed. */
  speedMultiplier?: number;
  /** Multiplier on sprint speed only, on top of speedMultiplier. */
  sprintMultiplier?: number;
  /** Multiplier on max stamina. */
  staminaMultiplier?: number;
  /** Multiplier on stamina drain while sprinting. */
  staminaDrainMultiplier?: number;
  /** Multiplier on stamina regeneration rate. */
  staminaRegenMultiplier?: number;
  /** Multiplier on hunger decay rate. */
  hungerRateMultiplier?: number;
  /** Multiplier on how long a meal takes. */
  eatDurationMultiplier?: number;
  /** Multiplier on nutrition gained per meal. */
  nutritionMultiplier?: number;
  /**
   * If set, a meal restores hunger gradually over this many seconds instead of
   * instantly (slow digestion).
   */
  digestOverSeconds?: number;
  /** Multiplier on max health. */
  healthMultiplier?: number;
  /** Multiplier on how far the player can see (view distance / fog pull-in). */
  sightMultiplier?: number;
  /** Reduces the player's camera FOV on one side, as a subtle vignette. */
  peripheralPenalty?: number;
  /** Multiplier on the noise the player emits. */
  noiseMultiplier?: number;
  /** Multiplier on climb speed. */
  climbMultiplier?: number;
  /** Chance per second of an involuntary flinch near a dangerous animal. */
  flinchChance?: number;
  /** Multiplier on the whistle's audible range (a weaker whistle carries less). */
  whistleRangeMultiplier?: number;
  /** Multiplier on the whistle cooldown. */
  whistleCooldownMultiplier?: number;
  /** Multiplier on turn rate. */
  agilityMultiplier?: number;
}

export interface WeaknessDef {
  id: WeaknessId;
  name: string;
  emoji: string;
  /** What the player is told, in-fiction. */
  description: string;
  /** Concrete advice, shown on the role card — weaknesses should teach play. */
  advice: string;
  rarity: Rarity;
  modifiers: WeaknessModifiers;
  /**
   * Body plans this weakness makes sense for. Empty means "any".
   * This is the anatomical plausibility filter.
   */
  bodyPlans?: BodyPlan[];
  /** Species that can never roll this, regardless of body plan. */
  excludeSpecies?: Species[];
  /** Only species that can climb / fly / etc. */
  requires?: 'fly' | 'teeth' | 'legs';
}

/** Relative likelihood of each rarity tier being rolled. */
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  [Rarity.Common]: 58,
  [Rarity.Uncommon]: 30,
  [Rarity.Rare]: 12,
};

export const WEAKNESSES: Record<WeaknessId, WeaknessDef> = {
  // --- Common: a nudge, not a handicap ------------------------------------

  [WeaknessId.ShortLegs]: {
    id: WeaknessId.ShortLegs,
    name: 'Short Legs',
    emoji: '🏃',
    description: 'You are a slightly undersized specimen. Everything is a little further away.',
    advice: 'Do not race anything. Stay near cover and let the herd move for you.',
    rarity: Rarity.Common,
    modifiers: { speedMultiplier: 0.95 },
    requires: 'legs',
  },

  [WeaknessId.DullSenses]: {
    id: WeaknessId.DullSenses,
    name: 'Dull Senses',
    emoji: '🌀',
    description: 'Sounds arrive muffled and late. You will notice things a beat after everyone else.',
    advice: 'Rely on sightlines, not on your ears. Keep your back to open ground.',
    rarity: Rarity.Common,
    modifiers: { sightMultiplier: 0.94 },
  },

  [WeaknessId.StiffJoints]: {
    id: WeaknessId.StiffJoints,
    name: 'Stiff Joints',
    emoji: '🦴',
    description: 'You turn like a canoe. Direction changes take a moment longer.',
    advice: 'Commit to your escape route early — you cannot juke a predator.',
    rarity: Rarity.Common,
    modifiers: { agilityMultiplier: 0.78 },
  },

  [WeaknessId.HoarseWhistle]: {
    id: WeaknessId.HoarseWhistle,
    name: 'Hoarse Whistle',
    emoji: '🪈',
    description: 'Your whistle is thin and weak. It does not carry as far as it should.',
    advice: 'Good news: the hunter is less likely to hear it. Whistle freely.',
    rarity: Rarity.Common,
    modifiers: { whistleRangeMultiplier: 0.6, whistleCooldownMultiplier: 1.3 },
  },

  [WeaknessId.BadEye]: {
    id: WeaknessId.BadEye,
    name: 'Bad Eye',
    emoji: '👁️',
    description: 'One eye is clouded over. Distant shapes blur and your side vision is poor.',
    advice: 'Turn your whole body to scan. Something will be standing in your blind spot.',
    rarity: Rarity.Common,
    modifiers: { sightMultiplier: 0.8, peripheralPenalty: 0.35 },
  },

  // --- Uncommon: you will feel this every minute --------------------------

  [WeaknessId.InjuredLeg]: {
    id: WeaknessId.InjuredLeg,
    name: 'Injured Leg',
    emoji: '🦵',
    description: 'A bad paw. You move with a limp and tire faster than you should.',
    advice: 'You cannot outrun anything. Stay in water or in the middle of a herd.',
    rarity: Rarity.Uncommon,
    modifiers: { speedMultiplier: 0.88, staminaDrainMultiplier: 1.25 },
    requires: 'legs',
  },


  [WeaknessId.WeakLungs]: {
    id: WeaknessId.WeakLungs,
    name: 'Weak Lungs',
    emoji: '🫁',
    description: 'Your chest burns after a few strides, and it takes a long time to settle.',
    advice: 'Sprint in short bursts only, and never without a hiding place in sight.',
    rarity: Rarity.Uncommon,
    modifiers: { staminaMultiplier: 0.65, staminaRegenMultiplier: 0.6 },
  },

  [WeaknessId.MissingTeeth]: {
    id: WeaknessId.MissingTeeth,
    name: 'Missing Teeth',
    emoji: '🦷',
    description: 'Half your bite is gone. Meals take much longer and leave you exposed.',
    advice: 'Eat small, eat often, and never start a meal in the open.',
    rarity: Rarity.Uncommon,
    modifiers: { eatDurationMultiplier: 1.85, nutritionMultiplier: 0.82 },
    requires: 'teeth',
  },

  [WeaknessId.NoisySteps]: {
    id: WeaknessId.NoisySteps,
    name: 'Noisy Steps',
    emoji: '🐾',
    description: 'You crash through undergrowth. Every step carries further than it should.',
    advice: 'Walk, do not run. Move while it rains — the downpour covers you.',
    rarity: Rarity.Uncommon,
    modifiers: { noiseMultiplier: 1.6 },
    requires: 'legs',
  },

  [WeaknessId.FastMetabolism]: {
    id: WeaknessId.FastMetabolism,
    name: 'Fast Metabolism',
    emoji: '🍖',
    description: 'You burn through everything you eat. Hunger comes back quickly.',
    advice: 'You will have to take food risks the others do not. Scout feeding spots early.',
    rarity: Rarity.Uncommon,
    modifiers: { hungerRateMultiplier: 1.45 },
  },


  // --- Rare: reshapes how you play the whole round ------------------------

  [WeaknessId.WeakBody]: {
    id: WeaknessId.WeakBody,
    name: 'Weak Body',
    emoji: '🩸',
    description: 'You are underweight and frail. You will not survive what others shrug off.',
    advice: 'One hit is very likely fatal. Never let anything get within pouncing range.',
    rarity: Rarity.Rare,
    modifiers: { healthMultiplier: 0.6, speedMultiplier: 1.04 },
  },

  [WeaknessId.SlowDigestion]: {
    id: WeaknessId.SlowDigestion,
    name: 'Slow Digestion',
    emoji: '🐌',
    description: 'Food takes a long time to do you any good. Your hunger fills back slowly.',
    advice: 'Eat well before you need to. Eating in a panic will not save you.',
    rarity: Rarity.Rare,
    modifiers: { digestOverSeconds: 26, nutritionMultiplier: 1.15 },
  },

  [WeaknessId.EasilyScared]: {
    id: WeaknessId.EasilyScared,
    name: 'Easily Scared',
    emoji: '🧠',
    description:
      'Your nerves betray you. Near a predator, your animal flinches on its own — a twitch no AI ever makes.',
    advice: 'Keep your distance from predators. Your own body will give you away up close.',
    rarity: Rarity.Rare,
    modifiers: { flinchChance: 0.22, speedMultiplier: 1.03 },
  },

  [WeaknessId.HeavyBreather]: {
    id: WeaknessId.HeavyBreather,
    name: 'Heavy Breather',
    emoji: '💨',
    description:
      'You wheeze audibly when tired. Sprint too long and anything nearby will hear exactly where you are.',
    advice: 'Sprint away from danger, never towards cover you intend to hide in.',
    rarity: Rarity.Rare,
    modifiers: { noiseMultiplier: 1.3, staminaMultiplier: 0.85, staminaRegenMultiplier: 0.8 },
  },
};

export const ALL_WEAKNESSES: WeaknessId[] = Object.keys(WEAKNESSES) as WeaknessId[];

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** Body plans that have recognisable legs to injure. */
const LEGGED_PLANS: BodyPlan[] = [
  BodyPlan.Quadruped,
  BodyPlan.Feline,
  BodyPlan.Reptile,
  BodyPlan.Primate,
  BodyPlan.Bird,
  BodyPlan.Amphibian,
  BodyPlan.Shelled,
];

/** Body plans with a bite worth losing teeth from. */
const TOOTHED_PLANS: BodyPlan[] = [
  BodyPlan.Feline,
  BodyPlan.Reptile,
  BodyPlan.Serpent,
  BodyPlan.Quadruped,
  BodyPlan.Fish,
  BodyPlan.Primate,
];

/**
 * Can this species roll this weakness?
 *
 * This is the check that stops the game handing an anaconda a limp.
 */
export function isWeaknessEligible(species: Species, id: WeaknessId): boolean {
  const def = WEAKNESSES[id];
  const animal = ANIMALS[species];

  if (def.excludeSpecies?.includes(species)) return false;
  if (def.bodyPlans && !def.bodyPlans.includes(animal.silhouette.bodyPlan)) return false;

  switch (def.requires) {
    case 'legs':
      // Legless bodies and animals that mostly fly have nothing to limp on.
      if (!LEGGED_PLANS.includes(animal.silhouette.bodyPlan)) return false;
      if (animal.locomotion.canFly && animal.locomotion.landSpeed < 0.6) return false;
      return true;
    case 'fly':
      return animal.locomotion.canFly;
    case 'teeth':
      return TOOTHED_PLANS.includes(animal.silhouette.bodyPlan);
    default:
      return true;
  }
}

/** Every weakness this species could be given. */
export function eligibleWeaknesses(species: Species): WeaknessId[] {
  return ALL_WEAKNESSES.filter((id) => isWeaknessEligible(species, id));
}

/**
 * Roll a weakness for a survivor.
 *
 * Rarity is rolled first, then a weakness within that tier. If a tier has no
 * eligible options for this species (a snake has no climbing weaknesses), the
 * roll falls back to the full eligible pool rather than failing.
 */
export function rollWeakness(species: Species, rng: Rng): WeaknessId {
  const eligible = eligibleWeaknesses(species);
  if (eligible.length === 0) return WeaknessId.DullSenses; // universal fallback

  const tiers = [Rarity.Common, Rarity.Uncommon, Rarity.Rare];
  const weights = tiers.map((t) => {
    const hasAny = eligible.some((id) => WEAKNESSES[id].rarity === t);
    return hasAny ? RARITY_WEIGHTS[t] : 0;
  });
  const tier = rng.pickWeighted(tiers, weights);
  const pool = eligible.filter((id) => WEAKNESSES[id].rarity === tier);
  return pool.length > 0 ? rng.pick(pool) : rng.pick(eligible);
}

// ---------------------------------------------------------------------------
// Applying modifiers
// ---------------------------------------------------------------------------

/** The resolved stat block a player actually plays with. */
export interface ResolvedStats {
  walkSpeed: number;
  sprintSpeed: number;
  swimSpeed: number;
  climbSpeed: number;
  jumpPower: number;
  turnRate: number;
  maxHealth: number;
  maxStamina: number;
  staminaDrain: number;
  staminaRegen: number;
  hungerRate: number;
  eatDuration: number;
  nutritionScale: number;
  digestOverSeconds: number;
  sightScale: number;
  peripheralPenalty: number;
  noiseScale: number;
  flinchChance: number;
  whistleRangeScale: number;
  whistleCooldownScale: number;
}

/**
 * Combine species stats with a weakness (or none, for the hunter) into the
 * single stat block the movement, hunger and whistle systems read.
 */
export function resolveStats(
  species: Species,
  weakness: WeaknessId | null,
  base: {
    animalSpeed: number;
    sprintMultiplier: number;
    turnRate: number;
    healthMax: number;
    staminaMax: number;
    staminaDrain: number;
    staminaRegen: number;
    hungerDecay: number;
    eatDuration: number;
    climbSpeed: number;
    jumpSpeed: number;
  },
  isHunter = false,
): ResolvedStats {
  const animal = ANIMALS[species];
  const loco = animal.locomotion;
  const m: WeaknessModifiers = weakness ? WEAKNESSES[weakness].modifiers : {};

  // The hunter gets a small edge instead of a weakness.
  const hunterBonus = isHunter ? 1 : 1;

  const speedMul = (m.speedMultiplier ?? 1) * hunterBonus;
  const walk = base.animalSpeed * loco.landSpeed * speedMul;
  const sprintMul = loco.sprintMultiplier * (m.sprintMultiplier ?? 1);

  return {
    walkSpeed: walk,
    sprintSpeed: walk * sprintMul,
    swimSpeed: base.animalSpeed * loco.swimSpeed * speedMul,
    climbSpeed: base.climbSpeed * loco.climbSpeed * (m.climbMultiplier ?? 1),
    jumpPower: base.jumpSpeed * loco.jumpPower * (m.agilityMultiplier ?? 1),
    turnRate: base.turnRate * loco.agility * (m.agilityMultiplier ?? 1),
    maxHealth: base.healthMax * animal.healthMultiplier * (m.healthMultiplier ?? 1),
    maxStamina: base.staminaMax * (m.staminaMultiplier ?? 1),
    staminaDrain: base.staminaDrain * (m.staminaDrainMultiplier ?? 1),
    staminaRegen: base.staminaRegen * (m.staminaRegenMultiplier ?? 1),
    hungerRate: base.hungerDecay * animal.hungerRate * (m.hungerRateMultiplier ?? 1),
    eatDuration: base.eatDuration * (m.eatDurationMultiplier ?? 1),
    nutritionScale: m.nutritionMultiplier ?? 1,
    digestOverSeconds: m.digestOverSeconds ?? 0,
    sightScale: m.sightMultiplier ?? 1,
    peripheralPenalty: m.peripheralPenalty ?? 0,
    noiseScale: animal.noiseMultiplier * (m.noiseMultiplier ?? 1),
    flinchChance: m.flinchChance ?? 0,
    whistleRangeScale: m.whistleRangeMultiplier ?? 1,
    whistleCooldownScale: m.whistleCooldownMultiplier ?? 1,
  };
}
