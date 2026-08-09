/**
 * BALANCE-SZIMULÁTOR
 *
 * Végigjátssza a játékot egy mohó, de reális stratégiával, és kiírja, hogy a
 * fontos mérföldkövek mikor következnek be. Ez a "jó ütemű-e a játék?"
 * kérdésre ad számokat feltételezések helyett.
 *
 * Futtatás:  npm run balance
 *
 * A SZIMULÁLT JÁTÉKOS
 *  - az első `ACTIVE_TAP_MINUTES` percben aktívan koppint (ez a valódi
 *    onboarding: menedzser nélkül csak így van bevétel),
 *  - utána tisztán idle: se koppintás, se reklám, se vásárlás,
 *  - mindig a legjobb megtérülésű dolgot veszi meg,
 *  - a menedzsert elsőbbséggel veszi, mert az offline bevétel attól függ.
 *
 * Ez tehát a *leglassabb* reális ütem. Aki reklámot néz vagy többet koppint,
 * gyorsabban halad.
 *
 * TECHNIKA: nem fix időlépésekkel halad, hanem mindig kiszámolja, mennyi idő
 * kell a következő vásárlásig, és odáig ugrik. Így 30 nap szimulálása
 * másodpercek alatt lefut.
 */

import { formatDuration, formatMoney, formatNumber } from '../src/core/format';
import { CITIES } from '../src/game/content/cities';
import { EQUIPMENT, nextTier } from '../src/game/content/equipment';
import { productsOfCity } from '../src/game/content/products';
import { STAFF, staffLevelCost } from '../src/game/content/staff';
import * as actions from '../src/game/actions';
import { cycleSeconds, levelCost, revenuePerCycle, starsForRun } from '../src/game/economy';
import { createInitialState } from '../src/game/initialState';
import { cityMastery, computeMultipliers, totalIncomePerSecond } from '../src/game/selectors';
import { creditEarnings } from '../src/game/simulate';
import type { GameState, Multipliers } from '../src/game/types';

const WALL_START = 1_772_409_600_000; // 2026-03-02, hétfő – eseménymentes nap
const HORIZON_SECONDS = 60 * 60 * 24 * 30; // 30 nap
const ACTIVE_TAP_MINUTES = 15;
const TAPS_PER_SECOND = 3;
const MAX_PURCHASES = 40_000;

// ---------------------------------------------------------------------------
// Segédfüggvények
// ---------------------------------------------------------------------------

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/** Bevétel/mp azután, hogy a megadott vásárlás megtörtént. */
function incomeAfter(
  state: GameState,
  apply: (draft: GameState) => void,
  wall: number,
): number {
  const draft = cloneState(state);
  draft.cash = Number.MAX_SAFE_INTEGER; // a próbavásárlás ne bukjon el áron
  apply(draft);
  return totalIncomePerSecond(draft, computeMultipliers(draft, wall));
}

/**
 * A kézi kiszolgálásból elérhető LEGJOBB bevétel/mp.
 *
 * Fontos, hogy ez pontosan ugyanazt a korlátot modellezze, mint a játék:
 * egy terméket legfeljebb ciklusidőnként egyszer lehet kézzel kiszolgálni, és
 * automatizált terméket egyáltalán nem. A játékos egyszerre egy terméket
 * koppint, ezért a legjobbat vesszük.
 */
function bestTapIncomePerSecond(
  state: GameState,
  multipliers: Multipliers,
  tapsPerSecond: number,
): number {
  if (tapsPerSecond <= 0) return 0;

  let best = 0;
  for (const cityId of state.unlockedCityIds) {
    for (const def of productsOfCity(cityId)) {
      const productState = state.products[def.id];
      if (!productState || productState.level <= 0) continue;
      if (productState.hasManager) continue; // automatizált: a koppintás hatástalan

      const revenue =
        revenuePerCycle(
          def,
          productState.level,
          multipliers.productIncome[def.id] ?? 1,
          multipliers.globalIncome,
        ) * multipliers.tapMultiplier;

      const seconds = cycleSeconds(def, productState.level, multipliers.productCycle[def.id] ?? 1);
      // Legfeljebb ciklusonként egy adag, és legfeljebb annyi, amennyit
      // a játékos koppintani bír.
      const rate = Math.min(tapsPerSecond, 1 / seconds) * revenue;
      if (rate > best) best = rate;
    }
  }
  return best;
}

