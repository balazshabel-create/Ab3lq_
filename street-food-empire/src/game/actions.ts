import { GAME_CONFIG } from '@/config/gameConfig';
import { log } from '@/core/logger';
import { getCity } from '@/game/content/cities';
import { getEquipment, nextTier } from '@/game/content/equipment';
import { FRANCHISE_PERKS, canBuyPerk, getPerk } from '@/game/content/franchise';
import { getProduct, productsOfCity } from '@/game/content/products';
import { getQuest } from '@/game/content/quests';
import { COIN_SPENDS, DEFAULT_COSMETIC_ID, getCosmetic } from '@/game/content/shop';
import { STAFF, getStaff, staffLevelCost } from '@/game/content/staff';
import { bulkCost, resolveBuy, starsForRun } from '@/game/economy';
import { createInitialState, emptyStats } from '@/game/initialState';
import { timeSkipEarnings } from '@/game/offline';
import {
  allQuestsClaimed,
  findNewlyUnlockedAchievements,
  questProgress,
  rollCrate,
  type CrateReward,
} from '@/game/progression';
import { computeMultipliers } from '@/game/selectors';
import { creditEarnings } from '@/game/simulate';
import type {
  AchievementDef,
  BoosterKey,
  BuyQuantity,
  Entitlement,
  GameState,
  ProductId,
} from '@/game/types';

/**
 * JÁTÉKAKCIÓK
 *
 * Minden akció ugyanazt a szerződést követi:
 *  - a `state`-et **helyben módosítja**,
 *  - `ActionResult`-tal tér vissza (soha nem dob kivételt a normál úton),
 *  - a UI-nak szánt hibaüzenet magyar és a játékos számára értelmes.
 *
 * A store (game/store.ts) csomagolja őket, gondoskodik az új referenciáról,
 * a mentés ütemezéséről és az achievement-ellenőrzésről.
 */

export type ActionResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const fail = (error: string): ActionResult<never> => ({ ok: false, error });
const done = <T>(value: T): ActionResult<T> => ({ ok: true, value });
const ok: ActionResult<void> = { ok: true, value: undefined };

// ---------------------------------------------------------------------------
// Termékek
// ---------------------------------------------------------------------------

export function buyProductLevels(
  state: GameState,
  productId: ProductId,
  quantity: BuyQuantity,
): ActionResult<{ amount: number; cost: number }> {
  const def = getProduct(productId);
  const productState = state.products[productId];
  if (!productState) return fail('Ismeretlen termék.');

  if (!state.unlockedCityIds.includes(def.cityId)) {
    return fail('Ez a város még nincs feloldva.');
  }

  const cityEarned = state.cityEarnings[def.cityId] ?? 0;
  if (productState.level === 0 && cityEarned < def.unlockAtCityEarnings) {
    return fail('Még nem oldottad fel ezt a terméket.');
  }

  const { amount, cost } = resolveBuy(def, productState.level, state.cash, quantity);
  if (amount <= 0) return fail('Nincs elég pénzed.');
  if (cost > state.cash) return fail('Nincs elég pénzed.');

  state.cash -= cost;
  productState.level += amount;
  state.stats.totalLevelsBought += amount;

  return done({ amount, cost });
}

export function hireManager(state: GameState, productId: ProductId): ActionResult {
  const def = getProduct(productId);
  const productState = state.products[productId];
  if (!productState) return fail('Ismeretlen termék.');
  if (productState.hasManager) return fail('Már van menedzsere.');
  if (productState.level <= 0) return fail('Előbb vedd meg a terméket.');
  if (state.cash < def.managerCost) return fail('Nincs elég pénzed a menedzserre.');

  state.cash -= def.managerCost;
  productState.hasManager = true;
  state.stats.managersHired += 1;
  return ok;
}

/** A legolcsóbb menedzser nélküli termék automatizálása (Food Coin vásárlás). */
export function grantCheapestManager(state: GameState): ActionResult<string> {
  let best: { id: ProductId; cost: number } | null = null;

  for (const cityId of state.unlockedCityIds) {
    for (const def of productsOfCity(cityId)) {
      const productState = state.products[def.id];
      if (!productState || productState.level <= 0 || productState.hasManager) continue;
      if (!best || def.managerCost < best.cost) best = { id: def.id, cost: def.managerCost };
    }
  }

  if (!best) return fail('Minden termékednek van már menedzsere.');

  const productState = state.products[best.id];
  if (!productState) return fail('Ismeretlen termék.');
  productState.hasManager = true;
  state.stats.managersHired += 1;
  return done(getProduct(best.id).name);
}

