import type { QuestDef } from '@/game/types';

/**
 * NAPI KÜLDETÉSEK
 *
 * Naponta 3 küldetés a poolból, determinisztikusan a nap kulcsából sorsolva
 * (nem a szerverről) – így offline is működik, és ugyanazon a napon
 * újratelepítés után is ugyanazt kapod.
 *
 * A `scaleWithIncome: true` küldetéseknél a cél a játékos aktuális
 * bevétel/mp-jéhez igazodik, hogy késői játékban se legyen triviális, korán
 * pedig ne legyen teljesíthetetlen.
 */

export const QUEST_POOL: readonly QuestDef[] = [
  {
    id: 'q.taps',
    text: 'Szolgálj ki {target} vevőt kézzel',
    metric: 'totalTaps',
    target: 60,
    coinReward: 10,
  },
  {
    id: 'q.taps-big',
    text: 'Szolgálj ki {target} vevőt kézzel',
    metric: 'totalTaps',
    target: 200,
    coinReward: 14,
  },
  {
    id: 'q.levels',
    text: 'Vegyél {target} termékszintet',
    metric: 'totalLevelsBought',
    target: 40,
    coinReward: 10,
  },
  {
    id: 'q.levels-big',
    text: 'Vegyél {target} termékszintet',
    metric: 'totalLevelsBought',
    target: 150,
    coinReward: 14,
  },
  {
    id: 'q.earn-short',
    text: 'Keress {target} Ft-ot',
    metric: 'runEarnings',
    // 10 perc bevételének megfelelő cél
    target: 600,
    scaleWithIncome: true,
    coinReward: 10,
  },
  {
    id: 'q.earn-long',
    text: 'Keress {target} Ft-ot',
    metric: 'runEarnings',
    // 45 perc bevétele
    target: 2_700,
    scaleWithIncome: true,
    coinReward: 15,
  },
  {
    id: 'q.crates',
    text: 'Nyiss ki {target} ládát',
    metric: 'cratesOpened',
    target: 3,
    coinReward: 12,
  },
  {
    id: 'q.ads',
    text: 'Nézz meg {target} jutalomvideót',
    metric: 'adsWatched',
    target: 2,
    coinReward: 12,
  },
  {
    id: 'q.managers',
    text: 'Vegyél fel {target} menedzsert',
    metric: 'managersHired',
    target: 1,
    coinReward: 15,
  },
  {
    id: 'q.lifetime',
    text: 'Keress {target} Ft-ot összesen',
    metric: 'lifetimeEarnings',
    target: 1_800,
    scaleWithIncome: true,
    coinReward: 12,
  },
];

const BY_ID = new Map(QUEST_POOL.map((q) => [q.id, q]));

export function getQuest(id: string): QuestDef | null {
  return BY_ID.get(id) ?? null;
}

/** Hány küldetés fut egyszerre. */
export const DAILY_QUEST_COUNT = 3;

/**
 * A nap kulcsából (`2026-08-09`) egy stabil 32 bites szám – így a napi
 * küldetéskiosztás determinisztikus, de naponta más.
 */
export function dayKeySeed(dayKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < dayKey.length; i += 1) {
    hash ^= dayKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
