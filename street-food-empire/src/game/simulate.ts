import { GAME_CONFIG } from '@/config/gameConfig';
import { productsOfCity } from '@/game/content/products';
import { cycleSeconds, revenuePerCycle } from '@/game/economy';
import type { GameState, Multipliers, ProductDef, ProductState } from '@/game/types';

/**
 * A SZIMULÁCIÓS TICK
 *
 * Teljesítménykritikus kód: másodpercenként `tickHz`-szer fut, minden
 * feloldott város minden termékére. Ezért:
 *  - **helyben módosít** (nem allokál új objektumokat termékenként),
 *  - a befejezett ciklusokat **osztással** számolja, nem ciklussal
 *    (késői játékban egy tick alatt több ezer ciklus is lefuthat),
 *  - a nagyon rövid ciklusú termékeknél átvált folyamatos módra, így
 *    a haladássáv-animáció és a modulo-számítás is elmarad.
 *
 * A `state` objektumot szándékosan mutálja: a store hívja, és ő gondoskodik
 * az új referenciáról a React felé (lásd game/store.ts).
 */

export type TickResult = {
  /** Ebben a tickben megtermelt pénz. */
  earned: number;
  /** Befejezett ciklusok száma (statisztikához, animációhoz). */
  cyclesCompleted: number;
};

/**
 * Egyetlen termék léptetése. Módosítja a `productState`-et.
 *
 * Csak **automatizált** (menedzserrel ellátott) termék termel magától. A
 * menedzser nélküli termék kizárólag kézi kiszolgálással hoz pénzt, és ott is
 * legfeljebb ciklusidőnként egyszer (lásd `serveByHand`). Ez teszi a
 * menedzsert a játék legfontosabb vásárlásává, és ez zárja ki, hogy a gyors
 * koppintgatás megkerülje a gazdaságot.
 */
function advanceProduct(
  def: ProductDef,
  productState: ProductState,
  dt: number,
  multipliers: Multipliers,
): TickResult {
  const level = productState.level;
  if (level <= 0) return EMPTY_TICK;
  if (!productState.hasManager) return EMPTY_TICK;

  const seconds = cycleSeconds(def, level, multipliers.productCycle[def.id] ?? 1);
  const revenue = revenuePerCycle(
    def,
    level,
    multipliers.productIncome[def.id] ?? 1,
    multipliers.globalIncome,
  );

  // --- Folyamatos mód: nagyon rövid ciklusnál nincs értelme animálni ---
  if (seconds < GAME_CONFIG.milestones.continuousBelowSeconds) {
    productState.progress = 0;
    return { earned: (revenue / seconds) * dt, cyclesCompleted: 0 };
  }

  const progress = productState.progress + dt / seconds;

  if (progress < 1) {
    productState.progress = progress;
    return EMPTY_TICK;
  }

  const completed = Math.floor(progress);
  // A maradék átcsordul a következő ciklusba, így nem veszik el idő.
  productState.progress = progress - completed;

  return { earned: revenue * completed, cyclesCompleted: completed };
}

const EMPTY_TICK: TickResult = { earned: 0, cyclesCompleted: 0 };

/**
 * A teljes birodalom léptetése `dt` másodperccel.
 * A `dt`-t a hívó korlátozza (`maxTickSeconds`), hogy egy hosszú JS-blokkolás
 * után se legyen egyetlen óriási ugrás.
 */
export function simulateTick(
  state: GameState,
  dt: number,
  multipliers: Multipliers,
): TickResult {
  if (dt <= 0) return EMPTY_TICK;

  let earned = 0;
  let cyclesCompleted = 0;

  for (const cityId of state.unlockedCityIds) {
    for (const def of productsOfCity(cityId)) {
      const productState = state.products[def.id];
      if (!productState) continue;
      const result = advanceProduct(def, productState, dt, multipliers);
      if (result.earned > 0) {
        earned += result.earned;
        cyclesCompleted += result.cyclesCompleted;
        state.cityEarnings[cityId] = (state.cityEarnings[cityId] ?? 0) + result.earned;
      }
    }
  }

  if (earned > 0) creditEarnings(state, earned);

  return { earned, cyclesCompleted };
}

/**
 * Bevétel jóváírása MINDEN statisztikával együtt.
 *
 * Egyetlen helyen történik, hogy a `lifetimeEarnings` / `runEarnings` /
 * `cash` soha ne csússzon szét — ez a leggyakoribb hibaforrás idle
 * játékokban, és utólag nagyon nehéz visszafejteni.
 */
export function creditEarnings(state: GameState, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  state.cash += amount;
  state.stats.lifetimeEarnings += amount;
  state.stats.runEarnings += amount;
  state.runEarnings += amount;
}

/**
 * KÉZI KISZOLGÁLÁS
 *
 * Egy koppintás egy teljes ciklust ad el – de a termék ezután **egy teljes
 * ciklusidőn át nem szolgálható ki újra**. Ebből következik a rendszer
 * legfontosabb korlátja:
 *
 *     kézi bevétel ≤ automatizált bevétel × tapMultiplier
 *
 * Vagyis a koppintgatás sosem tudja megkerülni a gazdaságot: legfeljebb
 * annyiszorosát hozza az automatizálásnak, amennyi a koppintás-szorzó (ez
 * a teljesen kifejlesztett pulttal és pénztárossal is 7× alatt marad).
 *
 * Menedzserrel ellátott termék a koppintást figyelmen kívül hagyja: az már
 * magától, folyamatosan termel — nincs mit gyorsítani rajta.
 *
 * @returns a kifizetett összeg, vagy 0 ha most nem lehetett kiszolgálni
 */
export function serveByHand(
  state: GameState,
  multipliers: Multipliers,
  def: ProductDef,
  wallMs: number,
): number {
  const productState = state.products[def.id];
  if (!productState || productState.level <= 0) return 0;
  if (productState.hasManager) return 0;
  if (wallMs < productState.nextServeAt) return 0;

  const revenue = revenuePerCycle(
    def,
    productState.level,
    multipliers.productIncome[def.id] ?? 1,
    multipliers.globalIncome,
  );
  const payout = revenue * multipliers.tapMultiplier;

  const seconds = cycleSeconds(def, productState.level, multipliers.productCycle[def.id] ?? 1);
  productState.nextServeAt = wallMs + seconds * 1000;
  productState.progress = 0;

  creditEarnings(state, payout);
  state.cityEarnings[def.cityId] = (state.cityEarnings[def.cityId] ?? 0) + payout;
  state.stats.totalTaps += 1;

  return payout;
}

/** Kiszolgálható-e most kézzel? A UI ezzel tiltja a koppintást. */
export function canServeByHand(
  state: GameState,
  def: ProductDef,
  wallMs: number,
): boolean {
  const productState = state.products[def.id];
  if (!productState || productState.level <= 0) return false;
  if (productState.hasManager) return false;
  return wallMs >= productState.nextServeAt;
}
