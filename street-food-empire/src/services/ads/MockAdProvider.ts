import { log } from '@/core/logger';
import type {
  AdLoadState,
  AdProvider,
  InterstitialResult,
  RewardedPlacement,
  RewardedResult,
} from '@/services/ads/types';

/**
 * Fejlesztői reklámszolgáltató.
 *
 * Expo Go-ban és teszteléskor ez fut. Szándékosan **valósághűen** viselkedik:
 *  - a betöltés nem azonnali (késleltetve vált `ready`-re),
 *  - a videó megtekintése időt vesz igénybe,
 *  - és `failureRate` valószínűséggel el is bukik.
 *
 * Ez azért fontos, mert a legtöbb reklámmal kapcsolatos hiba (dupla jutalom,
 * beragadt gomb, jutalom nélküli bezárás) csak akkor jön elő, ha a mock nem
 * ideális. Így a hibákat fejlesztés közben találjuk meg, nem éles reklámokkal.
 */
export class MockAdProvider implements AdProvider {
  readonly name = 'mock';

  private rewarded = new Map<RewardedPlacement, AdLoadState>();
  private interstitial: AdLoadState = 'idle';
  private personalized = false;

  constructor(
    private readonly options: {
      /** Betöltési idő ms-ban. */
      loadMs?: number;
      /** Videó hossza ms-ban. */
      watchMs?: number;
      /** Betöltési hiba valószínűsége 0..1. */
      failureRate?: number;
      /** Annak esélye, hogy a felhasználó jutalom előtt bezárja. */
      dismissRate?: number;
    } = {},
  ) {}

  async initialize(options: { personalizedAds: boolean }): Promise<boolean> {
    this.personalized = options.personalizedAds;
    log.info('MockAdProvider inicializálva (nincs valódi reklám)');
    return true;
  }

  preloadRewarded(placement: RewardedPlacement): void {
    if (this.rewarded.get(placement) === 'loading') return;
    if (this.rewarded.get(placement) === 'ready') return;

    this.rewarded.set(placement, 'loading');
    setTimeout(() => {
      const failed = Math.random() < (this.options.failureRate ?? 0.05);
      this.rewarded.set(placement, failed ? 'failed' : 'ready');
    }, this.options.loadMs ?? 800);
  }

  preloadInterstitial(): void {
    if (this.interstitial === 'loading' || this.interstitial === 'ready') return;
    this.interstitial = 'loading';
    setTimeout(() => {
      this.interstitial = Math.random() < (this.options.failureRate ?? 0.05) ? 'failed' : 'ready';
    }, this.options.loadMs ?? 800);
  }

  rewardedState(placement: RewardedPlacement): AdLoadState {
    return this.rewarded.get(placement) ?? 'idle';
  }

  interstitialState(): AdLoadState {
    return this.interstitial;
  }

  async showRewarded(placement: RewardedPlacement): Promise<RewardedResult> {
    if (this.rewarded.get(placement) !== 'ready') {
      return { status: 'unavailable', reason: 'A videó még nem töltődött be.' };
    }

    this.rewarded.set(placement, 'idle');
    await delay(this.options.watchMs ?? 400);

    // A mockban a jutalom szinte mindig jár; a bezárást külön teszteljük.
    if (Math.random() < (this.options.dismissRate ?? 0)) {
      this.preloadRewarded(placement);
      return { status: 'dismissed' };
    }

    this.preloadRewarded(placement);
    return { status: 'earned' };
  }

  async showInterstitial(): Promise<InterstitialResult> {
    if (this.interstitial !== 'ready') {
      return { status: 'skipped', reason: 'Nincs betöltött reklám.' };
    }
    this.interstitial = 'idle';
    await delay(this.options.watchMs ?? 400);
    this.preloadInterstitial();
    return { status: 'shown' };
  }

  setPersonalizedAds(enabled: boolean): void {
    this.personalized = enabled;
    log.debug('Mock: személyre szabott reklám', enabled);
  }

  /** Csak teszthez. */
  get isPersonalized(): boolean {
    return this.personalized;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
