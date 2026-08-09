import { GAME_CONFIG } from '@/config/gameConfig';
import { ACHIEVEMENTS } from '@/game/content/achievements';
import { CITIES, getCity } from '@/game/content/cities';
import { EQUIPMENT, tierAt } from '@/game/content/equipment';
import { activeEvents } from '@/game/content/events';
import { FRANCHISE_PERKS } from '@/game/content/franchise';
import { PRODUCTS, getProduct, productsOfCity } from '@/game/content/products';
import { STAFF } from '@/game/content/staff';
import {
  cycleSeconds,
  incomePerSecond,
  nextMilestone,
  resolveBuy,
  revenuePerCycle,
} from '@/game/economy';
import type {
  Effect,
  GameState,
  Multipliers,
  ProductDef,
  ProductId,
  ProductView,
} from '@/game/types';

/**
 * SZÁMÍTOTT ÉRTÉKEK
 *
 * A `Multipliers` objektum a játék "állapotának derivált része": minden
 * fejlesztés, alkalmazott, város, csillag, booster és esemény hatását
 * összesíti egyetlen struktúrába. A szimuláció és a UI is EZT használja, így
 * kizárt, hogy a kijelzett bevétel eltérjen a ténylegesen jóváírttól.
 *
 * Teljesítmény: a számítás ~36 termékre és ~9 gépre fut, allokáció-takarékosan.
 * 5 Hz-en ez gyenge készüléken is a képkockaidő töredéke.
 */

// ---------------------------------------------------------------------------
// Effekt-gyűjtés
// ---------------------------------------------------------------------------

type Accumulator = {
  globalIncome: number;
  globalCycle: number;
  categoryIncome: Map<string, number>;
  categoryCycle: Map<string, number>;
  cityIncome: Map<string, number>;
  productIncome: Map<string, number>;
  productCycle: Map<string, number>;
  offlineCapHours: number;
  offlineRate: number;
  tapMultiplier: number;
  coinFind: number;
};

function createAccumulator(): Accumulator {
  return {
    globalIncome: 1,
    globalCycle: 1,
    categoryIncome: new Map(),
    categoryCycle: new Map(),
    cityIncome: new Map(),
    productIncome: new Map(),
    productCycle: new Map(),
    offlineCapHours: GAME_CONFIG.offline.baseCapHours,
    offlineRate: GAME_CONFIG.offline.baseRate,
    tapMultiplier: 1,
    coinFind: 1,
  };
}

function multiplyInto(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 1) * value);
}

function applyEffect(acc: Accumulator, effect: Effect): void {
  switch (effect.type) {
    case 'incomeMultiplier':
      switch (effect.scope.kind) {
        case 'global':
          acc.globalIncome *= effect.value;
          break;
        case 'category':
          multiplyInto(acc.categoryIncome, effect.scope.category, effect.value);
          break;
        case 'city':
          multiplyInto(acc.cityIncome, effect.scope.cityId, effect.value);
          break;
        case 'product':
          multiplyInto(acc.productIncome, effect.scope.productId, effect.value);
          break;
      }
      break;

    case 'cycleMultiplier':
      switch (effect.scope.kind) {
        case 'global':
          acc.globalCycle *= effect.value;
          break;
        case 'category':
          multiplyInto(acc.categoryCycle, effect.scope.category, effect.value);
          break;
        case 'product':
          multiplyInto(acc.productCycle, effect.scope.productId, effect.value);
          break;
        case 'city':
          // A városra szóló ciklusbónuszt jelenleg nem használjuk, de a típus
          // engedi – itt csendben figyelmen kívül hagyjuk.
          break;
      }
      break;

    case 'offlineCapHours':
      acc.offlineCapHours += effect.value;
      break;
    case 'offlineRate':
      acc.offlineRate += effect.value;
      break;
    case 'tapMultiplier':
      acc.tapMultiplier *= effect.value;
      break;
    case 'coinFind':
      acc.coinFind *= effect.value;
      break;
  }
}

// ---------------------------------------------------------------------------
// Fő szorzó-számítás
// ---------------------------------------------------------------------------

