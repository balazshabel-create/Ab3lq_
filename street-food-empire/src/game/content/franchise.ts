import type { FranchisePerkDef } from '@/game/types';

/**
 * FRANCHISE (presztízs) FEJLESZTÉSEK
 *
 * Az Arany Merőkanál (csillag) kettős szerepű, szándékosan játékosbarát módon:
 *  - **passzívan** minden megszerzett csillag +2% globális bevételt ad,
 *  - **és** küszöbként nyitja ezeket a perkeket.
 *
 * A perk megvásárlása NEM vonja le a csillagokat: a `starCost` egy elért
 * küszöb, nem költség. Így soha nincs "elrontottam a buildet" érzés, ami egy
 * casual mobiljátékban a legrosszabb, amit tehetsz — a fa minden ága
 * elérhető, csak idő kérdése. A `requires` mező adja a sorrendet.
 */

export const FRANCHISE_PERKS: readonly FranchisePerkDef[] = [
  {
    id: 'perk.head-start',
    name: 'Indulótőke',
    description: 'Minden franchise után 25 E Ft-tal és 3 szint alaptermékkel kezdesz.',
    starCost: 5,
    effects: [],
  },
  {
    id: 'perk.warm-oven',
    name: 'Bemelegített kemence',
    description: '×1,5 globális bevétel.',
    starCost: 15,
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 1.5 }],
  },
  {
    id: 'perk.night-owl',
    name: 'Éjjeli bagoly',
    description: '+3 óra offline sapka és +10% offline arány.',
    starCost: 25,
    requires: 'perk.warm-oven',
    effects: [
      { type: 'offlineCapHours', value: 3 },
      { type: 'offlineRate', value: 0.1 },
    ],
  },
  {
    id: 'perk.fast-hands',
    name: 'Gyors kezek',
    description: '×1,5 kézi kiszolgálás értéke.',
    starCost: 40,
    effects: [{ type: 'tapMultiplier', value: 1.5 }],
  },
  {
    id: 'perk.franchise-manual',
    name: 'Franchise-kézikönyv',
    description: '×2,5 globális bevétel.',
    starCost: 80,
    requires: 'perk.warm-oven',
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 2.5 }],
  },
  {
    id: 'perk.supply-chain',
    name: 'Saját beszállítói lánc',
    description: 'Minden ciklus 20%-kal gyorsabb.',
    starCost: 140,
    effects: [{ type: 'cycleMultiplier', scope: { kind: 'global' }, value: 0.8 }],
  },
  {
    id: 'perk.brand',
    name: 'Országos márka',
    description: '×5 globális bevétel.',
    starCost: 300,
    requires: 'perk.franchise-manual',
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 5 }],
  },
  {
    id: 'perk.logistics',
    name: 'Éjszakai logisztika',
    description: '+6 óra offline sapka és +20% offline arány.',
    starCost: 500,
    requires: 'perk.night-owl',
    effects: [
      { type: 'offlineCapHours', value: 6 },
      { type: 'offlineRate', value: 0.2 },
    ],
  },
  {
    id: 'perk.automation',
    name: 'Teljes automatizálás',
    description: 'Minden ciklus további 30%-kal gyorsabb.',
    starCost: 900,
    requires: 'perk.supply-chain',
    effects: [{ type: 'cycleMultiplier', scope: { kind: 'global' }, value: 0.7 }],
  },
  {
    id: 'perk.empire',
    name: 'Birodalmi konyha',
    description: '×12 globális bevétel.',
    starCost: 2_000,
    requires: 'perk.brand',
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 12 }],
  },
];

const BY_ID = new Map(FRANCHISE_PERKS.map((p) => [p.id, p]));

export function getPerk(id: string): FranchisePerkDef | null {
  return BY_ID.get(id) ?? null;
}

/** Megvehető-e a perk (van elég csillag és megvan az előfeltétel)? */
export function canBuyPerk(
  perk: FranchisePerkDef,
  stars: number,
  ownedIds: readonly string[],
): { ok: boolean; reason?: string } {
  if (ownedIds.includes(perk.id)) return { ok: false, reason: 'Már megvan' };
  if (perk.requires && !ownedIds.includes(perk.requires)) {
    const req = BY_ID.get(perk.requires);
    return { ok: false, reason: `Előbb: ${req?.name ?? perk.requires}` };
  }
  if (stars < perk.starCost) return { ok: false, reason: `${perk.starCost} csillag kell` };
  return { ok: true };
}
