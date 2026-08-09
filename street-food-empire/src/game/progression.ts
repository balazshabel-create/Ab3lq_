import { GAME_CONFIG } from '@/config/gameConfig';
import { localDayKey } from '@/core/clock';
import { createRng } from '@/core/rng';
import { ACHIEVEMENTS } from '@/game/content/achievements';
import { DAILY_QUEST_COUNT, QUEST_POOL, dayKeySeed, getQuest } from '@/game/content/quests';
import { computeMultipliers, totalIncomePerSecond } from '@/game/selectors';
import type { AchievementDef, GameState, QuestState, StatMetric } from '@/game/types';

/**
 * NAPI KÜLDETÉSEK ÉS ACHIEVEMENTEK
 *
 * A napi küldetés kiosztása determinisztikus: a nap kulcsából (`2026-08-09`)
 * származó seed választja a poolból. Így nincs szükség szerverre, és a
 * játékos nem tudja "újrapörgetni" a küldetéseket az app újraindításával.
 */

// ---------------------------------------------------------------------------
// Napi küldetések
// ---------------------------------------------------------------------------

function metricValue(state: GameState, metric: StatMetric): number {
  return state.stats[metric] ?? 0;
}

/**
 * Létrehozza az adott nap küldetéseit. A `scaleWithIncome` küldetések célja a
 * játékos aktuális bevétel/mp-jéhez skálázódik (a `target` mp-ben értendő).
 */
export function rollDailyQuests(state: GameState, wallMs: number): QuestState[] {
  const dayKey = localDayKey(wallMs);
  const rng = createRng(dayKeySeed(dayKey));

  const multipliers = computeMultipliers(state, wallMs);
  const incomePerSecond = Math.max(1, totalIncomePerSecond(state, multipliers));

  // Ismétlés nélküli választás a poolból.
  const pool = [...QUEST_POOL];
  const picked: QuestState[] = [];

  for (let i = 0; i < DAILY_QUEST_COUNT && pool.length > 0; i += 1) {
    const index = rng.int(0, pool.length - 1);
    const def = pool.splice(index, 1)[0];
    if (!def) continue;

    const target = def.scaleWithIncome
      ? Math.max(100, Math.round(incomePerSecond * def.target))
      : def.target;

    picked.push({
      questId: def.id,
      baseline: metricValue(state, def.metric),
      target,
      claimed: false,
    });
  }

  return picked;
}

/** Új nap esetén frissíti a napi állapotot. Igazzal tér vissza, ha váltott. */
export function refreshDailyIfNeeded(state: GameState, wallMs: number): boolean {
  const today = localDayKey(wallMs);
  if (state.daily.dayKey === today && state.daily.quests.length > 0) return false;

  state.daily = {
    dayKey: today,
    quests: rollDailyQuests(state, wallMs),
    allClaimedBonusTaken: false,
    interstitialsShown: 0,
    rewardedByPlacement: {},
    cratesOpened: 0,
  };
  return true;
}

export type QuestProgress = {
  quest: QuestState;
  text: string;
  current: number;
  target: number;
  complete: boolean;
  claimed: boolean;
  coinReward: number;
};

export function questProgress(state: GameState, quest: QuestState): QuestProgress | null {
  const def = getQuest(quest.questId);
  if (!def) return null;

  const current = Math.max(0, metricValue(state, def.metric) - quest.baseline);
  return {
    quest,
    text: def.text.replace('{target}', formatTarget(quest.target)),
    current: Math.min(current, quest.target),
    target: quest.target,
    complete: current >= quest.target,
    claimed: quest.claimed,
    coinReward: def.coinReward,
  };
}

function formatTarget(target: number): string {
  if (target < 1000) return target.toString();
  // A küldetésszöveg rövid formátumot használ (pl. „1,2 M”).
  const tiers = ['', ' E', ' M', ' Mrd', ' B'];
  const tier = Math.min(tiers.length - 1, Math.floor(Math.log10(target) / 3));
  const scaled = target / Math.pow(1000, tier);
  return `${(Math.round(scaled * 10) / 10).toString().replace('.', ',')}${tiers[tier] ?? ''}`;
}

export function allQuestsClaimed(state: GameState): boolean {
  return state.daily.quests.length > 0 && state.daily.quests.every((q) => q.claimed);
}

// ---------------------------------------------------------------------------
// Achievementek
// ---------------------------------------------------------------------------

/**
 * Megnézi, teljesült-e új achievement. A jutalmat a hívó írja jóvá
 * (`actions.ts`), hogy egy helyen legyen az érme-könyvelés.
 */
export function findNewlyUnlockedAchievements(state: GameState): AchievementDef[] {
  const unlocked: AchievementDef[] = [];
  for (const def of ACHIEVEMENTS) {
    if (state.unlockedAchievementIds.includes(def.id)) continue;
    if (metricValue(state, def.metric) >= def.threshold) unlocked.push(def);
  }
  return unlocked;
}

// ---------------------------------------------------------------------------
// Ládák
// ---------------------------------------------------------------------------

export type CrateReward =
  | { kind: 'coins'; amount: number }
  | { kind: 'cash'; amount: number; seconds: number }
  | { kind: 'booster'; booster: 'doubleIncome' | 'turbo' };

/**
 * Láda tartalmának sorsolása. A seed a mentett `rngState`-ből jön, így a
 * jutalom nem "pörgethető újra" az app bezárásával.
 */
export function rollCrate(state: GameState, wallMs: number): CrateReward {
  const rng = createRng(state.rngState);
  const multipliers = computeMultipliers(state, wallMs);
  const income = totalIncomePerSecond(state, multipliers);

  const roll = rng.next();
  const reward: CrateReward = (() => {
    if (roll < 0.45) {
      const [min, max] = GAME_CONFIG.coins.crateRange;
      return { kind: 'coins', amount: rng.int(min, max) } as const;
    }
    if (roll < 0.85) {
      // 5–25 perc bevétele; ha még alig van bevétel, egy kis fix összeg.
      const seconds = rng.int(300, 1500);
      const amount = Math.max(50, income * seconds);
      return { kind: 'cash', amount, seconds } as const;
    }
    return { kind: 'booster', booster: rng.chance(0.5) ? 'doubleIncome' : 'turbo' } as const;
  })();

  // Az RNG állapotát mindig továbbléptetjük.
  state.rngState = rng.state();
  return reward;
}
