/**
 * REKLÁM-ABSZTRAKCIÓ
 *
 * A játék SOHA nem hívja közvetlenül az AdMob SDK-t. Mindig ezen az
 * interfészen keresztül megy, aminek két megvalósítása van:
 *
 *  - `MockAdProvider`  – fejlesztéshez és Expo Go-hoz. Azonnal "sikeres"
 *    reklámot szimulál, így a teljes jutalom-folyamat tesztelhető SDK nélkül.
 *  - `AdMobProvider`   – éles. Csak akkor töltődik be, ha a natív modul jelen
 *    van (dev client / EAS build).
 *
 * Ezért lehet a játékot végig fejleszteni és tesztelni anélkül, hogy egyetlen
 * natív buildet kellene csinálni, és ezért cserélhető később másik hálózatra
 * (Ad Manager, AppLovin, ironSource) egyetlen fájl megírásával.
 */

/** Hol kérünk jutalomvideót. Minden helynek külön napi limitje van. */
export type RewardedPlacement =
  | 'doubleIncome'
  | 'turbo'
  | 'freeCrate'
  | 'offlineBoost'
  | 'questReroll';

export type AdLoadState = 'idle' | 'loading' | 'ready' | 'failed';

export type RewardedResult =
  | { status: 'earned' }
  /** A felhasználó bezárta a videót a jutalom előtt – ez NEM hiba. */
  | { status: 'dismissed' }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; reason: string };

export type InterstitialResult =
  | { status: 'shown' }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; reason: string };

export interface AdProvider {
  readonly name: string;

  /** Egyszeri inicializálás. Sose dobjon – hibát `false`-szal jelez. */
  initialize(options: { personalizedAds: boolean }): Promise<boolean>;

  /** Előtöltés. A jutalomvideó gomb csak akkor aktív, ha `ready`. */
  preloadRewarded(placement: RewardedPlacement): void;
  preloadInterstitial(): void;

  rewardedState(placement: RewardedPlacement): AdLoadState;
  interstitialState(): AdLoadState;

  showRewarded(placement: RewardedPlacement): Promise<RewardedResult>;
  showInterstitial(): Promise<InterstitialResult>;

  /** GDPR / ATT hozzájárulás frissítése futás közben. */
  setPersonalizedAds(enabled: boolean): void;
}

/** A jutalomhelyekhez tartozó, játékosnak szóló szövegek. */
export const REWARDED_LABELS: Record<RewardedPlacement, { title: string; body: string }> = {
  doubleIncome: {
    title: 'Dupla bevétel',
    body: '15 percig minden termék kétszer annyit hoz.',
  },
  turbo: {
    title: 'Turbó műszak',
    body: '10 percig feleannyi idő alatt készül el minden.',
  },
  freeCrate: {
    title: 'Ingyen láda',
    body: 'Food Coin, pénz vagy egy véletlen booster.',
  },
  offlineBoost: {
    title: 'Dupla offline bevétel',
    body: 'A most kapott offline összeg megduplázódik.',
  },
  questReroll: {
    title: 'Új küldetés',
    body: 'Cseréld le a mai küldetéseid egyikét.',
  },
};
