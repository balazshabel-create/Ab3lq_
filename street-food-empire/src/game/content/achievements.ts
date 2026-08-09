import type { AchievementDef } from '@/game/types';

/**
 * ACHIEVEMENTEK
 *
 * Franchise (presztízs) után is megmaradnak, és mindegyik ad egy kis **tartós,
 * additív** globális bevételbónuszt. Ez adja a "sose vesztek el semmit"
 * érzést, ami az idle játékok visszatérési arányának egyik motorja.
 *
 * Összes bónusz mind a 27 teljesítésével: +2,04 (azaz ×3,04 globális bevétel).
 */

type Seed = Omit<AchievementDef, 'id'> & { id: string };

const SEEDS: readonly Seed[] = [
  // --- Bevétel ---
  { id: 'earn-1k', name: 'Első ezres', description: 'Keress összesen 1 000 Ft-ot.', metric: 'lifetimeEarnings', threshold: 1e3, coinReward: 10, incomeBonus: 0.02 },
  { id: 'earn-100k', name: 'Törzsvendégek', description: 'Keress összesen 100 E Ft-ot.', metric: 'lifetimeEarnings', threshold: 1e5, coinReward: 15, incomeBonus: 0.03 },
  { id: 'earn-10m', name: 'Sorban állnak', description: 'Keress összesen 10 M Ft-ot.', metric: 'lifetimeEarnings', threshold: 1e7, coinReward: 20, incomeBonus: 0.04 },
  { id: 'earn-1b', name: 'Városi legenda', description: 'Keress összesen 1 Mrd Ft-ot.', metric: 'lifetimeEarnings', threshold: 1e9, coinReward: 30, incomeBonus: 0.06 },
  { id: 'earn-1t', name: 'Étteremmágnás', description: 'Keress összesen 1 B Ft-ot.', metric: 'lifetimeEarnings', threshold: 1e12, coinReward: 45, incomeBonus: 0.08 },
  { id: 'earn-1qa', name: 'Gasztrobirodalom', description: 'Keress összesen 1 T Ft-ot.', metric: 'lifetimeEarnings', threshold: 1e18, coinReward: 80, incomeBonus: 0.15 },

  // --- Kézi kiszolgálás ---
  { id: 'tap-100', name: 'Kezdő kezek', description: 'Szolgálj ki 100 vevőt kézzel.', metric: 'totalTaps', threshold: 100, coinReward: 10, incomeBonus: 0.02 },
  { id: 'tap-1000', name: 'Gyors ujjak', description: 'Szolgálj ki 1 000 vevőt kézzel.', metric: 'totalTaps', threshold: 1_000, coinReward: 15, incomeBonus: 0.03 },
  { id: 'tap-10000', name: 'Pultkirály', description: 'Szolgálj ki 10 000 vevőt kézzel.', metric: 'totalTaps', threshold: 10_000, coinReward: 25, incomeBonus: 0.05 },

  // --- Fejlesztés ---
  { id: 'levels-100', name: 'Építkezünk', description: 'Vegyél összesen 100 termékszintet.', metric: 'totalLevelsBought', threshold: 100, coinReward: 10, incomeBonus: 0.02 },
  { id: 'levels-1000', name: 'Nagyüzem', description: 'Vegyél összesen 1 000 termékszintet.', metric: 'totalLevelsBought', threshold: 1_000, coinReward: 20, incomeBonus: 0.04 },
  { id: 'levels-10000', name: 'Sosem elég', description: 'Vegyél összesen 10 000 termékszintet.', metric: 'totalLevelsBought', threshold: 10_000, coinReward: 35, incomeBonus: 0.07 },

  // --- Menedzserek ---
  { id: 'manager-1', name: 'Delegálás', description: 'Vegyél fel az első menedzsert.', metric: 'managersHired', threshold: 1, coinReward: 15, incomeBonus: 0.03 },
  { id: 'manager-6', name: 'Teljes stáb', description: 'Vegyél fel 6 menedzsert.', metric: 'managersHired', threshold: 6, coinReward: 25, incomeBonus: 0.05 },
  { id: 'manager-18', name: 'Középvezetés', description: 'Vegyél fel 18 menedzsert.', metric: 'managersHired', threshold: 18, coinReward: 40, incomeBonus: 0.08 },
  { id: 'manager-36', name: 'Vezérkar', description: 'Vegyél fel 36 menedzsert.', metric: 'managersHired', threshold: 36, coinReward: 60, incomeBonus: 0.12 },

  // --- Városok ---
  { id: 'city-2', name: 'Határátlépés', description: 'Nyiss meg egy második várost.', metric: 'citiesUnlocked', threshold: 2, coinReward: 25, incomeBonus: 0.05 },
  { id: 'city-4', name: 'Kontinensjáró', description: 'Nyiss meg 4 várost.', metric: 'citiesUnlocked', threshold: 4, coinReward: 50, incomeBonus: 0.1 },
  { id: 'city-6', name: 'Világkonyha', description: 'Nyiss meg mind a 6 várost.', metric: 'citiesUnlocked', threshold: 6, coinReward: 100, incomeBonus: 0.2 },

  // --- Franchise ---
  { id: 'franchise-1', name: 'Újrakezdés', description: 'Franchise-old a birodalmadat egyszer.', metric: 'franchiseCount', threshold: 1, coinReward: 30, incomeBonus: 0.06 },
  { id: 'franchise-5', name: 'Sorozatalapító', description: 'Franchise-olj 5-ször.', metric: 'franchiseCount', threshold: 5, coinReward: 60, incomeBonus: 0.12 },
  { id: 'franchise-25', name: 'Örök körforgás', description: 'Franchise-olj 25-ször.', metric: 'franchiseCount', threshold: 25, coinReward: 120, incomeBonus: 0.25 },

  // --- Küldetés / láda ---
  { id: 'quests-10', name: 'Napi rutin', description: 'Teljesíts 10 napi küldetést.', metric: 'questsCompleted', threshold: 10, coinReward: 20, incomeBonus: 0.03 },
  { id: 'quests-100', name: 'Kitartás', description: 'Teljesíts 100 napi küldetést.', metric: 'questsCompleted', threshold: 100, coinReward: 60, incomeBonus: 0.1 },
  { id: 'crates-25', name: 'Szerencsés kéz', description: 'Nyiss ki 25 ládát.', metric: 'cratesOpened', threshold: 25, coinReward: 25, incomeBonus: 0.04 },
  { id: 'crates-200', name: 'Ládavadász', description: 'Nyiss ki 200 ládát.', metric: 'cratesOpened', threshold: 200, coinReward: 70, incomeBonus: 0.09 },
  { id: 'ads-50', name: 'Támogató', description: 'Nézz meg 50 jutalomvideót.', metric: 'adsWatched', threshold: 50, coinReward: 40, incomeBonus: 0.08 },
];

export const ACHIEVEMENTS: readonly AchievementDef[] = SEEDS;

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievement(id: string): AchievementDef | null {
  return BY_ID.get(id) ?? null;
}

/** Az összes achievement bónuszának összege, ha mind megvan – balance-ellenőrzéshez. */
export function totalAchievementBonus(): number {
  return ACHIEVEMENTS.reduce((sum, a) => sum + a.incomeBonus, 0);
}
