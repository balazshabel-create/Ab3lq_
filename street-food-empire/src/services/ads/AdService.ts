import { GAME_CONFIG } from '@/config/gameConfig';
import { log } from '@/core/logger';
import type { GameState } from '@/game/types';
import { AdMobProvider, isAdMobAvailable } from '@/services/ads/AdMobProvider';
import { MockAdProvider } from '@/services/ads/MockAdProvider';
import type { AdProvider, RewardedPlacement } from '@/services/ads/types';

/**
 * REKLÁM-HÁZIREND
 *
 * Ez a réteg dönti el, hogy **szabad-e** reklámot mutatni – függetlenül attól,
 * hogy van-e betöltve. A cél egy olyan élmény, ami nem idegesítő és nem sérti
 * a store-ok szabályzatát:
 *
 *  ❌ Nincs reklám az app indítása utáni első 2 percben.
 *  ❌ Nincs reklám két perccel egy másik reklám után.
 *  ❌ Nincs reklám vásárlás/jutalom ablak közben.
 *  ❌ Nincs interstitial, ha a játékos megvette a reklámmentességet.
 *  ✅ Interstitial csak "természetes szünetnél" (városnyitás, franchise) és
 *     legalább 8 jelentős esemény után.
 *  ✅ Jutalomvideó MINDIG opcionális, és mindig a játékos indítja.
 *
 * A rewarded videók akkor is elérhetők maradnak, ha a játékos megvette a
 * reklámmentességet – ilyenkor a jutalom videó NÉLKÜL jár (lásd
 * `rewardIsFree`). Ez tisztességes: a fizető játékos nem járhat rosszabbul.
 */

// ---------------------------------------------------------------------------
// Szolgáltató-kezelés
// ---------------------------------------------------------------------------

class AdServiceImpl {
  private provider: AdProvider = new MockAdProvider();
  private initialized = false;
  private sessionStartedAt = Date.now();
  /** Igaz, amíg egy reklám a képernyőn van – így nem indul másik. */
  private showing = false;

  async initialize(personalizedAds: boolean): Promise<void> {
    if (this.initialized) return;
    this.sessionStartedAt = Date.now();

    if (isAdMobAvailable()) {
      const admob = new AdMobProvider();
      const ready = await admob.initialize({ personalizedAds });
      if (ready) {
        this.provider = admob;
        log.info('Ad provider: AdMob');
      } else {
        log.warn('AdMob did not start, staying on the mock.');
      }
    } else {
      await this.provider.initialize({ personalizedAds });
      log.info('Ad provider: mock (no native SDK)');
    }

    this.initialized = true;
    this.preloadAll();
  }

  /** Minden reklámhely előtöltése. Hívjuk indításkor és jutalom után. */
  preloadAll(): void {
    const placements: RewardedPlacement[] = [
      'doubleIncome',
      'turbo',
      'freeCrate',
      'offlineBoost',
    ];
    for (const placement of placements) this.provider.preloadRewarded(placement);
    this.provider.preloadInterstitial();
  }

  get name(): string {
    return this.provider.name;
  }

  get isMock(): boolean {
    return this.provider.name === 'mock';
  }

  get isShowing(): boolean {
    return this.showing;
  }

  get sessionAgeSeconds(): number {
    return (Date.now() - this.sessionStartedAt) / 1000;
  }

  rewardedReady(placement: RewardedPlacement): boolean {
    return this.provider.rewardedState(placement) === 'ready';
  }

  setPersonalizedAds(enabled: boolean): void {
    this.provider.setPersonalizedAds(enabled);
    this.preloadAll();
  }

  async showRewarded(placement: RewardedPlacement) {
    if (this.showing) {
      return { status: 'unavailable' as const, reason: 'An ad is already running.' };
    }
    this.showing = true;
    try {
      return await this.provider.showRewarded(placement);
    } finally {
      this.showing = false;
    }
  }

  async showInterstitial() {
    if (this.showing) {
      return { status: 'skipped' as const, reason: 'An ad is already running.' };
    }
    this.showing = true;
    try {
      return await this.provider.showInterstitial();
    } finally {
      this.showing = false;
    }
  }

  /** Csak teszthez: a szolgáltató cseréje. */
  setProviderForTesting(provider: AdProvider): void {
    this.provider = provider;
    this.initialized = true;
  }

  /** Csak teszthez: a session-óra visszaállítása. */
  resetSessionForTesting(startedAt: number): void {
    this.sessionStartedAt = startedAt;
  }
}

export const adService = new AdServiceImpl();

// ---------------------------------------------------------------------------
// Házirend (tiszta függvények – tesztelhetők)
// ---------------------------------------------------------------------------

export type AdGate = { allowed: boolean; reason?: string };