export function computeMultipliers(state: GameState, wallMs: number): Multipliers {
  const acc = createAccumulator();

  // 1. Városok: minden birtokolt város globális szorzót ad.
  for (const cityId of state.unlockedCityIds) {
    const city = CITIES.find((c) => c.id === cityId);
    if (city) acc.globalIncome *= city.globalMultiplier;
  }

  // 2. Gépek: csak a birtokolt szint effektje él (abszolút értékek).
  for (const equipment of EQUIPMENT) {
    const ownedTier = state.equipment[equipment.id] ?? 0;
    if (ownedTier <= 0) continue;
    const tier = tierAt(equipment, ownedTier);
    if (!tier) continue;
    for (const effect of tier.effects) applyEffect(acc, effect);
  }

  // 3. Alkalmazottak: additív modell -> 1 + érték * szint.
  for (const staff of STAFF) {
    const level = state.staff[staff.id] ?? 0;
    if (level <= 0) continue;
    const total = staff.effectPerLevel.value * level;
    switch (staff.effectPerLevel.type) {
      case 'incomeMultiplier':
        acc.globalIncome *= 1 + total;
        break;
      case 'offlineRate':
        acc.offlineRate += total;
        break;
      case 'tapMultiplier':
        acc.tapMultiplier *= 1 + total;
        break;
      case 'coinFind':
        acc.coinFind *= 1 + total;
        break;
      case 'offlineCapHours':
        acc.offlineCapHours += total;
        break;
      case 'cycleMultiplier':
        acc.globalCycle *= 1 - total;
        break;
    }
  }

  // 4. Achievementek: additív bevételbónusz, egyben összegezve.
  let achievementBonus = 0;
  for (const id of state.unlockedAchievementIds) {
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (def) achievementBonus += def.incomeBonus;
  }
  if (achievementBonus > 0) acc.globalIncome *= 1 + achievementBonus;

  // 5. Franchise csillagok (passzív) + perkek.
  if (state.stars > 0) {
    acc.globalIncome *= 1 + state.stars * GAME_CONFIG.franchise.incomePerStar;
  }
  for (const perkId of state.ownedPerkIds) {
    const perk = FRANCHISE_PERKS.find((p) => p.id === perkId);
    if (!perk) continue;
    for (const effect of perk.effects) applyEffect(acc, effect);
  }

  // 6. IAP jogosultságok.
  if (state.entitlements.includes('goldenCounter')) {
    acc.globalIncome *= 1.25;
    acc.offlineCapHours *= 2;
  }

  // 7. Aktív boosterek.
  for (const booster of Object.values(state.boosters)) {
    if (!booster || booster.expiresAt <= wallMs) continue;
    acc.globalIncome *= booster.incomeMultiplier;
    acc.globalCycle *= booster.cycleMultiplier;
  }

  // 8. Időszakos események (helyi naptárból, offline is működik).
  for (const event of activeEvents(wallMs)) {
    for (const effect of event.effects) applyEffect(acc, effect);
  }

  // --- Termékenkénti eredők összeállítása ---
  const productIncome: Record<ProductId, number> = {};
  const productCycle: Record<ProductId, number> = {};

  for (const product of PRODUCTS) {
    let income = acc.productIncome.get(product.id) ?? 1;
    income *= acc.categoryIncome.get(product.category) ?? 1;
    income *= acc.cityIncome.get(product.cityId) ?? 1;
    productIncome[product.id] = income;

    let cycle = acc.productCycle.get(product.id) ?? 1;
    cycle *= acc.categoryCycle.get(product.category) ?? 1;
    cycle *= acc.globalCycle;
    productCycle[product.id] = cycle;
  }

  return {
    globalIncome: acc.globalIncome,
    productIncome,
    productCycle,
    offlineCapHours: Math.min(acc.offlineCapHours, GAME_CONFIG.offline.maxCapHours),
    offlineRate: Math.min(1, Math.max(0, acc.offlineRate)),
    tapMultiplier: acc.tapMultiplier,
    coinFind: acc.coinFind,
  };
}

// ---------------------------------------------------------------------------
// Származtatott lekérdezések
// ---------------------------------------------------------------------------

/** Egy termék bevétele másodpercenként, ha automatizált. 0, ha nincs menedzsere. */
export function productIdleIncome(
  state: GameState,
  multipliers: Multipliers,
  def: ProductDef,
): number {
  const productState = state.products[def.id];
  if (!productState || productState.level <= 0 || !productState.hasManager) return 0;
  return incomePerSecond(
    def,
    productState.level,
    multipliers.productIncome[def.id] ?? 1,
    multipliers.globalIncome,
    multipliers.productCycle[def.id] ?? 1,
  );
}

/** A teljes birodalom automatikus bevétele másodpercenként. */
export function totalIncomePerSecond(state: GameState, multipliers: Multipliers): number {
  let total = 0;
  for (const cityId of state.unlockedCityIds) {
    for (const def of productsOfCity(cityId)) {
      total += productIdleIncome(state, multipliers, def);
    }
  }
  return total;
}

/**
 * A teljes bevétel, ha MINDEN megvett termék termelne (menedzser nélkül is).
 * A UI ezt mutatja "potenciál"-ként, hogy látszódjon, mennyit ér a menedzser.
 */
export function totalPotentialIncomePerSecond(
  state: GameState,
  multipliers: Multipliers,
): number {
  let total = 0;
  for (const cityId of state.unlockedCityIds) {
    for (const def of productsOfCity(cityId)) {
      const productState = state.products[def.id];
      if (!productState || productState.level <= 0) continue;
      total += incomePerSecond(
        def,
        productState.level,
        multipliers.productIncome[def.id] ?? 1,
        multipliers.globalIncome,
        multipliers.productCycle[def.id] ?? 1,
      );
    }
  }
  return total;
}