// ---------------------------------------------------------------------------
// Gépek és személyzet
// ---------------------------------------------------------------------------

export function buyEquipmentTier(state: GameState, equipmentId: string): ActionResult {
  const def = getEquipment(equipmentId);
  const owned = state.equipment[equipmentId] ?? 0;
  const tier = nextTier(def, owned);
  if (!tier) return fail('Ez a gép már a legmagasabb szinten van.');
  if (state.cash < tier.cost) return fail('Nincs elég pénzed.');

  state.cash -= tier.cost;
  state.equipment[equipmentId] = tier.tier;
  return ok;
}

export function hireStaffLevel(state: GameState, staffId: string): ActionResult {
  const def = getStaff(staffId);
  const level = state.staff[staffId] ?? 0;
  if (level >= def.maxLevel) return fail('Elérted a maximális szintet.');

  const cost = staffLevelCost(def, level);
  if (state.cash < cost) return fail('Nincs elég pénzed.');

  state.cash -= cost;
  state.staff[staffId] = level + 1;
  return ok;
}

// ---------------------------------------------------------------------------
// Városok
// ---------------------------------------------------------------------------

export function unlockCity(state: GameState, cityId: string): ActionResult {
  if (state.unlockedCityIds.includes(cityId)) return fail('Ez a város már a tiéd.');

  const city = getCity(cityId);
  if (state.stats.lifetimeEarnings < city.unlockRequiresLifetime) {
    return fail('Még nem kerestél eleget ehhez a városhoz.');
  }
  if (state.cash < city.unlockCost) return fail('Nincs elég pénzed a nyitáshoz.');

  state.cash -= city.unlockCost;
  state.unlockedCityIds.push(cityId);
  state.cityEarnings[cityId] = state.cityEarnings[cityId] ?? 0;
  state.activeCityId = cityId;
  state.stats.citiesUnlocked = state.unlockedCityIds.length;

  // Az új város első terméke ingyen jár, hogy azonnal induljon a termelés.
  const first = productsOfCity(cityId)[0];
  if (first) {
    const productState = state.products[first.id];
    if (productState && productState.level === 0) productState.level = 1;
  }

  return ok;
}

export function setActiveCity(state: GameState, cityId: string): ActionResult {
  if (!state.unlockedCityIds.includes(cityId)) return fail('Ez a város még nincs feloldva.');
  state.activeCityId = cityId;
  return ok;
}

// ---------------------------------------------------------------------------
// Küldetések, achievementek, ládák
// ---------------------------------------------------------------------------

export function claimQuest(
  state: GameState,
  questId: string,
  coinFind: number,
): ActionResult<number> {
  const quest = state.daily.quests.find((q) => q.questId === questId);
  if (!quest) return fail('Nincs ilyen küldetés.');
  if (quest.claimed) return fail('Ezt már felvetted.');

  const progress = questProgress(state, quest);
  if (!progress || !progress.complete) return fail('Ez a küldetés még nincs kész.');

  const def = getQuest(questId);
  const reward = Math.max(1, Math.round((def?.coinReward ?? 0) * coinFind));

  quest.claimed = true;
  state.coins += reward;
  state.stats.questsCompleted += 1;

  return done(reward);
}

export function claimDailyBonus(state: GameState): ActionResult<number> {
  if (state.daily.allClaimedBonusTaken) return fail('A napi bónuszt már felvetted.');
  if (!allQuestsClaimed(state)) return fail('Előbb teljesítsd az összes küldetést.');

  const reward = GAME_CONFIG.coins.dailyAllCompleteBonus;
  state.daily.allClaimedBonusTaken = true;
  state.coins += reward;
  return done(reward);
}

