import { GAME_CONFIG } from '@/config/gameConfig';
import { CITIES } from '@/game/content/cities';
import { productsOfCity } from '@/game/content/products';
import * as actions from '@/game/actions';
import { cycleSeconds, incomePerSecond } from '@/game/economy';
import { createInitialState } from '@/game/initialState';
import { computeMultipliers, totalIncomePerSecond } from '@/game/selectors';
import { canServeByHand, serveByHand, simulateTick } from '@/game/simulate';
import type { GameState } from '@/game/types';

function starter(): GameState {
  return createInitialState(0);
}

const firstProductId = productsOfCity(CITIES[0]!.id)[0]!.id;

describe('termékvásárlás', () => {
  it('levonja a pénzt és növeli a szintet', () => {
    const state = starter();
    state.cash = 1_000;
    const levelBefore = state.products[firstProductId]!.level;

    const result = actions.buyProductLevels(state, firstProductId, 10);

    expect(result.ok).toBe(true);
    expect(state.products[firstProductId]!.level).toBe(levelBefore + 10);
    expect(state.cash).toBeLessThan(1_000);
    expect(state.stats.totalLevelsBought).toBe(10);
  });

  it('nem enged pénz nélkül vásárolni', () => {
    const state = starter();
    state.cash = 0;
    const result = actions.buyProductLevels(state, firstProductId, 1);
    expect(result.ok).toBe(false);
  });

  it('nem enged zárolt terméket venni', () => {
    const state = starter();
    state.cash = 1e12;
    const locked = productsOfCity(CITIES[0]!.id)[5]!;
    state.cityEarnings[CITIES[0]!.id] = 0;

    const result = actions.buyProductLevels(state, locked.id, 1);
    expect(result.ok).toBe(false);
  });

  it('a pénz soha nem megy negatívba "max" vásárlásnál', () => {
    const state = starter();
    state.cash = 9_999;
    actions.buyProductLevels(state, firstProductId, 'max');
    expect(state.cash).toBeGreaterThanOrEqual(0);
  });
});

describe('menedzser', () => {
  it('felvétel után a termék automatikus', () => {
    const state = starter();
    const def = productsOfCity(CITIES[0]!.id)[0]!;
    state.cash = def.managerCost;

    expect(actions.hireManager(state, def.id).ok).toBe(true);
    expect(state.products[def.id]!.hasManager).toBe(true);
    expect(state.cash).toBe(0);
    expect(state.stats.managersHired).toBe(1);
  });

  it('kétszer nem vehető fel', () => {
    const state = starter();
    const def = productsOfCity(CITIES[0]!.id)[0]!;
    state.cash = def.managerCost * 3;

    actions.hireManager(state, def.id);
    const second = actions.hireManager(state, def.id);
    expect(second.ok).toBe(false);
  });
});

/** A jelenlegi helyet kimaxolja: minden termék szintre hozva + menedzser. */
function masterCurrentCity(state: GameState): void {
  for (const def of productsOfCity(state.activeCityId)) {
    const product = state.products[def.id]!;
    product.level = GAME_CONFIG.cityUnlock.requiredProductLevel;
    product.hasManager = true;
  }
}

