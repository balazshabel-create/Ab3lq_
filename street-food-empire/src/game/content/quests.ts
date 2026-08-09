import type { QuestDef } from '@/game/types';

/**
 * DAILY QUESTS
 *
 * 3 quests a day drawn from the pool, deterministically seeded from the day key
 * (not from a server) - so it works offline, and a reinstall on the same day
 * gives you the same set.
 *
 * For quests with `scaleWithIncome: true` the target follows the player's
 * current income/s, so it is neither trivial late nor impossible early.
 */

export const QUEST_POOL: readonly QuestDef[] = [
  {
    id: 'q.taps',
    text: 'Serve {target} customers by hand',
    metric: 'totalTaps',
    target: 60,
    coinReward: 10,
  },
  {
    id: 'q.taps-big',
    text: 'Serve {target} customers by hand',
    metric: 'totalTaps',
    target: 200,
    coinReward: 14,
  },
  {
    id: 'q.levels',
    text: 'Buy {target} product levels',
    metric: 'totalLevelsBought',
    target: 40,
    coinReward: 10,
  },
  {
    id: 'q.levels-big',
    text: 'Buy {target} product levels',
    metric: 'totalLevelsBought',
    target: 150,
    coinReward: 14,
  },
  {
    id: 'q.earn-short',
    text: 'Earn ${target}',
    metric: 'runEarnings',
    // Target worth about 10 minutes of income
    target: 600,
    scaleWithIncome: true,
    coinReward: 10,
  },
  {
    id: 'q.earn-long',
    text: 'Earn ${target}',
    metric: 'runEarnings',
    // 45 minutes of income
    target: 2_700,
    scaleWithIncome: true,
    coinReward: 15,
  },
  {
    id: 'q.crates',
    text: 'Open {target} crates',
    metric: 'cratesOpened',
    target: 3,
    coinReward: 12,
  },
  {
    id: 'q.ads',
    text: 'Watch {target} rewarded videos',
    metric: 'adsWatched',
    target: 2,
    coinReward: 12,
  },
  {
    id: 'q.managers',
    text: 'Hire {target} managers',
    metric: 'managersHired',
    target: 1,
    coinReward: 15,
  },
  {
    id: 'q.lifetime',
    text: 'Earn ${target} in total',
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

/** How many quests run at the same time. */
export const DAILY_QUEST_COUNT = 3;

/**
 * Turns a day key (`2026-08-09`) into a stable 32-bit number - so the daily
 * quest draw is deterministic, but different every day.
 */
export function dayKeySeed(dayKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < dayKey.length; i += 1) {
    hash ^= dayKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