type Option = {
  label: string;
  cost: number;
  /** Bevétel/mp növekmény (idle + koppintás együtt). */
  gain: number;
  apply: (state: GameState) => void;
};

function collectOptions(
  state: GameState,
  multipliers: Multipliers,
  wall: number,
  tapRate: number,
): Option[] {
  const options: Option[] = [];
  const baseIdle = totalIncomePerSecond(state, multipliers);
  const baseTap = bestTapIncomePerSecond(state, multipliers, tapRate);

  const totalAfter = (apply: (draft: GameState) => void): number => {
    const draft = cloneState(state);
    draft.cash = Number.MAX_SAFE_INTEGER;
    apply(draft);
    const next = computeMultipliers(draft, wall);
    return totalIncomePerSecond(draft, next) + bestTapIncomePerSecond(draft, next, tapRate);
  };

  for (const cityId of state.unlockedCityIds) {
    for (const def of productsOfCity(cityId)) {
      const productState = state.products[def.id];
      if (!productState) continue;

      const cityEarned = state.cityEarnings[cityId] ?? 0;
      if (productState.level === 0 && cityEarned < def.unlockAtCityEarnings) continue;

      // Szintvásárlás
      options.push({
        label: `${def.name} +1 szint`,
        cost: levelCost(def, productState.level),
        gain: Math.max(1e-12, totalAfter((s) => actions.buyProductLevels(s, def.id, 1)) - baseIdle - baseTap),
        apply: (s) => actions.buyProductLevels(s, def.id, 1),
      });

      // Menedzser
      if (!productState.hasManager && productState.level > 0) {
        options.push({
          label: `${def.name} MENEDZSER`,
          cost: def.managerCost,
          gain: Math.max(1e-12, incomeAfter(state, (s) => actions.hireManager(s, def.id), wall) - baseIdle),
          apply: (s) => actions.hireManager(s, def.id),
        });
      }
    }
  }

  for (const equipment of EQUIPMENT) {
    const tier = nextTier(equipment, state.equipment[equipment.id] ?? 0);
    if (!tier) continue;
    options.push({
      label: `${equipment.name} ${tier.tier}. szint`,
      cost: tier.cost,
      gain: Math.max(1e-12, totalAfter((s) => actions.buyEquipmentTier(s, equipment.id)) - baseIdle - baseTap),
      apply: (s) => actions.buyEquipmentTier(s, equipment.id),
    });
  }

  for (const def of STAFF) {
    const level = state.staff[def.id] ?? 0;
    if (level >= def.maxLevel) continue;
    options.push({
      label: `${def.name} ${level + 1}. szint`,
      cost: staffLevelCost(def, level),
      gain: Math.max(1e-12, totalAfter((s) => actions.hireStaffLevel(s, def.id)) - baseIdle - baseTap),
      apply: (s) => actions.hireStaffLevel(s, def.id),
    });
  }

  return options;
}

/** Olcsó „ujjlenyomat” a haladásról – a megakadás-figyelőhöz. */
function fingerprint(state: GameState): number {
  let sum = 0;
  for (const level of Object.values(state.equipment)) sum += level;
  for (const level of Object.values(state.staff)) sum += level;
  sum += state.stats.managersHired * 1000;
  sum += state.unlockedCityIds.length * 1_000_000;
  return sum;
}

/** A következő megnyitható város (vagy null). */
function nextCityToUnlock(state: GameState) {
  return CITIES.find((city) => !state.unlockedCityIds.includes(city.id)) ?? null;
}

// ---------------------------------------------------------------------------
// Szimuláció
// ---------------------------------------------------------------------------

type Milestone = { at: number; label: string };

