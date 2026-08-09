import { Platform } from 'react-native';

import { IS_DEV } from '@/core/env';
import { log } from '@/core/logger';
import type {
  AdLoadState,
  AdProvider,
  InterstitialResult,
  RewardedPlacement,
  RewardedResult,
} from '@/services/ads/types';

/**
 * ÉLES ADMOB SZOLGÁLTATÓ
 *
 * A `react-native-google-mobile-ads` csomagot **futásidőben** tölti be, hogy
 * az app Expo Go-ban se essen szét (ott a natív modul nincs jelen). Ha a
 * betöltés nem sikerül, az `isAvailable()` false-t ad, és a hívó a mockra vált.
 *
 * TEENDŐK ÉLESÍTÉSHEZ (részletesen: docs/ADS_AND_IAP.md):
 *   1. npx expo install react-native-google-mobile-ads
 *   2. app.config.ts – kommentezd ki a plugin blokkot
 *   3. .env – töltsd ki az AD_UNIT azonosítókat
 *   4. npx expo prebuild --clean && eas build
 */

// A csomag nincs telepítve alapból, ezért minimális, saját típusleírást
// használunk. Ez pontosan az az API-felület, amit a játék használ.
type AdEventListener = () => void;

type RewardedAdInstance = {
  load(): void;
  show(): Promise<void>;
  addAdEventListener(type: string, listener: (payload?: unknown) => void): AdEventListener;
};

type InterstitialAdInstance = {
  load(): void;
  show(): Promise<void>;
  addAdEventListener(type: string, listener: (payload?: unknown) => void): AdEventListener;
};

type MobileAdsModule = {
  default: () => { initialize(): Promise<unknown> };
  RewardedAd: {
    createForAdRequest(unitId: string, options?: Record<string, unknown>): RewardedAdInstance;
  };
  InterstitialAd: {
    createForAdRequest(
      unitId: string,
      options?: Record<string, unknown>,
    ): InterstitialAdInstance;
  };
  TestIds: Record<string, string>;
  AdEventType: Record<string, string>;
  RewardedAdEventType: Record<string, string>;
  MaxAdContentRating: Record<string, string>;
};

let cachedModule: MobileAdsModule | null = null;
let moduleLoadAttempted = false;

function loadModule(): MobileAdsModule | null {
  if (moduleLoadAttempted) return cachedModule;
  moduleLoadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('react-native-google-mobile-ads') as MobileAdsModule;
  } catch {
    log.info('A react-native-google-mobile-ads nincs telepítve – mock reklámok futnak.');
    cachedModule = null;
  }
  return cachedModule;
}

/** Elérhető-e a natív AdMob modul ebben a buildben? */
export function isAdMobAvailable(): boolean {
  return loadModule() !== null;
}

/** A hirdetési egységek azonosítói. Fejlesztésben mindig a Google teszt-ID-k! */
function resolveUnitIds(mod: MobileAdsModule): {
  rewarded: string;
  interstitial: string;
} {
  if (IS_DEV) {
    return {
      rewarded: mod.TestIds.REWARDED ?? '',
      interstitial: mod.TestIds.INTERSTITIAL ?? '',
    };
  }

  const env = process.env;
  const rewarded =
    Platform.OS === 'ios' ? env.ADMOB_IOS_REWARDED : env.ADMOB_ANDROID_REWARDED;
  const interstitial =
    Platform.OS === 'ios' ? env.ADMOB_IOS_INTERSTITIAL : env.ADMOB_ANDROID_INTERSTITIAL;

  return {
    rewarded: rewarded ?? mod.TestIds.REWARDED ?? '',
    interstitial: interstitial ?? mod.TestIds.INTERSTITIAL ?? '',
  };
}

export class AdMobProvider implements AdProvider {
  readonly name = 'admob';

  private mod: MobileAdsModule | null = null;
  private unitIds = { rewarded: '', interstitial: '' };
  private personalized = false;

  private rewardedAds = new Map<
    RewardedPlacement,
    { ad: RewardedAdInstance; state: AdLoadState; cleanup: AdEventListener[] }
  >();
  private interstitialAd: {
    ad: InterstitialAdInstance;
    state: AdLoadState;
    cleanup: AdEventListener[];
  } | null = null;

  async initialize(options: { personalizedAds: boolean }): Promise<boolean> {
    const mod = loadModule();
    if (!mod) return false;

    this.mod = mod;
    this.personalized = options.personalizedAds;
    this.unitIds = resolveUnitIds(mod);

    try {
      await mod.default().initialize();
      log.info('AdMob inicializálva');
      return true;
    } catch (err) {
      log.warn('AdMob inicializálás sikertelen', err);
      return false;
    }
  }

  private requestOptions(): Record<string, unknown> {
    return {
      requestNonPersonalizedAdsOnly: !this.personalized,
      keywords: ['games', 'food', 'simulation'],
    };
  }

  preloadRewarded(placement: RewardedPlacement): void {
    const mod = this.mod;
    if (!mod || !this.unitIds.rewarded) return;

    const existing = this.rewardedAds.get(placement);
    if (existing && (existing.state === 'loading' || existing.state === 'ready')) return;

    existing?.cleanup.forEach((off) => off());

    const ad = mod.RewardedAd.createForAdRequest(this.unitIds.rewarded, this.requestOptions());
    const entry = { ad, state: 'loading' as AdLoadState, cleanup: [] as AdEventListener[] };

    entry.cleanup.push(
      ad.addAdEventListener(mod.RewardedAdEventType.LOADED ?? 'rewarded_loaded', () => {
        entry.state = 'ready';
      }),
      ad.addAdEventListener(mod.AdEventType.ERROR ?? 'error', (payload) => {
        entry.state = 'failed';
        log.warn(`Rewarded betöltési hiba (${placement})`, payload);
      }),
    );

    this.rewardedAds.set(placement, entry);
    try {
      ad.load();
    } catch (err) {
      entry.state = 'failed';
      log.warn('Rewarded load() dobott', err);
    }
  }