describe('városok', () => {
  it('kimaxolt hely, elég pénz és bevétel esetén megnyílik', () => {
    const state = starter();
    const city = CITIES[1]!;
    masterCurrentCity(state);
    state.cash = city.unlockCost;
    state.stats.lifetimeEarnings = city.unlockRequiresLifetime;

    expect(actions.unlockCity(state, city.id).ok).toBe(true);
    expect(state.unlockedCityIds).toContain(city.id);
    expect(state.activeCityId).toBe(city.id);
    // Az új város első terméke ingyen jár.
    expect(state.products[productsOfCity(city.id)[0]!.id]!.level).toBe(1);
  });

  it('elégtelen összbevételnél nem nyílik meg', () => {
    const state = starter();
    const city = CITIES[1]!;
    masterCurrentCity(state);
    state.cash = city.unlockCost * 10;
    state.stats.lifetimeEarnings = 0;

    expect(actions.unlockCity(state, city.id).ok).toBe(false);
  });

  it('kimaxolatlan helyről nem lehet továbbköltözni', () => {
    // Ez a fő kapu: hiába van pénz, előbb ki kell építeni a jelenlegi helyet.
    const state = starter();
    const city = CITIES[1]!;
    state.cash = city.unlockCost * 100;
    state.stats.lifetimeEarnings = city.unlockRequiresLifetime * 100;

    const result = actions.unlockCity(state, city.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('maxold');
  });

  it('a menedzserek hiánya önmagában is megakasztja a költözést', () => {
    const state = starter();
    const city = CITIES[1]!;
    for (const def of productsOfCity(state.activeCityId)) {
      state.products[def.id]!.level = GAME_CONFIG.cityUnlock.requiredProductLevel;
      // ...de menedzser nélkül
    }
    state.cash = city.unlockCost * 100;
    state.stats.lifetimeEarnings = city.unlockRequiresLifetime * 100;

    expect(actions.unlockCity(state, city.id).ok).toBe(false);
  });
});

describe('szimuláció', () => {
  it('menedzser nélkül nem termel magától', () => {
    const state = starter();
    const multipliers = computeMultipliers(state, 0);
    const before = state.cash;

    simulateTick(state, 10, multipliers);
    expect(state.cash).toBe(before);
  });

  it('menedzserrel termel, és a statisztikák együtt nőnek', () => {
    const state = starter();
    const def = productsOfCity(CITIES[0]!.id)[0]!;
    state.products[def.id]!.hasManager = true;
    state.products[def.id]!.level = 10;

    const multipliers = computeMultipliers(state, 0);
    const cashBefore = state.cash;

    simulateTick(state, 10, multipliers);

    const earned = state.cash - cashBefore;
    expect(earned).toBeGreaterThan(0);
    expect(state.stats.lifetimeEarnings).toBeCloseTo(earned);
    expect(state.runEarnings).toBeCloseTo(earned);
    expect(state.cityEarnings[def.cityId]).toBeCloseTo(earned);
  });

  it('a kézi kiszolgálás fizet és számol', () => {
    const state = starter();
    const def = productsOfCity(CITIES[0]!.id)[0]!;
    const multipliers = computeMultipliers(state, 0);

    const payout = serveByHand(state, multipliers, def, 0);

    expect(payout).toBeGreaterThan(0);
    expect(state.stats.totalTaps).toBe(1);
  });

  it('a kézi kiszolgálás ciklusidőnként legfeljebb egyszer fizet', () => {
    // Ez a játék legfontosabb gazdasági korlátja: enélkül a gyors
    // koppintgatás nagyságrendekkel veri az automatizálást.
    const state = starter();
    const def = productsOfCity(CITIES[0]!.id)[0]!;
    const multipliers = computeMultipliers(state, 0);
    const seconds = cycleSeconds(def, state.products[def.id]!.level, 1);

    const first = serveByHand(state, multipliers, def, 0);
    expect(first).toBeGreaterThan(0);

    // Közvetlenül utána nincs fizetés...
    expect(serveByHand(state, multipliers, def, 1)).toBe(0);
    expect(serveByHand(state, multipliers, def, seconds * 1000 - 1)).toBe(0);

    // ...a ciklusidő letelte után viszont igen.
    expect(serveByHand(state, multipliers, def, seconds * 1000)).toBeGreaterThan(0);

    // A sikertelen próbálkozások nem számítanak koppintásnak.
    expect(state.stats.totalTaps).toBe(2);
  });

  it('automatizált terméket a koppintás nem fizet ki', () => {
    const state = starter();
    const def = productsOfCity(CITIES[0]!.id)[0]!;
    state.products[def.id]!.hasManager = true;
    const multipliers = computeMultipliers(state, 0);

    expect(serveByHand(state, multipliers, def, 0)).toBe(0);
    expect(canServeByHand(state, def, 0)).toBe(false);
  });

  it('a kézi bevétel felső korlátja az automatizált bevétel × koppintás-szorzó', () => {
    const state = starter();
    const def = productsOfCity(CITIES[0]!.id)[0]!;
    state.products[def.id]!.level = 40;

    const multipliers = computeMultipliers(state, 0);
    const seconds = cycleSeconds(def, 40, 1);

    // Maximális kézi ütem: ciklusonként egy adag.
    let handEarnings = 0;
    for (let t = 0; t < 10; t += 1) {
      handEarnings += serveByHand(state, multipliers, def, t * seconds * 1000);
    }
    const handPerSecond = handEarnings / (10 * seconds);

    const automated = incomePerSecond(def, 40, 1, 1, 1);
    expect(handPerSecond).toBeLessThanOrEqual(automated * multipliers.tapMultiplier * 1.0001);
  });

  it('a hosszú tick nem termel többet, mint ugyanannyi rövid', () => {
    const build = () => {
      const state = starter();
      const def = productsOfCity(CITIES[0]!.id)[0]!;
      state.products[def.id]!.hasManager = true;
      state.products[def.id]!.level = 30;
      return state;
    };

    const single = build();
    const chunked = build();
    const multipliers = computeMultipliers(single, 0);

    simulateTick(single, 1, multipliers);
    for (let i = 0; i < 5; i += 1) simulateTick(chunked, 0.2, multipliers);

    // Ciklusalapú termelésnél a darabolás legfeljebb egy részciklust késleltet.
    expect(chunked.cash).toBeLessThanOrEqual(single.cash + 1e-6);
  });
});

describe('boosterek', () => {
  it('aktiválás után a globális szorzó nő', () => {
    const state = starter();
    const before = computeMultipliers(state, 0).globalIncome;

    actions.activateBooster(state, 'doubleIncome', 0);
    const after = computeMultipliers(state, 0).globalIncome;

    expect(after).toBeCloseTo(before * GAME_CONFIG.boosters.doubleIncome.multiplier);
  });

  it('lejárat után nincs hatása', () => {
    const state = starter();
    actions.activateBooster(state, 'doubleIncome', 0);

    const expired = GAME_CONFIG.boosters.doubleIncome.durationSeconds * 1000 + 1;
    const base = computeMultipliers(createInitialState(0), expired).globalIncome;
    expect(computeMultipliers(state, expired).globalIncome).toBeCloseTo(base);
  });

  it('az azonos típus ideje összeadódik, de van plafon', () => {
    const state = starter();
    actions.activateBooster(state, 'doubleIncome', 0);
    const first = state.boosters.doubleIncome!.expiresAt;

    actions.activateBooster(state, 'doubleIncome', 0);
    expect(state.boosters.doubleIncome!.expiresAt).toBeGreaterThan(first);

    for (let i = 0; i < 50; i += 1) actions.activateBooster(state, 'doubleIncome', 0);
    expect(state.boosters.doubleIncome!.expiresAt).toBeLessThanOrEqual(
      GAME_CONFIG.boosters.maxStackSeconds * 1000,
    );
  });

  it('a lejárt boostereket kitakarítja', () => {
    const state = starter();
    actions.activateBooster(state, 'turbo', 0);
    actions.pruneBoosters(state, GAME_CONFIG.boosters.turbo.durationSeconds * 1000 + 1);
    expect(state.boosters.turbo).toBeUndefined();
  });
});

describe('IAP jogosultságok', () => {
  it('a reklámmentesség idempotens', () => {
    const state = starter();
    expect(actions.applyEntitlement(state, 'removeAds', 0).ok).toBe(true);
    expect(actions.applyEntitlement(state, 'removeAds', 0).ok).toBe(false);
    expect(state.entitlements.filter((e) => e === 'removeAds')).toHaveLength(1);
  });

  it('a kezdőcsomag nem adható kétszer', () => {
    const state = starter();
    actions.applyEntitlement(state, 'starterPack', 0);
    const coinsAfterFirst = state.coins;

    actions.applyEntitlement(state, 'starterPack', 0);
    expect(state.coins).toBe(coinsAfterFirst);
  });

  it('az Aranypult növeli a bevételt és az offline sapkát', () => {
    const state = starter();
    const before = computeMultipliers(state, 0);

    actions.applyEntitlement(state, 'goldenCounter', 0);
    const after = computeMultipliers(state, 0);

    expect(after.globalIncome).toBeGreaterThan(before.globalIncome);
    expect(after.offlineCapHours).toBeGreaterThan(before.offlineCapHours);
  });
});

describe('franchise', () => {
  it('küszöb alatt nem indítható', () => {
    const state = starter();
    state.runEarnings = 100;
    expect(actions.doFranchise(state, 0).ok).toBe(false);
  });

  it('megtartja a csillagokat, érméket és eredményeket', () => {
    const state = starter();
    state.runEarnings = 1e21;
    state.stats.lifetimeEarnings = 1e21;
    state.coins = 500;
    state.unlockedAchievementIds = ['earn-1k'];
    state.cash = 999_999;

    const result = actions.doFranchise(state, 0);

    expect(result.ok).toBe(true);
    expect(state.stars).toBeGreaterThan(0);
    expect(state.coins).toBe(500);
    expect(state.unlockedAchievementIds).toContain('earn-1k');
    expect(state.franchiseCount).toBe(1);
    // ...és nullázza a futást
    expect(state.cash).toBe(GAME_CONFIG.start.cash);
    expect(state.runEarnings).toBe(0);
    expect(state.unlockedCityIds).toHaveLength(1);
    expect(state.stats.lifetimeEarnings).toBe(1e21);
  });

  it('a csillagok tartósan növelik a bevételt', () => {
    const state = starter();
    const before = totalIncomePerSecond(state, computeMultipliers(state, 0));

    state.stars = 100;
    const after = totalIncomePerSecond(state, computeMultipliers(state, 0));

    // 100 csillag = +200%
    if (before > 0) expect(after / before).toBeCloseTo(3, 1);
  });
});

describe('achievementek', () => {
  it('teljesítéskor jár az érme, és nem jár kétszer', () => {
    const state = starter();
    state.stats.lifetimeEarnings = 1e6;

    const first = actions.grantAchievements(state);
    expect(first.length).toBeGreaterThan(0);

    const coinsAfter = state.coins;
    const second = actions.grantAchievements(state);

    expect(second).toHaveLength(0);
    expect(state.coins).toBe(coinsAfter);
  });
});
