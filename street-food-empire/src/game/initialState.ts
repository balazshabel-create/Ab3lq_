import { GAME_CONFIG } from '@/config/gameConfig';
import { localDayKey } from '@/core/clock';
import { randomSeed } from '@/core/rng';
import { FIRST_CITY_ID } from '@/game/content/cities';
import { PRODUCTS, STARTER_PRODUCT_ID } from '@/game/content/products';
import { DEFAULT_COSMETIC_ID } from '@/game/content/shop';
import type { GameState, ProductId, ProductState, StatsState } from '@/game/types';

/** Minden statisztika nullázva – egy helyen, hogy ne maradjon ki kulcs. */
export function emptyStats(): StatsState {
  return {
    lifetimeEarnings: 0,
    runEarnings: 0,
    totalTaps: 0,
    totalLevelsBought: 0,
    managersHired: 0,
    citiesUnlocked: 1,
    franchiseCount: 0,
    adsWatched: 0,
    questsCompleted: 0,
    cratesOpened: 0,
  };
}

function emptyProducts(): Record<ProductId, ProductState> {
  const products: Record<ProductId, ProductState> = {};
  for (const def of PRODUCTS) {
    products[def.id] = { level: 0, hasManager: false, progress: 0, nextServeAt: 0 };
  }
  return products;
}

export function createInitialState(wallMs: number = Date.now()): GameState {
  const products = emptyProducts();

  // Az első termék ingyen jár: a játékosnak az első másodpercben legyen mit
  // koppintania. Enélkül az onboarding első lépése egy üres képernyő.
  const starter = products[STARTER_PRODUCT_ID];
  if (starter) starter.level = GAME_CONFIG.start.freeFirstProductLevels;

  return {
    version: GAME_CONFIG.saveVersion,

    cash: GAME_CONFIG.start.cash,
    coins: GAME_CONFIG.start.coins,
    stars: 0,

    activeCityId: FIRST_CITY_ID,
    unlockedCityIds: [FIRST_CITY_ID],
    cityEarnings: { [FIRST_CITY_ID]: 0 },

    products,
    equipment: {},
    staff: {},

    unlockedAchievementIds: [],
    ownedPerkIds: [],
    ownedCosmeticIds: [DEFAULT_COSMETIC_ID],
    entitlements: [],

    boosters: {},

    daily: {
      dayKey: localDayKey(wallMs),
      quests: [],
      allClaimedBonusTaken: false,
      interstitialsShown: 0,
      rewardedByPlacement: {},
      cratesOpened: 0,
    },

    stats: emptyStats(),

    ads: {
      lastInterstitialAt: 0,
      lastRewardedAt: 0,
      eventsSinceInterstitial: 0,
      nextFreeCrateAt: 0,
    },

    settings: {
      sound: true,
      haptics: true,
      reducedMotion: false,
      personalizedAds: false,
      buyQuantity: 1,
      activeCosmetic: DEFAULT_COSMETIC_ID,
    },

    lastSeenWallClock: wallMs,
    maxSeenWallClock: wallMs,
    rngState: randomSeed(),

    franchiseCount: 0,
    runEarnings: 0,
  };
}
