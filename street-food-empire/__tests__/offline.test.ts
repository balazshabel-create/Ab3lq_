import { GAME_CONFIG } from '@/config/gameConfig';
import { computeElapsed, createTestClock } from '@/core/clock';
import { productsOfCity } from '@/game/content/products';
import { createInitialState } from '@/game/initialState';
import {
  applyOfflineEarnings,
  computeOfflineReport,
  shouldShowOfflineModal,
  timeSkipEarnings,
} from '@/game/offline';
import { computeMultipliers, totalIncomePerSecond } from '@/game/selectors';
import type { GameState } from '@/game/types';

const HOUR = 3600 * 1000;

/**
 * 2026. március 2., hétfő 00:00 UTC — szándékosan olyan pillanat, amelyben
 * EGYETLEN időszakos esemény sem aktív (nem szerda/hétvége, és nem a hónap
 * 1., 10. vagy 25. napja).
 *
 * Minden teszt EBBEN a pillanatban olvassa ki a jelentést, és a távollét
 * hosszát a *múltba* tolt `lastSeenWallClock` adja. Így a szorzók minden
 * mérésnél azonosak, és a tesztek nem attól függenek, milyen napra esik a
 * „most + 48 óra”.
 */
const NOW = { wall: 1_772_409_600_000, mono: 0 };

/** Egy játékos, akinek van menedzsere – tehát termel offline is. */
function playerWithAutomation(): GameState {
  const state = createInitialState(NOW.wall);

  const products = productsOfCity(state.activeCityId);
  for (const def of products.slice(0, 3)) {
    const productState = state.products[def.id]!;
    productState.level = 25;
    productState.hasManager = true;
  }
  return state;
}

/** Beállítja, hogy a játékos `hours` órája nem járt a játékban. */
function absentFor(state: GameState, hours: number): GameState {
  state.lastSeenWallClock = NOW.wall - hours * HOUR;
  state.maxSeenWallClock = state.lastSeenWallClock;
  return state;
}

describe('óracsalás-védelem', () => {
  it('előre haladó óránál a különbséget adja', () => {
    const result = computeElapsed(1000, 1000, { wall: 61_000, mono: 0 });
    expect(result.seconds).toBe(60);
    expect(result.clockRolledBack).toBe(false);
    expect(result.nextMaxSeenWall).toBe(61_000);
  });

  it('visszaállított óránál nulla másodpercet ad', () => {
    const result = computeElapsed(100_000, 100_000, { wall: 50_000, mono: 0 });
    expect(result.seconds).toBe(0);
    expect(result.clockRolledBack).toBe(true);
    // A magas vízszint nem csökkenhet.
    expect(result.nextMaxSeenWall).toBe(100_000);
  });

  it('a magas vízszint megvédi a visszaállítás utáni "ingyen időt"', () => {
    // A játékos visszaállítja az órát, majd újra előre – a köztes idő nem
    // számolható el kétszer.
    const maxSeen = 200_000;
    const result = computeElapsed(150_000, maxSeen, { wall: 210_000, mono: 0 });
    expect(result.seconds).toBe(10);
  });
});