/** Kiosztja az újonnan teljesített achievementek jutalmát. */
export function grantAchievements(state: GameState): AchievementDef[] {
  const unlocked = findNewlyUnlockedAchievements(state);
  for (const def of unlocked) {
    state.unlockedAchievementIds.push(def.id);
    state.coins += def.coinReward;
  }
  return unlocked;
}

export function openCrate(
  state: GameState,
  wallMs: number,
  coinFind: number,
): ActionResult<CrateReward> {
  const reward = rollCrate(state, wallMs);

  switch (reward.kind) {
    case 'coins': {
      const amount = Math.max(1, Math.round(reward.amount * coinFind));
      state.coins += amount;
      state.stats.cratesOpened += 1;
      state.daily.cratesOpened += 1;
      return done({ kind: 'coins', amount });
    }
    case 'cash':
      creditEarnings(state, reward.amount);
      state.stats.cratesOpened += 1;
      state.daily.cratesOpened += 1;
      return done(reward);
    case 'booster':
      activateBooster(state, reward.booster, wallMs);
      state.stats.cratesOpened += 1;
      state.daily.cratesOpened += 1;
      return done(reward);
    default:
      return fail('Ismeretlen ládatartalom.');
  }
}

// ---------------------------------------------------------------------------
// Boosterek
// ---------------------------------------------------------------------------

const BOOSTER_SPECS: Record<
  Exclude<BoosterKey, 'event'>,
  { incomeMultiplier: number; cycleMultiplier: number; durationSeconds: number }
> = {
  doubleIncome: {
    incomeMultiplier: GAME_CONFIG.boosters.doubleIncome.multiplier,
    cycleMultiplier: 1,
    durationSeconds: GAME_CONFIG.boosters.doubleIncome.durationSeconds,
  },
  turbo: {
    incomeMultiplier: 1,
    cycleMultiplier: GAME_CONFIG.boosters.turbo.cycleMultiplier,
    durationSeconds: GAME_CONFIG.boosters.turbo.durationSeconds,
  },
  premiumRush: {
    incomeMultiplier: GAME_CONFIG.boosters.premiumRush.multiplier,
    cycleMultiplier: 1,
    durationSeconds: GAME_CONFIG.boosters.premiumRush.durationSeconds,
  },
};

/** Booster aktiválása. Azonos típus esetén az idő hozzáadódik (plafonnal). */
export function activateBooster(
  state: GameState,
  key: Exclude<BoosterKey, 'event'>,
  wallMs: number,
): void {
  const spec = BOOSTER_SPECS[key];
  const existing = state.boosters[key];
  const remaining = existing && existing.expiresAt > wallMs ? existing.expiresAt - wallMs : 0;
  const nextMs = Math.min(
    remaining + spec.durationSeconds * 1000,
    GAME_CONFIG.boosters.maxStackSeconds * 1000,
  );

  state.boosters[key] = {
    expiresAt: wallMs + nextMs,
    incomeMultiplier: spec.incomeMultiplier,
    cycleMultiplier: spec.cycleMultiplier,
  };
}

/** Lejárt boosterek eltakarítása – a mentés ne hízzon feleslegesen. */
export function pruneBoosters(state: GameState, wallMs: number): void {
  for (const key of Object.keys(state.boosters) as BoosterKey[]) {
    const booster = state.boosters[key];
    if (booster && booster.expiresAt <= wallMs) delete state.boosters[key];
  }
}

// ---------------------------------------------------------------------------
// Food Coin költés
// ---------------------------------------------------------------------------

export function spendCoins(
  state: GameState,
  spendId: string,
  wallMs: number,
): ActionResult<string> {
  const def = COIN_SPENDS.find((s) => s.id === spendId);
  if (!def) return fail('Ismeretlen ajánlat.');
  if (state.coins < def.coinCost) return fail('Nincs elég Food Coinod.');

  switch (def.kind.type) {
    case 'timeSkipHours': {
      const amount = timeSkipEarnings(state, def.kind.hours, wallMs);
      if (amount <= 0) {
        return fail('Előbb vegyél fel menedzsert – enélkül nincs mit felgyorsítani.');
      }
      state.coins -= def.coinCost;
      creditEarnings(state, amount);
      state.cityEarnings[state.activeCityId] =
        (state.cityEarnings[state.activeCityId] ?? 0) + amount;
      return done(`${def.kind.hours} óra bevétele jóváírva.`);
    }
    case 'booster':
      state.coins -= def.coinCost;
      activateBooster(state, def.kind.booster, wallMs);
      return done('Csúcsforgalom elindítva!');
    case 'instantManager': {
      const result = grantCheapestManager(state);
      if (!result.ok) return result;
      state.coins -= def.coinCost;
      return done(`${result.value} mostantól automatikus.`);
    }
    case 'cosmetic': {
      const cosmeticId = def.kind.cosmeticId;
      if (state.ownedCosmeticIds.includes(cosmeticId)) return fail('Ez már a tiéd.');
      state.coins -= def.coinCost;
      state.ownedCosmeticIds.push(cosmeticId);
      return done('Új kinézet feloldva!');
    }
    default:
      return fail('Ismeretlen ajánlat.');
  }
}

