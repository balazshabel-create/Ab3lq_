import type { StaffDef } from '@/game/types';

/**
 * STAFF
 *
 * Two separate things:
 *  1. **Manager** - a one-off purchase per product that automates it (see
 *     `managerCost` in products.ts). This is the most important purchase in the
 *     game, because offline income only accrues on automated products.
 *  2. **Roles** (here) - levellable employees that grant global bonuses.
 *
 * IMPORTANT SEMANTICS: `effectPerLevel.value` is an **additive** fraction per
 * level. Total effect: 1 + value * level. (Not a power!) So a level-50 chef is
 * 1 + 0.03*50 = x2.5, which is predictable and never runs away.
 *
 * There are no wages / upkeep: negative cashflow is frustrating in an idle
 * game, and "I quit and lost my money" is the opposite of the genre.
 */

export const STAFF: readonly StaffDef[] = [
  {
    id: 'chef',
    role: 'chef',
    name: 'Chef',
    icon: 'chef',
    description: 'Raises the income of every product.',
    baseCost: 4_000,
    costGrowth: 1.18,
    maxLevel: 50,
    effectPerLevel: { type: 'incomeMultiplier', scope: { kind: 'global' }, value: 0.03 },
  },
  {
    id: 'courier',
    role: 'courier',
    name: 'Courier',
    icon: 'scooter',
    description: 'More income while you are away (offline rate).',
    baseCost: 30_000,
    costGrowth: 1.24,
    maxLevel: 25,
    effectPerLevel: { type: 'offlineRate', value: 0.02 },
  },
  {
    id: 'cashier',
    role: 'cashier',
    name: 'Cashier',
    icon: 'cashier',
    description: 'Stronger hand-served orders (tapping).',
    baseCost: 2_000,
    costGrowth: 1.2,
    maxLevel: 40,
    // Additive: x1.8 at level 40. Deliberately modest - see the tap limit
    // note on the `counter` machine in equipment.ts.
    effectPerLevel: { type: 'tapMultiplier', value: 0.02 },
  },
  {
    id: 'marketer',
    role: 'marketer',
    name: 'Marketer',
    icon: 'megaphone',
    description: 'Better Food Coin odds from crates and quests.',
    baseCost: 250_000,
    costGrowth: 1.3,
    maxLevel: 20,
    effectPerLevel: { type: 'coinFind', value: 0.05 },
  },
];

const STAFF_BY_ID = new Map(STAFF.map((s) => [s.id, s]));

export function getStaff(id: string): StaffDef {
  const staff = STAFF_BY_ID.get(id);
  if (!staff) throw new Error(`Unknown staff member: ${id}`);
  return staff;
}

/** Cost of the next level: baseCost * costGrowth^level */
export function staffLevelCost(def: StaffDef, currentLevel: number): number {
  return Math.ceil(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

/** Total effect value of the role at the given level (additive model). */
export function staffEffectValue(def: StaffDef, level: number): number {
  return def.effectPerLevel.value * level;
}
