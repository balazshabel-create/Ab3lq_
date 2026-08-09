import type { FranchisePerkDef } from '@/game/types';

/**
 * FRANCHISE (prestige) PERKS
 *
 * The Golden Ladle (star) has a deliberately player-friendly dual role:
 *  - **passively** every star earned grants +2% global income,
 *  - **and** it acts as the threshold that unlocks these perks.
 *
 * Buying a perk does NOT subtract stars: `starCost` is a threshold you reach,
 * not a price you pay. So there is never a "I ruined my build" moment, which is
 * the worst thing you can do in a casual mobile game - every branch of the tree
 * is reachable, it is only a matter of time. The `requires` field sets order.
 */

export const FRANCHISE_PERKS: readonly FranchisePerkDef[] = [
  {
    id: 'perk.head-start',
    name: 'Seed Money',
    description: 'After every franchise you start with $25 K and 3 extra levels on your first product.',
    starCost: 5,
    effects: [],
  },
  {
    id: 'perk.warm-oven',
    name: 'Preheated Oven',
    description: 'x1.5 global income.',
    starCost: 15,
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 1.5 }],
  },
  {
    id: 'perk.night-owl',
    name: 'Night Owl',
    description: '+3h offline cap and +10% offline rate.',
    starCost: 25,
    requires: 'perk.warm-oven',
    effects: [
      { type: 'offlineCapHours', value: 3 },
      { type: 'offlineRate', value: 0.1 },
    ],
  },
  {
    id: 'perk.fast-hands',
    name: 'Fast Hands',
    description: 'x1.5 value on hand-served orders.',
    starCost: 40,
    effects: [{ type: 'tapMultiplier', value: 1.5 }],
  },
  {
    id: 'perk.franchise-manual',
    name: 'Franchise Handbook',
    description: 'x2.5 global income.',
    starCost: 80,
    requires: 'perk.warm-oven',
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 2.5 }],
  },
  {
    id: 'perk.supply-chain',
    name: 'Own Supply Chain',
    description: 'Every cycle is 20% faster.',
    starCost: 140,
    effects: [{ type: 'cycleMultiplier', scope: { kind: 'global' }, value: 0.8 }],
  },
  {
    id: 'perk.brand',
    name: 'National Brand',
    description: 'x5 global income.',
    starCost: 300,
    requires: 'perk.franchise-manual',
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 5 }],
  },
  {
    id: 'perk.logistics',
    name: 'Night Logistics',
    description: '+6h offline cap and +20% offline rate.',
    starCost: 500,
    requires: 'perk.night-owl',
    effects: [
      { type: 'offlineCapHours', value: 6 },
      { type: 'offlineRate', value: 0.2 },
    ],
  },
  {
    id: 'perk.automation',
    name: 'Full Automation',
    description: 'Every cycle is a further 30% faster.',
    starCost: 900,
    requires: 'perk.supply-chain',
    effects: [{ type: 'cycleMultiplier', scope: { kind: 'global' }, value: 0.7 }],
  },
  {
    id: 'perk.empire',
    name: 'Empire Kitchen',
    description: 'x12 global income.',
    starCost: 2_000,
    requires: 'perk.brand',
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 12 }],
  },
];

const BY_ID = new Map(FRANCHISE_PERKS.map((p) => [p.id, p]));

export function getPerk(id: string): FranchisePerkDef | null {
  return BY_ID.get(id) ?? null;
}

/** Can the perk be bought (enough stars and the prerequisite owned)? */
export function canBuyPerk(
  perk: FranchisePerkDef,
  stars: number,
  ownedIds: readonly string[],
): { ok: boolean; reason?: string } {
  if (ownedIds.includes(perk.id)) return { ok: false, reason: 'Owned' };
  if (perk.requires && !ownedIds.includes(perk.requires)) {
    const req = BY_ID.get(perk.requires);
    return { ok: false, reason: `Needs: ${req?.name ?? perk.requires}` };
  }
  if (stars < perk.starCost) return { ok: false, reason: `Needs ${perk.starCost} stars` };
  return { ok: true };
}