export function buyCosmetic(state: GameState, cosmeticId: string): ActionResult {
  const def = getCosmetic(cosmeticId);
  if (!def) return fail('Ismeretlen kinézet.');
  if (state.ownedCosmeticIds.includes(cosmeticId)) return fail('Ez már a tiéd.');
  if (state.coins < def.coinCost) return fail('Nincs elég Food Coinod.');

  state.coins -= def.coinCost;
  state.ownedCosmeticIds.push(cosmeticId);
  return ok;
}

export function equipCosmetic(state: GameState, cosmeticId: string): ActionResult {
  if (!state.ownedCosmeticIds.includes(cosmeticId)) return fail('Ez a kinézet nincs meg.');
  state.settings.activeCosmetic = cosmeticId;
  return ok;
}

// ---------------------------------------------------------------------------
// IAP jogosultságok
// ---------------------------------------------------------------------------

/**
 * Egy megvásárolt (vagy visszaállított) jogosultság alkalmazása.
 * Idempotens: ugyanazt a nem fogyó terméket többször alkalmazva sem ad
 * duplán – ez a `restorePurchases` miatt kritikus.
 */
export function applyEntitlement(
  state: GameState,
  entitlement: Entitlement,
  wallMs: number,
): ActionResult {
  if (state.entitlements.includes(entitlement)) return fail('Ez a vásárlás már aktív.');

  state.entitlements.push(entitlement);

  switch (entitlement) {
    case 'starterPack': {
      state.coins += 250;
      const amount = timeSkipEarnings(state, 4, wallMs);
      if (amount > 0) creditEarnings(state, amount);
      for (let i = 0; i < 3; i += 1) grantCheapestManager(state);
      break;
    }
    case 'goldenCounter':
      if (!state.ownedCosmeticIds.includes('cosmetic.gold')) {
        state.ownedCosmeticIds.push('cosmetic.gold');
      }
      break;
    case 'removeAds':
      break;
  }

  return ok;
}

/** Fogyó termék (érmecsomag) jóváírása. */
export function grantCoins(state: GameState, amount: number): ActionResult {
  if (!Number.isFinite(amount) || amount <= 0) return fail('Érvénytelen mennyiség.');
  state.coins += amount;
  return ok;
}

// ---------------------------------------------------------------------------
// Franchise (presztízs)
// ---------------------------------------------------------------------------

export function franchisePreview(state: GameState): { stars: number; canFranchise: boolean } {
  const stars = starsForRun(state.runEarnings);
  return {
    stars,
    canFranchise: stars > 0 && state.runEarnings >= GAME_CONFIG.franchise.minLifetimeToUnlock,
  };
}

/**
 * Franchise: a birodalom újraindul, de a csillagok, achievementek, perkek,
 * kozmetikák, Food Coinok és IAP-jogosultságok megmaradnak.
 */
