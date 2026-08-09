import { GAME_CONFIG } from '@/config/gameConfig';
import { computeElapsed, type ClockReading } from '@/core/clock';
import { creditEarnings } from '@/game/simulate';
import { computeMultipliers, totalIncomePerSecond } from '@/game/selectors';
import type { GameState } from '@/game/types';

/**
 * OFFLINE BEVÉTEL
 *
 * Szabályok (docs/GAME_DESIGN.md „Offline progress”):
 *  - Csak **menedzserrel ellátott** termékek termelnek. Ez teszi a menedzsert
 *    a játék legfontosabb vásárlásává, és ad okot visszatérni.
 *  - Az online bevétel `offlineRate` hányada jár (alap: 50%).
 *  - Legfeljebb `offlineCapHours` óráig halmozódik (alap: 4 óra, raktárral,
 *    futárral és perkkel max 24-ig nő).
 *  - Reklámmal vagy Food Coinnal megduplázható – **utólag**, a visszatérési
 *    ablakban, tehát a játékos maga dönt, nem kényszerítjük rá.
 *
 * Az óracsalás elleni védelmet a core/clock.ts computeElapsed adja.
 */

export type OfflineReport = {
  /** Ténylegesen eltelt idő másodpercben (sapka előtt). */
  elapsedSeconds: number;
  /** A sapka után figyelembe vett idő. */
  creditedSeconds: number;
  /** A jóváírható alapösszeg (szorzó nélkül). */
  baseEarnings: number;
  /** Elérte-e a sapkát – ilyenkor a UI felajánlja a raktárfejlesztést. */
  cappedOut: boolean;
  /** Az aktuális sapka órában. */
  capHours: number;
  /** Visszaállították-e az órát (ilyenkor 0 bevétel). */
  clockRolledBack: boolean;
  /** A bevétel/mp, amivel számoltunk. */
  incomePerSecond: number;
};

/**
 * Kiszámolja az offline bevételt, de **nem írja jóvá**.
 * A jóváírás külön lépés (`applyOfflineEarnings`), mert a játékos a
 * visszatérési ablakban dönthet a ×2-es reklámról.
 */
export function computeOfflineReport(state: GameState, now: ClockReading): OfflineReport {
  const elapsed = computeElapsed(state.lastSeenWallClock, state.maxSeenWallClock, now);
  const multipliers = computeMultipliers(state, now.wall);

  const capHours = multipliers.offlineCapHours;
  const capSeconds = capHours * 3600;
  const creditedSeconds = Math.min(elapsed.seconds, capSeconds);

  const incomePerSecond = totalIncomePerSecond(state, multipliers);
  const baseEarnings = incomePerSecond * multipliers.offlineRate * creditedSeconds;

  return {
    elapsedSeconds: elapsed.seconds,
    creditedSeconds,
    baseEarnings,
    cappedOut: elapsed.seconds > capSeconds,
    capHours,
    clockRolledBack: elapsed.clockRolledBack,
    incomePerSecond,
  };
}

/**
 * Jóváírja az offline bevételt és frissíti az óra-metaadatokat.
 * A `multiplier` a reklámos / Food Coinos szorzó (alapból 1).
 */
export function applyOfflineEarnings(
  state: GameState,
  report: OfflineReport,
  now: ClockReading,
  multiplier = 1,
): number {
  const elapsed = computeElapsed(state.lastSeenWallClock, state.maxSeenWallClock, now);

  state.lastSeenWallClock = now.wall;
  state.maxSeenWallClock = elapsed.nextMaxSeenWall;

  const payout = report.baseEarnings * multiplier;
  if (payout > 0) {
    creditEarnings(state, payout);
    // Az offline bevételt az aktív városra könyveljük, hogy a termékfeloldás
    // offline után is helyesen működjön.
    state.cityEarnings[state.activeCityId] =
      (state.cityEarnings[state.activeCityId] ?? 0) + payout;
  }
  return payout;
}

/**
 * „Időugrás”: X óra offline bevételének azonnali megvásárlása Food Coinért.
 * Ugyanazt a képletet használja, mint a valódi offline számítás, hogy a
 * játékos ne érezhesse becsapásnak.
 */
export function timeSkipEarnings(state: GameState, hours: number, wallMs: number): number {
  const multipliers = computeMultipliers(state, wallMs);
  const seconds = Math.min(hours, GAME_CONFIG.coins.timeSkipMaxHours) * 3600;
  return totalIncomePerSecond(state, multipliers) * multipliers.offlineRate * seconds;
}

/** Megjelenítsük-e a visszatérési ablakot? */
export function shouldShowOfflineModal(report: OfflineReport): boolean {
  return (
    !report.clockRolledBack &&
    report.elapsedSeconds >= GAME_CONFIG.offline.minSecondsToShowModal &&
    report.baseEarnings > 0
  );
}
