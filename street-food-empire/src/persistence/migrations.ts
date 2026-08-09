import { GAME_CONFIG } from '@/config/gameConfig';
import { localDayKey } from '@/core/clock';
import { log } from '@/core/logger';
import { randomSeed } from '@/core/rng';
import { FIRST_CITY_ID } from '@/game/content/cities';
import { PRODUCTS } from '@/game/content/products';
import { DEFAULT_COSMETIC_ID } from '@/game/content/shop';
import { emptyStats } from '@/game/initialState';
import type { GameState } from '@/game/types';

/**
 * MENTÉS-MIGRÁCIÓK
 *
 * Szabály: egy megjelent verzió migrációját SOHA nem írjuk át, csak újat
 * teszünk a lánc végére. A `GAME_CONFIG.saveVersion` növelésével együtt kell
 * ide egy új lépést tenni.
 *
 * A migrációk a nyers, `unknown` típusú objektumon dolgoznak, mert a régi
 * mentés alakja definíció szerint eltér a mai típustól.
 */

type RawSave = Record<string, unknown>;

type Migration = {
  /** Ebből a verzióból... */
  from: number;
  /** ...ebbe a verzióba. */
  to: number;
  migrate: (save: RawSave) => RawSave;
};

const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    migrate: (save) => {
      // v2: bevezettük a franchise rendszert és az RNG-állapotot.
      return {
        ...save,
        stars: typeof save.stars === 'number' ? save.stars : 0,
        ownedPerkIds: Array.isArray(save.ownedPerkIds) ? save.ownedPerkIds : [],
        franchiseCount: typeof save.franchiseCount === 'number' ? save.franchiseCount : 0,
        runEarnings: typeof save.runEarnings === 'number' ? save.runEarnings : 0,
        rngState: typeof save.rngState === 'number' ? save.rngState : randomSeed(),
      };
    },
  },
  {
    from: 2,
    to: 3,
    migrate: (save) => {
      // v3: a boosterek külön kulcsokra bomlottak, és bejött a coinFind.
      const legacy = save.activeBooster as
        | { expiresAt?: number; multiplier?: number }
        | undefined;

      const boosters: Record<string, unknown> = {};
      if (legacy && typeof legacy.expiresAt === 'number' && legacy.expiresAt > Date.now()) {
        boosters.doubleIncome = {
          expiresAt: legacy.expiresAt,
          incomeMultiplier: legacy.multiplier ?? 2,
          cycleMultiplier: 1,
        };
      }

      const next: RawSave = { ...save, boosters };
      delete next.activeBooster;
      return next;
    },
  },
];

/** Végigfuttatja a migrációs láncot. Hibát dob, ha nem tud a mai verzióig eljutni. */
export function migrate(raw: RawSave): RawSave {
  let current = raw;
  let version = typeof current.version === 'number' ? current.version : 1;

  let guard = 0;
  while (version < GAME_CONFIG.saveVersion) {
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) {
      throw new Error(`Nincs migráció a(z) ${version}. verzióról.`);
    }
    current = step.migrate(current);
    version = step.to;
    current.version = version;

    guard += 1;
    if (guard > 50) throw new Error('Végtelen migrációs ciklus.');
  }

  if (version > GAME_CONFIG.saveVersion) {
    // Újabb mentés régebbi apphoz: nem próbáljuk visszafelé konvertálni.
    throw new Error(
      `A mentés újabb (${version}), mint az alkalmazás (${GAME_CONFIG.saveVersion}).`,
    );
  }

  return current;
}

/**
 * Séma-helyreállítás: a migráció után is előfordulhat, hogy hiányzik egy mező
 * (kézzel szerkesztett mentés, félbeszakadt írás, új tartalom). Ez a függvény
 * garantálja, hogy a visszaadott objektum **minden** kötelező mezőt tartalmaz,
 * és a típusok stimmelnek. Innentől a játék biztonságosan futhat.
 */