export function doFranchise(state: GameState, wallMs: number): ActionResult<number> {
  const preview = franchisePreview(state);
  if (!preview.canFranchise) {
    return fail('Még nem gyűjtöttél eleget a franchise-hoz.');
  }

  const fresh = createInitialState(wallMs);

  // --- Amit megtartunk ---
  fresh.stars = state.stars + preview.stars;
  fresh.coins = state.coins;
  fresh.unlockedAchievementIds = [...state.unlockedAchievementIds];
  fresh.ownedPerkIds = [...state.ownedPerkIds];
  fresh.ownedCosmeticIds = [...state.ownedCosmeticIds];
  fresh.entitlements = [...state.entitlements];
  fresh.settings = { ...state.settings };
  fresh.daily = state.daily;
  fresh.ads = state.ads;
  fresh.rngState = state.rngState;
  fresh.franchiseCount = state.franchiseCount + 1;

  // A statisztikák közül a "lifetime" jellegűek átmennek, a futásspecifikusak nem.
  fresh.stats = {
    ...emptyStats(),
    lifetimeEarnings: state.stats.lifetimeEarnings,
    totalTaps: state.stats.totalTaps,
    totalLevelsBought: state.stats.totalLevelsBought,
    managersHired: state.stats.managersHired,
    franchiseCount: state.franchiseCount + 1,
    adsWatched: state.stats.adsWatched,
    questsCompleted: state.stats.questsCompleted,
    cratesOpened: state.stats.cratesOpened,
    citiesUnlocked: 1,
    runEarnings: 0,
  };

  // --- Indulótőke perk ---
  if (fresh.ownedPerkIds.includes('perk.head-start')) {
    fresh.cash += 25_000;
    const starter = fresh.products[Object.keys(fresh.products)[0] ?? ''];
    if (starter) starter.level = Math.max(starter.level, 4);
  }

  Object.assign(state, fresh);
  log.info('Franchise végrehajtva', { stars: preview.stars });

  return done(preview.stars);
}

export function buyPerk(state: GameState, perkId: string): ActionResult {
  const perk = getPerk(perkId);
  if (!perk) return fail('Ismeretlen fejlesztés.');

  const check = canBuyPerk(perk, state.stars, state.ownedPerkIds);
  if (!check.ok) return fail(check.reason ?? 'Most nem elérhető.');

  state.ownedPerkIds.push(perkId);
  return ok;
}

/** Az összes perk állapota a UI-nak. */
export function perkStatuses(state: GameState) {
  return FRANCHISE_PERKS.map((perk) => ({
    perk,
    owned: state.ownedPerkIds.includes(perk.id),
    ...canBuyPerk(perk, state.stars, state.ownedPerkIds),
  }));
}

// ---------------------------------------------------------------------------
// Beállítások
// ---------------------------------------------------------------------------

export function setBuyQuantity(state: GameState, quantity: BuyQuantity): void {
  state.settings.buyQuantity = quantity;
}

export function toggleSetting(
  state: GameState,
  key: 'sound' | 'haptics' | 'reducedMotion' | 'personalizedAds',
): void {
  state.settings[key] = !state.settings[key];
}

/**
 * Teljes törlés (Beállítások > Játék törlése). Kettős megerősítés a UI-ban.
 * A vásárolt IAP-jogosultságok megmaradnak, mert azok a store-hoz kötődnek,
 * és a `restorePurchases` úgyis visszahozná őket – jobb, ha nem tűnnek el.
 */
export function hardReset(state: GameState, wallMs: number): void {
  const entitlements = [...state.entitlements];
  const fresh = createInitialState(wallMs);
  fresh.entitlements = entitlements;
  if (entitlements.includes('goldenCounter')) {
    fresh.ownedCosmeticIds.push('cosmetic.gold');
  }
  fresh.settings.activeCosmetic = DEFAULT_COSMETIC_ID;
  Object.assign(state, fresh);
}

/** Csak teszthez / balance-riporthoz: a teljes szorzókészlet lekérése. */
export function debugMultipliers(state: GameState, wallMs: number) {
  return computeMultipliers(state, wallMs);
}

/** Egy termék halmozott árának lekérése – a UI tooltipjéhez. */
export function previewBulkCost(
  state: GameState,
  productId: ProductId,
  amount: number,
): number {
  const def = getProduct(productId);
  const level = state.products[productId]?.level ?? 0;
  return bulkCost(def, level, amount);
}

/** Az összes alkalmazott aktuális ára – a UI listájához. */
export function staffCosts(state: GameState): Record<string, number> {
  const costs: Record<string, number> = {};
  for (const def of STAFF) {
    costs[def.id] = staffLevelCost(def, state.staff[def.id] ?? 0);
  }
  return costs;
}
