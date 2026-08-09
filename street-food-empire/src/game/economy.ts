import { GAME_CONFIG } from '@/config/gameConfig';
import type { BuyQuantity, ProductDef } from '@/game/types';

/**
 * A GAZDASÁG MATEMATIKÁJA
 *
 * Minden itt lévő függvény **tiszta**: nincs mellékhatása, ugyanarra a
 * bemenetre mindig ugyanazt adja. Ez teszi tesztelhetővé és teszi lehetővé,
 * hogy az offline számítás pontosan ugyanezt a kódot használja, mint az
 * online tick.
 */

// ---------------------------------------------------------------------------
// Árgörbék
// ---------------------------------------------------------------------------

/** A `level` -> `level+1` lépés ára. (level = már megvett szintek száma) */
export function levelCost(def: ProductDef, level: number): number {
  return def.baseCost * Math.pow(def.costGrowth, level);
}

/**
 * `count` darab szint ára `fromLevel`-től – mértani sor zárt alakban.
 *   C0*r^f * (r^n - 1) / (r - 1)
 * Zárt alak kell, mert a "Max" gomb késői játékban tízezer szintet vesz, és
 * ciklussal ez a UI-t megakasztaná.
 */
export function bulkCost(def: ProductDef, fromLevel: number, count: number): number {
  if (count <= 0) return 0;
  const r = def.costGrowth;
  const first = def.baseCost * Math.pow(r, fromLevel);
  if (r === 1) return first * count;
  return (first * (Math.pow(r, count) - 1)) / (r - 1);
}

/**
 * Hány szintet lehet megvenni `cash`-ből – szintén zárt alakban.
 *   n = floor( log( cash*(r-1)/(C0*r^f) + 1 ) / log r )
 */
export function maxAffordableLevels(
  def: ProductDef,
  fromLevel: number,
  cash: number,
): number {
  if (cash <= 0) return 0;
  const r = def.costGrowth;
  const first = def.baseCost * Math.pow(r, fromLevel);
  if (first <= 0) return 0;
  if (cash < first) return 0;

  if (r === 1) return Math.floor(cash / first);

  const raw = Math.log((cash * (r - 1)) / first + 1) / Math.log(r);
  // A lebegőpontos hiba miatt lefelé kerekítünk, majd egy lépést korrigálunk.
  let n = Math.floor(raw);
  if (n < 0) n = 0;
  while (n > 0 && bulkCost(def, fromLevel, n) > cash) n -= 1;
  while (bulkCost(def, fromLevel, n + 1) <= cash) n += 1;

  return Math.min(n, GAME_CONFIG.purchase.hardBuyCap);
}

/** A kiválasztott vásárlási mennyiséghez tartozó darabszám és ár. */
export function resolveBuy(
  def: ProductDef,
  level: number,
  cash: number,
  quantity: BuyQuantity,
): { amount: number; cost: number } {
  if (quantity === 'max') {
    const budget = cash * (1 - GAME_CONFIG.purchase.maxBuyReserveFraction);
    const amount = maxAffordableLevels(def, level, budget);
    return { amount, cost: bulkCost(def, level, amount) };
  }
  const amount = quantity;
  return { amount, cost: bulkCost(def, level, amount) };
}

// ---------------------------------------------------------------------------
// Mérföldkövek
// ---------------------------------------------------------------------------

export type MilestoneEffect = {
  /** Szorzó a termék bevételére. */
  income: number;
  /** Szorzó a ciklusidőre (kisebb = gyorsabb). */
  cycle: number;
};

/**
 * Egy adott szinten elért összes mérföldkő eredője.
 *
 * A számítás zárt alakú (nem iterál szintenként), mert késői játékban a szint
 * több ezer is lehet, és ez a függvény minden ticknél, minden termékre lefut.
 */
export function milestoneEffect(level: number): MilestoneEffect {
  let income = 1;
  let cycle = 1;

  for (const milestone of GAME_CONFIG.milestones.fixed) {
    if (level < milestone.level) break; // a lista szint szerint rendezett
    if ('income' in milestone && milestone.income) income *= milestone.income;
    if ('speed' in milestone && milestone.speed) cycle *= milestone.speed;
  }

  const { repeatFrom, repeatEvery, repeatIncome } = GAME_CONFIG.milestones;
  if (level > repeatFrom) {
    const repeats = Math.floor((level - repeatFrom) / repeatEvery);
    if (repeats > 0) income *= Math.pow(repeatIncome, repeats);
  }

  return { income, cycle };
}

/** A következő mérföldkő szintje és rövid címkéje – a UI motivációhoz. */
export function nextMilestone(level: number): { level: number; label: string } | null {
  for (const milestone of GAME_CONFIG.milestones.fixed) {
    if (level < milestone.level) {
      const label =
        'income' in milestone && milestone.income
          ? `×${milestone.income} bevétel`
          : 'kétszer gyorsabb';
      return { level: milestone.level, label };
    }
  }

  const { repeatFrom, repeatEvery, repeatIncome } = GAME_CONFIG.milestones;
  const base = Math.max(level, repeatFrom);
  const next = Math.floor(base / repeatEvery) * repeatEvery + repeatEvery;
  return { level: next, label: `×${repeatIncome} bevétel` };
}

// ---------------------------------------------------------------------------
// Termék teljesítménye
// ---------------------------------------------------------------------------

/** Egy ciklus bevétele az összes szorzóval. */
export function revenuePerCycle(
  def: ProductDef,
  level: number,
  productMultiplier: number,
  globalMultiplier: number,
): number {
  if (level <= 0) return 0;
  const milestone = milestoneEffect(level);
  return def.baseRevenue * level * milestone.income * productMultiplier * globalMultiplier;
}

/** Egy ciklus tényleges hossza másodpercben. */
export function cycleSeconds(
  def: ProductDef,
  level: number,
  cycleMultiplier: number,
): number {
  const milestone = milestoneEffect(level);
  const raw = def.baseCycleSeconds * milestone.cycle * cycleMultiplier;
  return Math.max(GAME_CONFIG.milestones.minCycleSeconds, raw);
}

/** Bevétel másodpercenként, ha a termék folyamatosan termel. */
export function incomePerSecond(
  def: ProductDef,
  level: number,
  productMultiplier: number,
  globalMultiplier: number,
  cycleMultiplier: number,
): number {
  if (level <= 0) return 0;
  const revenue = revenuePerCycle(def, level, productMultiplier, globalMultiplier);
  return revenue / cycleSeconds(def, level, cycleMultiplier);
}

// ---------------------------------------------------------------------------
// Franchise
// ---------------------------------------------------------------------------

/** Az adott futásért járó Arany Merőkanál. */
export function starsForRun(runEarnings: number): number {
  const { starDivisor, starExponent, minLifetimeToUnlock } = GAME_CONFIG.franchise;
  if (runEarnings < minLifetimeToUnlock) return 0;
  return Math.floor(Math.pow(runEarnings / starDivisor, starExponent));
}

/**
 * Mennyi pénzt kell még keresni a következő csillagig?
 * A `starsForRun` inverze: earnings = (csillag)^(1/exponent) * divisor.
 */
export function earningsForNextStar(runEarnings: number): number {
  const { starDivisor, starExponent, minLifetimeToUnlock } = GAME_CONFIG.franchise;
  const current = starsForRun(runEarnings);
  const target = Math.max(
    minLifetimeToUnlock,
    Math.pow(current + 1, 1 / starExponent) * starDivisor,
  );
  return Math.max(0, target - runEarnings);
}