describe('offline bevétel', () => {
  it('menedzser nélkül nincs offline bevétel', () => {
    const state = absentFor(createInitialState(NOW.wall), 4);
    expect(computeOfflineReport(state, NOW).baseEarnings).toBe(0);
  });

  it('a bevétel az online arány beállított hányada', () => {
    const hours = 2;
    const state = absentFor(playerWithAutomation(), hours);
    const report = computeOfflineReport(state, NOW);

    const multipliers = computeMultipliers(state, NOW.wall);
    // A bázispillanatban semmilyen esemény nem emeli az arányt.
    expect(multipliers.offlineRate).toBeCloseTo(GAME_CONFIG.offline.baseRate);

    const expected =
      totalIncomePerSecond(state, multipliers) * multipliers.offlineRate * hours * 3600;

    expect(report.baseEarnings).toBeCloseTo(expected, 2);
  });

  it('a sapkán túl nem halmozódik', () => {
    const long = computeOfflineReport(absentFor(playerWithAutomation(), 48), NOW);
    const atCap = computeOfflineReport(
      absentFor(playerWithAutomation(), GAME_CONFIG.offline.baseCapHours),
      NOW,
    );

    expect(long.cappedOut).toBe(true);
    expect(long.capHours).toBeCloseTo(GAME_CONFIG.offline.baseCapHours);
    expect(long.creditedSeconds).toBeCloseTo(long.capHours * 3600);
    // 48 óra távollét pontosan annyit ér, mint a sapkányi távollét.
    expect(long.baseEarnings).toBeCloseTo(atCap.baseEarnings, 2);
  });

  it('a bevétel a sapkáig lineáris a távollét hosszával', () => {
    const oneHour = computeOfflineReport(absentFor(playerWithAutomation(), 1), NOW);
    const twoHours = computeOfflineReport(absentFor(playerWithAutomation(), 2), NOW);
    expect(twoHours.baseEarnings).toBeCloseTo(oneHour.baseEarnings * 2, 2);
  });

  it('a raktár fejlesztés növeli a sapkát', () => {
    const before = computeOfflineReport(absentFor(playerWithAutomation(), 48), NOW);

    const upgradedState = absentFor(playerWithAutomation(), 48);
    upgradedState.equipment.storage = 4; // +6 óra
    const upgraded = computeOfflineReport(upgradedState, NOW);

    expect(upgraded.capHours).toBeGreaterThan(before.capHours);
    expect(upgraded.baseEarnings).toBeGreaterThan(before.baseEarnings);
  });

  it('a jóváírás növeli a pénzt és a statisztikákat is', () => {
    const state = absentFor(playerWithAutomation(), 2);
    const report = computeOfflineReport(state, NOW);

    const cashBefore = state.cash;
    const lifetimeBefore = state.stats.lifetimeEarnings;

    const payout = applyOfflineEarnings(state, report, NOW, 1);

    expect(payout).toBeCloseTo(report.baseEarnings);
    expect(state.cash).toBeCloseTo(cashBefore + payout);
    expect(state.stats.lifetimeEarnings).toBeCloseTo(lifetimeBefore + payout);
    expect(state.lastSeenWallClock).toBe(NOW.wall);
  });

  it('a reklámszorzó pontosan duplázza a kifizetést', () => {
    const base = absentFor(playerWithAutomation(), 2);
    const boosted = absentFor(playerWithAutomation(), 2);

    const single = applyOfflineEarnings(base, computeOfflineReport(base, NOW), NOW, 1);
    const double = applyOfflineEarnings(
      boosted,
      computeOfflineReport(boosted, NOW),
      NOW,
      GAME_CONFIG.offline.adMultiplier,
    );

    expect(double).toBeCloseTo(single * GAME_CONFIG.offline.adMultiplier);
  });

  it('rövid távollétnél nem jelenik meg az ablak', () => {
    const short = playerWithAutomation();
    short.lastSeenWallClock = NOW.wall - 10_000;
    short.maxSeenWallClock = short.lastSeenWallClock;
    expect(shouldShowOfflineModal(computeOfflineReport(short, NOW))).toBe(false);

    const long = absentFor(playerWithAutomation(), 2);
    expect(shouldShowOfflineModal(computeOfflineReport(long, NOW))).toBe(true);
  });

  it('visszaállított óra esetén nincs ablak és nincs bevétel', () => {
    // A mentés szerint a jövőben járt utoljára – tehát visszaállították az órát.
    const state = playerWithAutomation();
    state.lastSeenWallClock = NOW.wall + 10 * HOUR;
    state.maxSeenWallClock = state.lastSeenWallClock;

    const report = computeOfflineReport(state, NOW);
    expect(report.clockRolledBack).toBe(true);
    expect(report.baseEarnings).toBe(0);
    expect(shouldShowOfflineModal(report)).toBe(false);
  });
});

describe('időugrás (Food Coin)', () => {
  it('ugyanazt a képletet használja, mint az offline számítás', () => {
    const hours = 2;
    const state = absentFor(playerWithAutomation(), hours);

    const skip = timeSkipEarnings(state, hours, NOW.wall);
    const offline = computeOfflineReport(state, NOW);

    expect(skip).toBeCloseTo(offline.baseEarnings, 2);
  });

  it('nem lépi túl a maximumot', () => {
    const state = playerWithAutomation();
    const huge = timeSkipEarnings(state, 999, NOW.wall);
    const capped = timeSkipEarnings(state, GAME_CONFIG.coins.timeSkipMaxHours, NOW.wall);
    expect(huge).toBeCloseTo(capped);
  });
});

describe('teszt-óra', () => {
  it('a fali óra átállítása nem mozgatja a monoton órát', () => {
    const clock = createTestClock(1_000_000);
    clock.advance(5_000);
    const before = clock.read();

    clock.setWall(1_000_000);
    const after = clock.read();

    expect(after.wall).toBeLessThan(before.wall);
    expect(after.mono).toBe(before.mono);
  });
});