  preloadInterstitial(): void {
    const mod = this.mod;
    if (!mod || !this.unitIds.interstitial) return;
    if (this.interstitialAd?.state === 'loading' || this.interstitialAd?.state === 'ready') {
      return;
    }

    this.interstitialAd?.cleanup.forEach((off) => off());

    const ad = mod.InterstitialAd.createForAdRequest(
      this.unitIds.interstitial,
      this.requestOptions(),
    );
    const entry = { ad, state: 'loading' as AdLoadState, cleanup: [] as AdEventListener[] };

    entry.cleanup.push(
      ad.addAdEventListener(mod.AdEventType.LOADED ?? 'loaded', () => {
        entry.state = 'ready';
      }),
      ad.addAdEventListener(mod.AdEventType.ERROR ?? 'error', (payload) => {
        entry.state = 'failed';
        log.warn('Interstitial betöltési hiba', payload);
      }),
    );

    this.interstitialAd = entry;
    try {
      ad.load();
    } catch (err) {
      entry.state = 'failed';
      log.warn('Interstitial load() dobott', err);
    }
  }

  rewardedState(placement: RewardedPlacement): AdLoadState {
    return this.rewardedAds.get(placement)?.state ?? 'idle';
  }

  interstitialState(): AdLoadState {
    return this.interstitialAd?.state ?? 'idle';
  }

  /**
   * A jutalom jóváírása KIZÁRÓLAG az `EARNED_REWARD` eseményre történik.
   * A `CLOSED` esemény önmagában nem jutalom – ez a leggyakoribb hiba, amiért
   * a hálózatok szabálysértést jeleznek.
   */
  async showRewarded(placement: RewardedPlacement): Promise<RewardedResult> {
    const mod = this.mod;
    const entry = this.rewardedAds.get(placement);

    if (!mod || !entry || entry.state !== 'ready') {
      return { status: 'unavailable', reason: 'A videó még nem töltődött be.' };
    }

    return new Promise<RewardedResult>((resolve) => {
      let settled = false;
      let earned = false;
      const offs: AdEventListener[] = [];

      const finish = (result: RewardedResult) => {
        if (settled) return;
        settled = true;
        offs.forEach((off) => off());
        entry.state = 'idle';
        // Azonnal töltjük a következőt, hogy a gomb hamar újra aktív legyen.
        this.preloadRewarded(placement);
        resolve(result);
      };

      offs.push(
        entry.ad.addAdEventListener(
          mod.RewardedAdEventType.EARNED_REWARD ?? 'rewarded_earned_reward',
          () => {
            earned = true;
          },
        ),
        entry.ad.addAdEventListener(mod.AdEventType.CLOSED ?? 'closed', () => {
          finish(earned ? { status: 'earned' } : { status: 'dismissed' });
        }),
        entry.ad.addAdEventListener(mod.AdEventType.ERROR ?? 'error', (payload) => {
          finish({ status: 'error', reason: String(payload ?? 'ismeretlen hiba') });
        }),
      );

      entry.ad.show().catch((err: unknown) => {
        finish({ status: 'error', reason: String(err) });
      });

      // Biztonsági háló: ha egyetlen esemény sem érkezik (ritka SDK-hiba),
      // 3 perc után feloldjuk a promise-t, hogy a UI ne ragadjon be.
      setTimeout(() => finish({ status: 'dismissed' }), 180_000);
    });
  }

  async showInterstitial(): Promise<InterstitialResult> {
    const mod = this.mod;
    const entry = this.interstitialAd;

    if (!mod || !entry || entry.state !== 'ready') {
      return { status: 'skipped', reason: 'Nincs betöltött reklám.' };
    }

    return new Promise<InterstitialResult>((resolve) => {
      let settled = false;
      const offs: AdEventListener[] = [];

      const finish = (result: InterstitialResult) => {
        if (settled) return;
        settled = true;
        offs.forEach((off) => off());
        entry.state = 'idle';
        this.preloadInterstitial();
        resolve(result);
      };

      offs.push(
        entry.ad.addAdEventListener(mod.AdEventType.CLOSED ?? 'closed', () => {
          finish({ status: 'shown' });
        }),
        entry.ad.addAdEventListener(mod.AdEventType.ERROR ?? 'error', (payload) => {
          finish({ status: 'error', reason: String(payload ?? 'ismeretlen hiba') });
        }),
      );

      entry.ad.show().catch((err: unknown) => {
        finish({ status: 'error', reason: String(err) });
      });

      setTimeout(() => finish({ status: 'shown' }), 120_000);
    });
  }

  setPersonalizedAds(enabled: boolean): void {
    this.personalized = enabled;
    // A már betöltött reklámok a régi beállítással készültek, ezért eldobjuk
    // őket – a következő preload már az új hozzájárulással kér.
    for (const entry of this.rewardedAds.values()) {
      entry.cleanup.forEach((off) => off());
      entry.state = 'idle';
    }
    this.rewardedAds.clear();
    this.interstitialAd?.cleanup.forEach((off) => off());
    this.interstitialAd = null;
  }
}