/** A UI-nak szánt, teljesen kiszámolt terméknézet. */
export function buildProductView(
  state: GameState,
  multipliers: Multipliers,
  def: ProductDef,
  wallMs: number,
): ProductView {
  const productState =
    state.products[def.id] ?? { level: 0, hasManager: false, progress: 0, nextServeAt: 0 };
  const level = productState.level;

  const productMultiplier = multipliers.productIncome[def.id] ?? 1;
  const cycleMultiplier = multipliers.productCycle[def.id] ?? 1;

  const revenue = revenuePerCycle(def, level, productMultiplier, multipliers.globalIncome);
  const seconds = cycleSeconds(def, level, cycleMultiplier);
  const { amount, cost } = resolveBuy(def, level, state.cash, state.settings.buyQuantity);

  const cityEarned = state.cityEarnings[def.cityId] ?? 0;

  // Kézi terméknél a haladássáv a következő kiszolgálásig hátralévő időt
  // mutatja (0 = épp most töltődött fel), automatizáltnál a ciklus állását.
  const canServe = level > 0 && !productState.hasManager && wallMs >= productState.nextServeAt;
  const cooldownRemaining = Math.max(0, productState.nextServeAt - wallMs) / 1000;
  const displayProgress = productState.hasManager
    ? seconds < GAME_CONFIG.milestones.continuousBelowSeconds
      ? 1
      : productState.progress
    : seconds > 0
      ? 1 - Math.min(1, cooldownRemaining / seconds)
      : 1;

  return {
    def,
    state: productState,
    revenuePerCycle: revenue,
    cycleSeconds: seconds,
    // A kézi termék NEM termel magától – a bevétel/mp csak automatizáltnál
    // értelmes, különben félrevezető számot mutatnánk.
    incomePerSecond: level > 0 && productState.hasManager ? revenue / seconds : 0,
    buyCost: cost,
    buyAmount: amount,
    affordable: amount > 0 && cost <= state.cash,
    unlocked: level > 0 || cityEarned >= def.unlockAtCityEarnings,
    nextMilestone: nextMilestone(level),
    continuous: seconds < GAME_CONFIG.milestones.continuousBelowSeconds,
    canServe,
    displayProgress,
  };
}

/** Az aktív város összes terméknézete, megjelenítési sorrendben. */
export function buildCityProductViews(
  state: GameState,
  multipliers: Multipliers,
  cityId: string,
  wallMs: number,
): ProductView[] {
  return productsOfCity(cityId).map((def) =>
    buildProductView(state, multipliers, def, wallMs),
  );
}

/**
 * Egy kézi kiszolgálás (koppintás) értéke az adott terméknél.
 * Automatizált terméknél 0, mert ott a koppintásnak nincs hatása.
 */
export function tapValue(
  state: GameState,
  multipliers: Multipliers,
  productId: ProductId,
): number {
  const def = getProduct(productId);
  const productState = state.products[productId];
  if (!productState || productState.level <= 0 || productState.hasManager) return 0;
  return (
    revenuePerCycle(
      def,
      productState.level,
      multipliers.productIncome[productId] ?? 1,
      multipliers.globalIncome,
    ) * multipliers.tapMultiplier
  );
}

/**
 * Ki van-e maxolva egy helyszín?
 *
 * „Kimaxolt” = minden termék megvan, mindegyik elérte a megkövetelt szintet,
 * és mindegyiknek van menedzsere. Ez a költözés feltétele.
 */
export function cityMastery(
  state: GameState,
  cityId: string,
): {
  ready: boolean;
  totalProducts: number;
  atLevel: number;
  automated: number;
  requiredLevel: number;
} {
  const products = productsOfCity(cityId);
  const requiredLevel = GAME_CONFIG.cityUnlock.requiredProductLevel;

  let atLevel = 0;
  let automated = 0;

  for (const def of products) {
    const productState = state.products[def.id];
    if (!productState) continue;
    if (productState.level >= requiredLevel) atLevel += 1;
    if (productState.hasManager) automated += 1;
  }

  const ready =
    atLevel === products.length &&
    (!GAME_CONFIG.cityUnlock.requireAllManagers || automated === products.length);

  return { ready, totalProducts: products.length, atLevel, automated, requiredLevel };
}

export type CityUnlockStatus = {
  unlocked: boolean;
  /** Minden feltétel teljesül – most megnyitható. */
  affordable: boolean;
  missingCash: number;
  missingLifetime: number;
  /** A JELENLEGI hely kimaxoltsága (ez a költözés kapuja). */
  mastery: ReturnType<typeof cityMastery>;
};

/** Feloldható-e a következő helyszín? */
export function cityUnlockStatus(state: GameState, cityId: string): CityUnlockStatus {
  const city = getCity(cityId);
  const unlocked = state.unlockedCityIds.includes(cityId);
  const lifetime = state.stats.lifetimeEarnings;

  // A költözéshez az AKTUÁLIS helyet kell kimaxolni, nem a célállomást.
  const mastery = cityMastery(state, state.activeCityId);

  return {
    unlocked,
    affordable:
      !unlocked &&
      mastery.ready &&
      state.cash >= city.unlockCost &&
      lifetime >= city.unlockRequiresLifetime,
    missingCash: Math.max(0, city.unlockCost - state.cash),
    missingLifetime: Math.max(0, city.unlockRequiresLifetime - lifetime),
    mastery,
  };
}
