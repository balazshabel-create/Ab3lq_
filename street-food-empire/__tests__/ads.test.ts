import { GAME_CONFIG } from '@/config/gameConfig';
import { createInitialState } from '@/game/initialState';
import {
  canOpenFreeCrate,
  canShowInterstitial,
  canShowRewarded,
  MockAdProvider,
  noteFreeCrateOpened,
  noteInterstitialShown,
  noteRewardedWatched,
  noteSignificantEvent,
  rewardIsFree,
} from '@/services/ads';

const GRACE = GAME_CONFIG.ads.interstitial.sessionGraceSeconds;

/** Valósághű óraállás (2026. március 2.) – nem 0 epoch. */
const NOW = 1_772_409_600_000;

/** Olyan állapot, ahol az interstitial minden feltétele teljesül. */
function readyForInterstitial() {
  const state = createInitialState(NOW);
  state.ads.eventsSinceInterstitial = GAME_CONFIG.ads.interstitial.everyNthEvent;
  return state;
}

describe('interstitial házirend', () => {
  it('a munkamenet elején nem jelenhet meg', () => {
    const state = readyForInterstitial();
    expect(canShowInterstitial(state, NOW, GRACE - 1).allowed).toBe(false);
    expect(canShowInterstitial(state, NOW, GRACE + 1).allowed).toBe(true);
  });

  it('nem jelenik meg elég esemény nélkül', () => {
    const state = createInitialState(NOW);
    state.ads.eventsSinceInterstitial = 0;
    expect(canShowInterstitial(state, NOW, GRACE + 1).allowed).toBe(false);

    for (let i = 0; i < GAME_CONFIG.ads.interstitial.everyNthEvent; i += 1) {
      noteSignificantEvent(state);
    }
    expect(canShowInterstitial(state, NOW, GRACE + 1).allowed).toBe(true);
  });

  it('betartja a két reklám közti szünetet', () => {
    const state = readyForInterstitial();
    const now = 10_000_000;

    noteInterstitialShown(state, now);
    state.ads.eventsSinceInterstitial = GAME_CONFIG.ads.interstitial.everyNthEvent;

    const cooldownMs = GAME_CONFIG.ads.interstitial.cooldownSeconds * 1000;
    expect(canShowInterstitial(state, now + cooldownMs - 1000, GRACE + 1).allowed).toBe(false);
    expect(canShowInterstitial(state, now + cooldownMs + 1000, GRACE + 1).allowed).toBe(true);
  });

  it('jutalomvideó után nem jön azonnal interstitial', () => {
    const state = readyForInterstitial();
    const now = 10_000_000;
    noteRewardedWatched(state, 'doubleIncome', now);

    expect(canShowInterstitial(state, now + 1000, GRACE + 1).allowed).toBe(false);
  });

  it('betartja a napi limitet', () => {
    const state = readyForInterstitial();
    state.daily.interstitialsShown = GAME_CONFIG.ads.interstitial.dailyCap;
    expect(canShowInterstitial(state, 1e9, GRACE + 1).allowed).toBe(false);
  });

  it('a reklámmentesség teljesen kikapcsolja', () => {
    const state = readyForInterstitial();
    state.entitlements.push('removeAds');
    expect(canShowInterstitial(state, 1e9, GRACE + 1).allowed).toBe(false);
  });
});

describe('jutalomvideó házirend', () => {
  it('alapból elérhető', () => {
    const state = createInitialState(NOW);
    expect(canShowRewarded(state, 'doubleIncome', 1e9).allowed).toBe(true);
  });

  it('a napi limit felett nem elérhető', () => {
    const state = createInitialState(NOW);
    state.daily.rewardedByPlacement.doubleIncome =
      GAME_CONFIG.ads.rewarded.dailyCapPerPlacement;

    expect(canShowRewarded(state, 'doubleIncome', 1e9).allowed).toBe(false);
    // ...de a másik reklámhely igen (helyenként külön limit)
    expect(canShowRewarded(state, 'turbo', 1e9).allowed).toBe(true);
  });

  it('betartja a rövid szünetet két videó között', () => {
    const state = createInitialState(NOW);
    const now = 1e9;
    noteRewardedWatched(state, 'turbo', now);

    expect(canShowRewarded(state, 'turbo', now + 1000).allowed).toBe(false);
    expect(
      canShowRewarded(state, 'turbo', now + GAME_CONFIG.ads.rewarded.cooldownSeconds * 1000 + 1)
        .allowed,
    ).toBe(true);
  });

  it('reklámmentes vásárlóknak a jutalom videó nélkül jár', () => {
    const state = createInitialState(NOW);
    expect(rewardIsFree(state)).toBe(false);

    state.entitlements.push('removeAds');
    expect(rewardIsFree(state)).toBe(true);
    // ...és a jutalomhely továbbra is elérhető marad
    expect(canShowRewarded(state, 'doubleIncome', 1e9).allowed).toBe(true);
  });

  it('a megtekintés növeli a statisztikát', () => {
    const state = createInitialState(NOW);
    noteRewardedWatched(state, 'freeCrate', 1e9);
    expect(state.stats.adsWatched).toBe(1);
    expect(state.daily.rewardedByPlacement.freeCrate).toBe(1);
  });
});

describe('ingyen láda', () => {
  it('elsőre elérhető, utána visszatöltődik', () => {
    const state = createInitialState(NOW);
    const now = 1e9;

    expect(canOpenFreeCrate(state, now).allowed).toBe(true);

    noteFreeCrateOpened(state, now);
    expect(canOpenFreeCrate(state, now + 1000).allowed).toBe(false);
    expect(
      canOpenFreeCrate(state, now + GAME_CONFIG.ads.freeCrateCooldownSeconds * 1000 + 1).allowed,
    ).toBe(true);
  });

  it('betartja a napi limitet', () => {
    const state = createInitialState(NOW);
    state.daily.cratesOpened = GAME_CONFIG.ads.freeCrateDailyCap;
    expect(canOpenFreeCrate(state, 1e12).allowed).toBe(false);
  });
});

describe('mock reklámszolgáltató', () => {
  it('betöltés nélkül nem ad jutalmat', async () => {
    const provider = new MockAdProvider({ loadMs: 10, watchMs: 1, failureRate: 0 });
    await provider.initialize({ personalizedAds: false });

    const result = await provider.showRewarded('doubleIncome');
    expect(result.status).toBe('unavailable');
  });

  it('betöltés után jutalmat ad', async () => {
    const provider = new MockAdProvider({ loadMs: 5, watchMs: 1, failureRate: 0 });
    await provider.initialize({ personalizedAds: false });

    provider.preloadRewarded('doubleIncome');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(provider.rewardedState('doubleIncome')).toBe('ready');
    const result = await provider.showRewarded('doubleIncome');
    expect(result.status).toBe('earned');
  });

  it('a bezárást külön státuszként jelzi', async () => {
    const provider = new MockAdProvider({
      loadMs: 5,
      watchMs: 1,
      failureRate: 0,
      dismissRate: 1,
    });
    await provider.initialize({ personalizedAds: false });

    provider.preloadRewarded('turbo');
    await new Promise((resolve) => setTimeout(resolve, 30));

    const result = await provider.showRewarded('turbo');
    expect(result.status).toBe('dismissed');
  });
});
