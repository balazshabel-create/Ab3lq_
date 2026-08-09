import type { AchievementDef } from '@/game/types';

/**
 * ACHIEVEMENTS
 *
 * They survive a franchise (prestige) reset, and each grants a small
 * **permanent, additive** global income bonus. That is what creates the "I
 * never lose anything" feeling, one of the engines behind idle-game retention.
 *
 * Total bonus with all 27 unlocked: +2.04 (i.e. x3.04 global income).
 */

type Seed = Omit<AchievementDef, 'id'> & { id: string };

const SEEDS: readonly Seed[] = [
  // --- Earnings ---
  { id: 'earn-1k', name: 'First Thousand', description: 'Earn $1,000 in total.', metric: 'lifetimeEarnings', threshold: 1e3, coinReward: 10, incomeBonus: 0.02 },
  { id: 'earn-100k', name: 'Regulars', description: 'Earn $100 K in total.', metric: 'lifetimeEarnings', threshold: 1e5, coinReward: 15, incomeBonus: 0.03 },
  { id: 'earn-10m', name: 'Round the Block', description: 'Earn $10 M in total.', metric: 'lifetimeEarnings', threshold: 1e7, coinReward: 20, incomeBonus: 0.04 },
  { id: 'earn-1b', name: 'Local Legend', description: 'Earn $1 B in total.', metric: 'lifetimeEarnings', threshold: 1e9, coinReward: 30, incomeBonus: 0.06 },
  { id: 'earn-1t', name: 'Food Tycoon', description: 'Earn $1 T in total.', metric: 'lifetimeEarnings', threshold: 1e12, coinReward: 45, incomeBonus: 0.08 },
  { id: 'earn-1qa', name: 'Street Food Empire', description: 'Earn $1 Qi in total.', metric: 'lifetimeEarnings', threshold: 1e18, coinReward: 80, incomeBonus: 0.15 },

  // --- Hand service ---
  { id: 'tap-100', name: 'Fresh Hands', description: 'Serve 100 customers by hand.', metric: 'totalTaps', threshold: 100, coinReward: 10, incomeBonus: 0.02 },
  { id: 'tap-1000', name: 'Quick Fingers', description: 'Serve 1,000 customers by hand.', metric: 'totalTaps', threshold: 1_000, coinReward: 15, incomeBonus: 0.03 },
  { id: 'tap-10000', name: 'Counter King', description: 'Serve 10,000 customers by hand.', metric: 'totalTaps', threshold: 10_000, coinReward: 25, incomeBonus: 0.05 },

  // --- Upgrades ---
  { id: 'levels-100', name: 'Building Up', description: 'Buy 100 product levels in total.', metric: 'totalLevelsBought', threshold: 100, coinReward: 10, incomeBonus: 0.02 },
  { id: 'levels-1000', name: 'Full Production', description: 'Buy 1,000 product levels in total.', metric: 'totalLevelsBought', threshold: 1_000, coinReward: 20, incomeBonus: 0.04 },
  { id: 'levels-10000', name: 'Never Enough', description: 'Buy 10,000 product levels in total.', metric: 'totalLevelsBought', threshold: 10_000, coinReward: 35, incomeBonus: 0.07 },

  // --- Managers ---
  { id: 'manager-1', name: 'Delegation', description: 'Hire your first manager.', metric: 'managersHired', threshold: 1, coinReward: 15, incomeBonus: 0.03 },
  { id: 'manager-6', name: 'Full Crew', description: 'Hire 6 managers.', metric: 'managersHired', threshold: 6, coinReward: 25, incomeBonus: 0.05 },
  { id: 'manager-18', name: 'Middle Management', description: 'Hire 18 managers.', metric: 'managersHired', threshold: 18, coinReward: 40, incomeBonus: 0.08 },
  { id: 'manager-36', name: 'Head Office', description: 'Hire 36 managers.', metric: 'managersHired', threshold: 36, coinReward: 60, incomeBonus: 0.12 },

  // --- Cities ---
  { id: 'city-2', name: 'Crossing Borders', description: 'Unlock a second city.', metric: 'citiesUnlocked', threshold: 2, coinReward: 25, incomeBonus: 0.05 },
  { id: 'city-4', name: 'Continent Hopper', description: 'Unlock 4 cities.', metric: 'citiesUnlocked', threshold: 4, coinReward: 50, incomeBonus: 0.1 },
  { id: 'city-6', name: 'World Kitchen', description: 'Unlock all 6 cities.', metric: 'citiesUnlocked', threshold: 6, coinReward: 100, incomeBonus: 0.2 },

  // --- Franchise ---
  { id: 'franchise-1', name: 'Fresh Start', description: 'Franchise your empire once.', metric: 'franchiseCount', threshold: 1, coinReward: 30, incomeBonus: 0.06 },
  { id: 'franchise-5', name: 'Serial Founder', description: 'Franchise 5 times.', metric: 'franchiseCount', threshold: 5, coinReward: 60, incomeBonus: 0.12 },
  { id: 'franchise-25', name: 'Endless Cycle', description: 'Franchise 25 times.', metric: 'franchiseCount', threshold: 25, coinReward: 120, incomeBonus: 0.25 },

  // --- Quests / crates ---
  { id: 'quests-10', name: 'Daily Routine', description: 'Complete 10 daily quests.', metric: 'questsCompleted', threshold: 10, coinReward: 20, incomeBonus: 0.03 },
  { id: 'quests-100', name: 'Persistence', description: 'Complete 100 daily quests.', metric: 'questsCompleted', threshold: 100, coinReward: 60, incomeBonus: 0.1 },
  { id: 'crates-25', name: 'Lucky Hand', description: 'Open 25 crates.', metric: 'cratesOpened', threshold: 25, coinReward: 25, incomeBonus: 0.04 },
  { id: 'crates-200', name: 'Crate Hunter', description: 'Open 200 crates.', metric: 'cratesOpened', threshold: 200, coinReward: 70, incomeBonus: 0.09 },
  { id: 'ads-50', name: 'Supporter', description: 'Watch 50 rewarded videos.', metric: 'adsWatched', threshold: 50, coinReward: 40, incomeBonus: 0.08 },
];

export const ACHIEVEMENTS: readonly AchievementDef[] = SEEDS;

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievement(id: string): AchievementDef | null {
  return BY_ID.get(id) ?? null;
}

/** Sum of every achievement bonus when all are unlocked - for balance checks. */
export function totalAchievementBonus(): number {
  return ACHIEVEMENTS.reduce((sum, a) => sum + a.incomeBonus, 0);
}