/**
 * Két időbélyeg között eltelt másodpercek.
 *
 * A 0 érték jelentése „még soha” (ez az induló állapot), ezért végtelent
 * adunk vissza — enélkül egy nulla időbélyeg úgy viselkedne, mintha épp most
 * történt volna, és 1970-hez közeli órán (tesztek, hibás mentés) örökre
 * letiltaná a reklámokat.
 */
function secondsSince(timestamp: number, nowMs: number): number {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return (nowMs - timestamp) / 1000;
}

/** Megvette-e a játékos a reklámmentességet? */
export function hasRemoveAds(state: GameState): boolean {
  return state.entitlements.includes('removeAds');
}

/**
 * A jutalom videó nélkül jár-e? Igen, ha a játékos fizetett a
 * reklámmentességért. Ilyenkor a gomb ugyanott van, ugyanazt adja, csak
 * nem indul videó.
 */
export function rewardIsFree(state: GameState): boolean {
  return hasRemoveAds(state);
}

export function canShowInterstitial(
  state: GameState,
  wallMs: number,
  sessionAgeSeconds: number,
): AdGate {
  if (hasRemoveAds(state)) return { allowed: false, reason: 'Ad-free version.' };

  const rules = GAME_CONFIG.ads.interstitial;

  if (sessionAgeSeconds < rules.sessionGraceSeconds) {
    return { allowed: false, reason: 'Too early in the session.' };
  }
  if (state.daily.interstitialsShown >= rules.dailyCap) {
    return { allowed: false, reason: 'Daily limit reached.' };
  }
  const sinceLast = secondsSince(state.ads.lastInterstitialAt, wallMs);
  if (sinceLast < rules.cooldownSeconds) {
    return { allowed: false, reason: 'The break between two ads is still running.' };
  }
  // A jutalomvideó után sem jöhet azonnal interstitial – ez a legidegesítőbb
  // minta, amit egy idle játék csinálhat.
  const sinceRewarded = secondsSince(state.ads.lastRewardedAt, wallMs);
  if (sinceRewarded < rules.cooldownSeconds) {
    return { allowed: false, reason: 'A rewarded video was watched recently.' };
  }
  if (state.ads.eventsSinceInterstitial < rules.everyNthEvent) {
    return { allowed: false, reason: 'Not enough has happened yet.' };
  }

  return { allowed: true };
}

export function canShowRewarded(
  state: GameState,
  placement: RewardedPlacement,
  wallMs: number,
): AdGate {
  const rules = GAME_CONFIG.ads.rewarded;

  const usedToday = state.daily.rewardedByPlacement[placement] ?? 0;
  if (usedToday >= rules.dailyCapPerPlacement) {
    return { allowed: false, reason: 'Not available today, come back tomorrow!' };
  }

  const sinceLast = secondsSince(state.ads.lastRewardedAt, wallMs);
  if (sinceLast < rules.cooldownSeconds) {
    const wait = Math.ceil(rules.cooldownSeconds - sinceLast);
    return { allowed: false, reason: `${wait}s left.` };
  }

  return { allowed: true };
}

/** Elérhető-e az ingyen láda? */
export function canOpenFreeCrate(state: GameState, wallMs: number): AdGate {
  if (state.daily.cratesOpened >= GAME_CONFIG.ads.freeCrateDailyCap) {
    return { allowed: false, reason: 'No more crates today.' };
  }
  if (wallMs < state.ads.nextFreeCrateAt) {
    return { allowed: false, reason: 'Still loading.' };
  }
  return { allowed: true };
}

// --- Állapotfrissítők (a store hívja) ---

export function noteInterstitialShown(state: GameState, wallMs: number): void {
  state.ads.lastInterstitialAt = wallMs;
  state.ads.eventsSinceInterstitial = 0;
  state.daily.interstitialsShown += 1;
}

export function noteRewardedWatched(
  state: GameState,
  placement: RewardedPlacement,
  wallMs: number,
): void {
  state.ads.lastRewardedAt = wallMs;
  state.daily.rewardedByPlacement[placement] =
    (state.daily.rewardedByPlacement[placement] ?? 0) + 1;
  state.stats.adsWatched += 1;
}

export function noteFreeCrateOpened(state: GameState, wallMs: number): void {
  state.ads.nextFreeCrateAt = wallMs + GAME_CONFIG.ads.freeCrateCooldownSeconds * 1000;
}

/**
 * "Jelentős esemény": olyan játékbeli lépés, ami után természetes lenne egy
 * szünet. Ilyen a városnyitás, franchise, menedzserfelvétel – NEM ilyen egy
 * sima szintvásárlás vagy koppintás.
 */
export function noteSignificantEvent(state: GameState): void {
  state.ads.eventsSinceInterstitial += 1;
}
