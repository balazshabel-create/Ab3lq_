import type { StaffDef } from '@/game/types';

/**
 * SZEMÉLYZET
 *
 * Két külön dolog:
 *  1. **Menedzser** – termékenként egyszeri vásárlás, ő automatizálja az adott
 *     terméket (lásd products.ts `managerCost`). Ez a legfontosabb vásárlás a
 *     játékban, mert az offline bevétel csak automatizált termékekre jár.
 *  2. **Szerepkörök** (itt) – szintezhető alkalmazottak, akik globális
 *     bónuszt adnak.
 *
 * FONTOS SZEMANTIKA: `effectPerLevel.value` **additív** töredék szintenként.
 * A teljes hatás: 1 + value * szint. (Nem hatvány!) Így 50 szint séf
 * = 1 + 0,03*50 = ×2,5, ami kiszámítható és nem szalad el.
 *
 * Nincs bérköltség / fenntartás: az idle játékban a negatív cashflow
 * frusztráló, és a "kilépek, elfogy a pénzem" élmény ellentétes a műfajjal.
 */

export const STAFF: readonly StaffDef[] = [
  {
    id: 'chef',
    role: 'chef',
    name: 'Séf',
    icon: 'chef',
    description: 'Minden termék bevételét növeli.',
    baseCost: 4_000,
    costGrowth: 1.18,
    maxLevel: 50,
    effectPerLevel: { type: 'incomeMultiplier', scope: { kind: 'global' }, value: 0.03 },
  },
  {
    id: 'courier',
    role: 'courier',
    name: 'Futár',
    icon: 'scooter',
    description: 'Több bevétel, amíg zárva vagy (offline arány).',
    baseCost: 30_000,
    costGrowth: 1.24,
    maxLevel: 25,
    effectPerLevel: { type: 'offlineRate', value: 0.02 },
  },
  {
    id: 'cashier',
    role: 'cashier',
    name: 'Pénztáros',
    icon: 'cashier',
    description: 'Erősebb kézi kiszolgálás (koppintás).',
    baseCost: 2_000,
    costGrowth: 1.2,
    maxLevel: 40,
    // Additív: 40. szinten ×1,8. Szándékosan szerény – lásd a
    // koppintás-korlátot az equipment.ts `counter` gépénél.
    effectPerLevel: { type: 'tapMultiplier', value: 0.02 },
  },
  {
    id: 'marketer',
    role: 'marketer',
    name: 'Marketinges',
    icon: 'megaphone',
    description: 'Nagyobb esély Food Coinra ládákból és küldetésekből.',
    baseCost: 250_000,
    costGrowth: 1.3,
    maxLevel: 20,
    effectPerLevel: { type: 'coinFind', value: 0.05 },
  },
];

const STAFF_BY_ID = new Map(STAFF.map((s) => [s.id, s]));

export function getStaff(id: string): StaffDef {
  const staff = STAFF_BY_ID.get(id);
  if (!staff) throw new Error(`Ismeretlen alkalmazott: ${id}`);
  return staff;
}

/** A következő szint ára: baseCost * costGrowth^level */
export function staffLevelCost(def: StaffDef, currentLevel: number): number {
  return Math.ceil(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

/** A szerepkör teljes hatásértéke az adott szinten (additív modell). */
export function staffEffectValue(def: StaffDef, level: number): number {
  return def.effectPerLevel.value * level;
}