function run(): void {
  const state = createInitialState(WALL_START);
  const milestones: Milestone[] = [];
  const seen = new Set<string>();

  let elapsed = 0;
  let purchases = 0;
  let stalls = 0;
  let multipliers = computeMultipliers(state, WALL_START);

  const note = (label: string): void => {
    if (seen.has(label)) return;
    seen.add(label);
    milestones.push({ at: elapsed, label });
  };

  const checkMilestones = (): void => {
    for (const threshold of [1e3, 1e5, 1e7, 1e9, 1e12, 1e15, 1e18, 1e21]) {
      if (state.stats.lifetimeEarnings >= threshold) {
        note(`Összbevétel ${formatMoney(threshold)}`);
      }
    }
    const income = totalIncomePerSecond(state, multipliers);
    for (const threshold of [10, 1e3, 1e6, 1e9, 1e12, 1e15]) {
      if (income >= threshold) note(`Bevétel/mp eléri a ${formatMoney(threshold)}-ot`);
    }
    if (starsForRun(state.runEarnings) > 0) note('Első franchise elérhetővé válik');
  };

  const tapRateAt = (seconds: number): number =>
    seconds < ACTIVE_TAP_MINUTES * 60 ? TAPS_PER_SECOND : 0;

  /** Előrelépteti az időt `seconds`-szal, jóváírva az idle és tap bevételt. */
  const advance = (seconds: number): void => {
    if (seconds <= 0) return;
    const capped = Math.min(seconds, HORIZON_SECONDS - elapsed);
    if (capped <= 0) return;

    const idle = totalIncomePerSecond(state, multipliers);
    const tap = bestTapIncomePerSecond(state, multipliers, tapRateAt(elapsed));
    const earned = (idle + tap) * capped;

    if (earned > 0) {
      creditEarnings(state, earned);
      state.cityEarnings[state.activeCityId] =
        (state.cityEarnings[state.activeCityId] ?? 0) + earned;
    }
    state.stats.totalTaps += Math.round(tapRateAt(elapsed) * capped);
    elapsed += capped;
  };

  while (elapsed < HORIZON_SECONDS && purchases < MAX_PURCHASES) {
    const wall = WALL_START + elapsed * 1000;

    // --- Városnyitás, amint lehet (ez a legnagyobb ugrás a játékban) ---
    const city = nextCityToUnlock(state);
    if (
      city &&
      state.cash >= city.unlockCost &&
      state.stats.lifetimeEarnings >= city.unlockRequiresLifetime &&
      // The mastery gate must be checked BEFORE calling the action: unlockCity
      // fails silently here, and `continue` without a state change would spin
      // the loop forever.
      cityMastery(state, state.activeCityId).ready
    ) {
      const moved = actions.unlockCity(state, city.id);
      if (moved.ok) {
        multipliers = computeMultipliers(state, wall);
        note(`${city.name} unlocked`);
        continue;
      }
    }

    const tapRate = tapRateAt(elapsed);
    const options = collectOptions(state, multipliers, wall, tapRate);
    if (options.length === 0) break;

    // A legjobb megtérülésű opció (ár / bevételnövekmény).
    options.sort((a, b) => a.cost / a.gain - b.cost / b.gain);
    const best = options[0]!;

    // Mennyi idő kell, hogy kifizethető legyen?
    if (state.cash < best.cost) {
      const idle = totalIncomePerSecond(state, multipliers);
      const tap = bestTapIncomePerSecond(state, multipliers, tapRate);
      const rate = idle + tap;

      if (rate <= 0) {
        // Nincs bevétel és nincs koppintás -> a játékos megrekedt.
        note('MEGREKEDT: nincs bevételi forrás');
        break;
      }

      // EPSILON: pontosan a hiányzó összegre ugrani veszélyes, mert a
      // lebegőpontos kerekítés miatt a végén egy hajszállal kevesebb pénz
      // lehet, mint az ár – és a vásárlás örökre elbukna. Ezért kicsit
      // túllövünk. (A játékban ez nem probléma: ott a gomb ugyanazzal az
      // összehasonlítással tiltódik, amivel a vásárlás ellenőriz.)
      const needed = ((best.cost - state.cash) / rate) * 1.000001 + 1e-6;

      // A koppintási ablak végén újra kell értékelni a döntést.
      const untilTapEnds = ACTIVE_TAP_MINUTES * 60 - elapsed;
      const step = tapRate > 0 && untilTapEnds > 0 ? Math.min(needed, untilTapEnds) : needed;

      advance(step);
      checkMilestones();
      if (state.cash < best.cost) continue;
    }

    // Megakadás-figyelő: ha a vásárlás nem változtatott semmin (pl. rejtett
    // feltétel miatt), léptessük az időt, hogy a szimuláció ne pörögjön
    // örökké ugyanazon a döntésen.
    const before = state.stats.totalLevelsBought + fingerprint(state);
    best.apply(state);
    purchases += 1;

    if (state.stats.totalLevelsBought + fingerprint(state) === before) {
      stalls += 1;
      if (stalls > 50) {
        note(`MEGAKADT: ${best.label} nem hajtható végre`);
        break;
      }
      advance(1);
      continue;
    }

    stalls = 0;
    multipliers = computeMultipliers(state, wall);
    actions.grantAchievements(state);

    if (best.label.includes('MENEDZSER')) note(`Első menedzser (${best.label})`);
    checkMilestones();
  }

  // Ha a vásárlások elfogytak, de van még idő, hagyjuk a bevételt gyűlni.
  advance(HORIZON_SECONDS - elapsed);
  checkMilestones();

  // -------------------------------------------------------------------------
  // Riport
  // -------------------------------------------------------------------------

  const line = '─'.repeat(56);
  console.log('\n' + '═'.repeat(56));
  console.log('  STREET FOOD EMPIRE – BALANCE RIPORT');
  console.log(`  Szimulált játékos: ${ACTIVE_TAP_MINUTES} perc aktív koppintás,`);
  console.log('  utána tisztán idle. Nincs reklám, nincs vásárlás.');
  console.log('═'.repeat(56) + '\n');

  console.log('MÉRFÖLDKÖVEK');
  console.log(line);
  for (const milestone of milestones.sort((a, b) => a.at - b.at)) {
    console.log(`  ${formatDuration(milestone.at).padEnd(16)} ${milestone.label}`);
  }

  console.log('\n30 NAP UTÁN');
  console.log(line);
  console.log(`  Készpénz            ${formatMoney(state.cash)}`);
  console.log(`  Összbevétel         ${formatMoney(state.stats.lifetimeEarnings)}`);
  console.log(`  Bevétel/mp          ${formatMoney(totalIncomePerSecond(state, multipliers))}`);
  console.log(`  Városok             ${state.unlockedCityIds.length}/${CITIES.length}`);
  console.log(`  Menedzserek         ${state.stats.managersHired}`);
  console.log(`  Megvett szintek     ${formatNumber(state.stats.totalLevelsBought)}`);
  console.log(`  Eredmények          ${state.unlockedAchievementIds.length}`);
  console.log(`  Vásárlási lépések   ${formatNumber(purchases)}`);
  console.log(`  Franchise csillag   ${formatNumber(starsForRun(state.runEarnings))}`);

  console.log('\nSZORZÓK 30 NAP UTÁN');
  console.log(line);
  console.log(`  Globális bevétel    ×${formatNumber(multipliers.globalIncome)}`);
  console.log(`  Offline sapka       ${multipliers.offlineCapHours.toFixed(1)} óra`);
  console.log(`  Offline arány       ${(multipliers.offlineRate * 100).toFixed(0)}%`);
  console.log(`  Koppintás           ×${formatNumber(multipliers.tapMultiplier)}`);

  console.log('\nEGÉSZSÉG-ELLENŐRZÉS');
  console.log(line);
  const firstManager = milestones.find((m) => m.label.startsWith('Első menedzser'));
  const secondCity = milestones.find((m) => m.label.includes(CITIES[1]!.name));
  const franchise = milestones.find((m) => m.label.includes('franchise'));
  const lastCity = milestones.find((m) => m.label.includes(CITIES[CITIES.length - 1]!.name));

  const checks: [string, boolean, string][] = [
    [
      'Az első menedzser 10 percen belül megvan',
      !!firstManager && firstManager.at <= 600,
      firstManager ? formatDuration(firstManager.at) : 'soha',
    ],
    [
      'A 2. város az első napon megnyílik',
      !!secondCity && secondCity.at <= 86_400,
      secondCity ? formatDuration(secondCity.at) : 'soha',
    ],
    [
      'Az első franchise 1–7 nap között érhető el',
      !!franchise && franchise.at >= 3_600 && franchise.at <= 7 * 86_400,
      franchise ? formatDuration(franchise.at) : 'soha',
    ],
    [
      'Az első futás legalább 3 napig tart',
      !lastCity || lastCity.at >= 3 * 86_400,
      lastCity ? `${CITIES.length}. város: ${formatDuration(lastCity.at)}` : 'nem ért végig',
    ],
    [
      'Minden szám véges marad',
      Number.isFinite(state.cash) && Number.isFinite(state.stats.lifetimeEarnings),
      'ok',
    ],
    ['A szimuláció nem akadt meg', ![...seen].some((s) => s.startsWith('MEGAKADT') || s.startsWith('MEGREKEDT')), 'ok'],
  ];

  let failures = 0;
  for (const [label, ok, detail] of checks) {
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(42)} ${detail}`);
  }

  console.log(`\n  ${failures === 0 ? 'Minden ellenőrzés rendben.' : `${failures} ellenőrzés bukott.`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run();