export function coerceToGameState(raw: RawSave, wallMs: number): GameState {
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

  const strArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  const rawProducts = (raw.products ?? {}) as Record<string, unknown>;
  const products: GameState['products'] = {};
  for (const def of PRODUCTS) {
    const entry = rawProducts[def.id] as Record<string, unknown> | undefined;
    products[def.id] = {
      level: Math.max(0, Math.floor(num(entry?.level, 0))),
      hasManager: bool(entry?.hasManager, false),
      progress: Math.min(1, Math.max(0, num(entry?.progress, 0))),
      nextServeAt: Math.max(0, num(entry?.nextServeAt, 0)),
    };
  }

  const unlockedCityIds = strArray(raw.unlockedCityIds);
  if (unlockedCityIds.length === 0) unlockedCityIds.push(FIRST_CITY_ID);

  const rawStats = (raw.stats ?? {}) as Record<string, unknown>;
  const stats = emptyStats();
  for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
    stats[key] = Math.max(0, num(rawStats[key], 0));
  }
  stats.citiesUnlocked = Math.max(stats.citiesUnlocked, unlockedCityIds.length);

  const rawSettings = (raw.settings ?? {}) as Record<string, unknown>;
  const rawDaily = (raw.daily ?? {}) as Record<string, unknown>;
  const rawAds = (raw.ads ?? {}) as Record<string, unknown>;

  const numericRecord = (value: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      }
    }
    return out;
  };

  const buyQuantity = rawSettings.buyQuantity;
  const validQuantity =
    buyQuantity === 1 || buyQuantity === 10 || buyQuantity === 100 || buyQuantity === 'max'
      ? buyQuantity
      : 1;

  const activeCityId =
    typeof raw.activeCityId === 'string' && unlockedCityIds.includes(raw.activeCityId)
      ? raw.activeCityId
      : (unlockedCityIds[0] ?? FIRST_CITY_ID);

  const lastSeen = num(raw.lastSeenWallClock, wallMs);

  return {
    version: GAME_CONFIG.saveVersion,

    cash: Math.max(0, num(raw.cash, GAME_CONFIG.start.cash)),
    coins: Math.max(0, num(raw.coins, GAME_CONFIG.start.coins)),
    stars: Math.max(0, num(raw.stars, 0)),

    activeCityId,
    unlockedCityIds,
    cityEarnings: numericRecord(raw.cityEarnings),

    products,
    equipment: numericRecord(raw.equipment),
    staff: numericRecord(raw.staff),

    unlockedAchievementIds: strArray(raw.unlockedAchievementIds),
    ownedPerkIds: strArray(raw.ownedPerkIds),
    ownedCosmeticIds:
      strArray(raw.ownedCosmeticIds).length > 0
        ? strArray(raw.ownedCosmeticIds)
        : [DEFAULT_COSMETIC_ID],
    entitlements: strArray(raw.entitlements) as GameState['entitlements'],

    boosters: (raw.boosters ?? {}) as GameState['boosters'],

    daily: {
      dayKey: typeof rawDaily.dayKey === 'string' ? rawDaily.dayKey : localDayKey(wallMs),
      quests: Array.isArray(rawDaily.quests)
        ? (rawDaily.quests as GameState['daily']['quests'])
        : [],
      allClaimedBonusTaken: bool(rawDaily.allClaimedBonusTaken, false),
      interstitialsShown: Math.max(0, num(rawDaily.interstitialsShown, 0)),
      rewardedByPlacement: numericRecord(rawDaily.rewardedByPlacement),
      cratesOpened: Math.max(0, num(rawDaily.cratesOpened, 0)),
    },

    stats,

    ads: {
      lastInterstitialAt: num(rawAds.lastInterstitialAt, 0),
      lastRewardedAt: num(rawAds.lastRewardedAt, 0),
      eventsSinceInterstitial: Math.max(0, num(rawAds.eventsSinceInterstitial, 0)),
      nextFreeCrateAt: num(rawAds.nextFreeCrateAt, 0),
    },

    settings: {
      sound: bool(rawSettings.sound, true),
      haptics: bool(rawSettings.haptics, true),
      reducedMotion: bool(rawSettings.reducedMotion, false),
      personalizedAds: bool(rawSettings.personalizedAds, false),
      buyQuantity: validQuantity,
      activeCosmetic:
        typeof rawSettings.activeCosmetic === 'string'
          ? rawSettings.activeCosmetic
          : DEFAULT_COSMETIC_ID,
    },

    lastSeenWallClock: lastSeen,
    // A magas vízszint sosem lehet kisebb az utolsó látott időnél.
    maxSeenWallClock: Math.max(num(raw.maxSeenWallClock, lastSeen), lastSeen),
    rngState: num(raw.rngState, randomSeed()) >>> 0,

    franchiseCount: Math.max(0, num(raw.franchiseCount, 0)),
    runEarnings: Math.max(0, num(raw.runEarnings, 0)),
  };
}

export function migrateAndCoerce(raw: RawSave, wallMs: number): GameState {
  const migrated = migrate(raw);
  const state = coerceToGameState(migrated, wallMs);
  log.debug('Mentés migrálva és normalizálva', { version: state.version });
  return state;
}
