import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { GAME_CONFIG } from '@/config/gameConfig';
import { systemClock } from '@/core/clock';
import { log } from '@/core/logger';
import * as actions from '@/game/actions';
import { getProduct } from '@/game/content/products';
import { getIapProduct } from '@/game/content/shop';
import { createInitialState } from '@/game/initialState';
import {
  applyOfflineEarnings,
  computeOfflineReport,
  shouldShowOfflineModal,
  type OfflineReport,
} from '@/game/offline';
import {
  createCustomerWorld,
  markServed,
  resetCustomerWorld,
  tickCustomers,
  type Customer,
  type CustomerWorld,
} from '@/game/customers';
import { refreshDailyIfNeeded } from '@/game/progression';
import { computeMultipliers, totalIncomePerSecond } from '@/game/selectors';
import { serveByHand, simulateTick } from '@/game/simulate';
import { cycleSeconds } from '@/game/economy';
import type {
  AchievementDef,
  BuyQuantity,
  Entitlement,
  GameState,
  Multipliers,
  ProductId,
} from '@/game/types';
import { SaveScheduler, loadGame, saveGame } from '@/persistence/save';
import {
  adService,
  canOpenFreeCrate,
  canShowInterstitial,
  canShowRewarded,
  noteFreeCrateOpened,
  noteInterstitialShown,
  noteRewardedWatched,
  noteSignificantEvent,
  rewardIsFree,
  type RewardedPlacement,
} from '@/services/ads';
import { setHapticsEnabled, successFeedback, errorFeedback, milestoneFeedback, tapFeedback } from '@/services/haptics';
import { iapService } from '@/services/iap';
import type { CrateReward } from '@/game/progression';

/**
 * A JÁTÉK FUTÁSIDEJŰ MAGJA
 *
 * Ez az egyetlen hely, ahol a játékállapot módosul. Minden akció ugyanazt a
 * mintát követi:
 *
 *   mutate(state => { ...actions.valami(state) })
 *
 * A `mutate` gondoskodik:
 *   - az új objektumreferenciáról (React újrarajzolás),
 *   - a szorzók újraszámolásáról,
 *   - az achievementek ellenőrzéséről,
 *   - a mentés ütemezéséről.
 *
 * TELJESÍTMÉNY: a szimulációs hurok `tickHz` (5 Hz) frekvencián fut, és nem
 * hoz létre új GameState objektumot ticknként — csak a `tick` számláló nő,
 * amire a UI feliratkozik. Így egy tick költsége ~mikroszekundum
 * nagyságrendű, nem React-újrarajzolás.
 */

export type ToastTone = 'info' | 'success' | 'error';

export type Toast = {
  id: number;
  text: string;
  tone: ToastTone;
};

export type RewardPopup =
  | { kind: 'crate'; reward: CrateReward }
  | { kind: 'booster'; title: string; body: string }
  | { kind: 'cash'; amount: number; title: string };

export type BootStatus = 'booting' | 'ready' | 'error';

/** Egy folyamatban lévő kézi elkészítés. */
export type CookingJob = {
  customerId: number;
  productId: ProductId;
  /** Fali óra, ms. */
  startedAt: number;
  /** Teljes hossz ms-ban. */
  duration: number;
};

type GameStore = {
  status: BootStatus;
  bootError: string | null;

  state: GameState;
  multipliers: Multipliers;

  /** UI frissítési számláló – a komponensek erre iratkoznak fel. */
  tick: number;
  /**
   * A pult előtt álló macskavendégek. Nem része a mentésnek: pillanatnyi,
   * látványbeli állapot, ami visszatéréskor magától újratelik.
   */
  customers: Customer[];
  /**
   * Amit a szakács macska (a játékos) épp készít. `null`, ha nem főz.
   * Nem mentjük: ha közben bezárod az appot, a rendelés egyszerűen elveszik.
   */
  cooking: CookingJob | null;
  /**
   * A fejlécben mutatott bevétel/mp.
   *
   * NEM csak az automatizált termelés: tartalmazza a kézi kiszolgálásból
   * származó, utolsó 10 másodpercre simított bevételt is. Enélkül a játék
   * eleje — amikor még nincs egyetlen menedzser sem — végig „0 Ft/mp”-et
   * mutatna, miközben a játékos épp keresi a pénzt.
   */
  incomePerSecond: number;

  toast: Toast | null;
  offlineReport: OfflineReport | null;
  rewardPopup: RewardPopup | null;
  achievementQueue: AchievementDef[];
  /** Igaz, amíg reklám vagy vásárlás fut – ilyenkor a gombok tiltottak. */
  busy: boolean;

  // --- Életciklus ---
  boot: () => Promise<void>;
  shutdown: () => void;

  // --- Játékakciók ---
  tapProduct: (productId: ProductId) => void;
  /**
   * Egy sorban álló macska rendelésének elkészítése.
   * Elindítja a főzést; a pénz a ciklus végén érkezik.
   */
  serveCustomer: (customerId: number) => void;
  buyProduct: (productId: ProductId) => void;
  hireManager: (productId: ProductId) => void;
  buyEquipment: (equipmentId: string) => void;
  hireStaff: (staffId: string) => void;
  unlockCity: (cityId: string) => Promise<void>;
  selectCity: (cityId: string) => void;
  setBuyQuantity: (quantity: BuyQuantity) => void;
  claimQuest: (questId: string) => void;
  claimDailyBonus: () => void;
  buyPerk: (perkId: string) => void;
  franchise: () => Promise<void>;
  spendCoins: (spendId: string) => void;
  buyCosmetic: (cosmeticId: string) => void;
  equipCosmetic: (cosmeticId: string) => void;
  toggleSetting: (key: 'sound' | 'haptics' | 'reducedMotion' | 'personalizedAds') => void;
  hardReset: () => Promise<void>;

  // --- Reklám ---
  watchRewarded: (placement: RewardedPlacement) => Promise<boolean>;
  openFreeCrate: () => Promise<void>;
  claimOffline: (withAd: boolean) => Promise<void>;
  dismissOffline: () => void;

  // --- Vásárlás ---
  purchase: (sku: string) => Promise<void>;
  restorePurchases: () => Promise<void>;

  // --- UI ---
  dismissToast: () => void;
  dismissRewardPopup: () => void;
  dismissAchievement: () => void;
  showToast: (text: string, tone?: ToastTone) => void;
};

let toastId = 0;
let loopTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let lastTickAt = 0;
let saveScheduler: SaveScheduler | null = null;
let customerWorld: CustomerWorld = createCustomerWorld(1, Date.now());

/**
 * A kézi kiszolgálásból származó bevétel csúszóablaka.
 *
 * A fejléc bevétel/mp értéke enélkül a játék elején végig nulla lenne (mert
 * az automatikus bevétel tényleg nulla, amíg nincs menedzser), miközben a
 * játékos épp aktívan keresi a pénzt. 10 másodpercre simítunk: elég rövid,
 * hogy reagáljon, és elég hosszú, hogy ne ugráljon.
 */
const MANUAL_WINDOW_SECONDS = 10;
let manualEarnings: { at: number; amount: number }[] = [];

function noteManualEarning(amount: number, wallMs: number): void {
  if (amount > 0) manualEarnings.push({ at: wallMs, amount });
}

function manualRatePerSecond(wallMs: number): number {
  const cutoff = wallMs - MANUAL_WINDOW_SECONDS * 1000;
  manualEarnings = manualEarnings.filter((entry) => entry.at >= cutoff);
  if (manualEarnings.length === 0) return 0;
  const total = manualEarnings.reduce((sum, entry) => sum + entry.amount, 0);
  return total / MANUAL_WINDOW_SECONDS;
}

/** A fejlécben mutatott bevétel: automatikus + a friss kézi kiszolgálás. */
function displayIncome(
  state: GameState,
  multipliers: Multipliers,
  wallMs: number,
): number {
  return totalIncomePerSecond(state, multipliers) + manualRatePerSecond(wallMs);
}

export const useGameStore = create<GameStore>((set, get) => {
  /**
   * A központi mutáló segédfüggvény. A `fn` helyben módosítja az állapotot;
   * mi gondoskodunk mindenről, ami utána következik.
   */
  const mutate = (
    fn: (state: GameState) => void,
    options: { save?: boolean; recomputeMultipliers?: boolean } = {},
  ): void => {
    const { state } = get();
    const wallMs = systemClock.read().wall;

    fn(state);

    // Achievementek ellenőrzése minden állapotváltozás után. Olcsó (27 elem),
    // és így soha nem maradhat le egy teljesítés.
    const unlocked = actions.grantAchievements(state);

    const multipliers =
      options.recomputeMultipliers === false
        ? get().multipliers
        : computeMultipliers(state, wallMs);

    set((prev) => ({
      // Sekély másolat: új referencia a React felé, de a beágyazott objektumok
      // (products, stats, settings) ugyanazok maradnak — a szimulációs hurok
      // azokat mutálja tovább, tehát nincs duplikáció és nincs allokációs
      // terhelés ticknként.
      state: { ...state },
      multipliers,
      incomePerSecond: displayIncome(state, multipliers, wallMs),
      tick: prev.tick + 1,
      achievementQueue:
        unlocked.length > 0 ? [...prev.achievementQueue, ...unlocked] : prev.achievementQueue,
    }));

    // A mentés-ütemező mindig a store aktuális `state`-jét olvassa, ezért a
    // csere után is a friss adatot menti.
    if (options.save !== false) saveScheduler?.request();
    if (unlocked.length > 0) milestoneFeedback();
  };

  /** Uniform handling of action results: toast + haptics on failure. */
  const handle = <T>(result: actions.ActionResult<T>, onSuccess?: (value: T) => void): boolean => {
    if (!result.ok) {
      get().showToast(result.error, 'error');
      errorFeedback();
      return false;
    }
    onSuccess?.(result.value);
    return true;
  };

  /**
   * Interstitial megjelenítése, ha a házirend engedi. Mindig "természetes
   * szünetnél" hívjuk (városnyitás, franchise) – soha nem akció közben.
   */
  const maybeShowInterstitial = async (): Promise<void> => {
    const { state } = get();
    const wallMs = systemClock.read().wall;
    const gate = canShowInterstitial(state, wallMs, adService.sessionAgeSeconds);
    if (!gate.allowed) {
      log.debug('Interstitial kihagyva', gate.reason);
      return;
    }

    set({ busy: true });
    const result = await adService.showInterstitial();
    set({ busy: false });

    if (result.status === 'shown') {
      mutate((s) => noteInterstitialShown(s, systemClock.read().wall));
    }
  };

  return {
    status: 'booting',
    bootError: null,

    state: createInitialState(),
    multipliers: computeMultipliers(createInitialState(), Date.now()),

    tick: 0,
    customers: [],
    cooking: null,
    incomePerSecond: 0,

    toast: null,
    offlineReport: null,
    rewardPopup: null,
    achievementQueue: [],
    busy: false,

    // -----------------------------------------------------------------------
    // Életciklus
    // -----------------------------------------------------------------------

    boot: async () => {
      try {
        const now = systemClock.read();
        const outcome = await loadGame(now.wall);
        const state = outcome.state;

        if (outcome.kind === 'restoredBackup') {
          log.warn('Restored from the backup save', outcome.reason);
        }

        // Napi küldetések frissítése, lejárt boosterek takarítása.
        refreshDailyIfNeeded(state, now.wall);
        actions.pruneBoosters(state, now.wall);

        // Offline bevétel kiszámítása – a jóváírás a modálban történik.
        const report = computeOfflineReport(state, now);
        const showModal = shouldShowOfflineModal(report);

        if (!showModal) {
          // Rövid távollét: csendben jóváírjuk, nem zavarjuk a játékost.
          applyOfflineEarnings(state, report, now, 1);
        }

        const multipliers = computeMultipliers(state, now.wall);
        setHapticsEnabled(state.settings.haptics);
        customerWorld = createCustomerWorld(state.rngState, now.wall);

        set({
          status: 'ready',
          state,
          multipliers,
          incomePerSecond: displayIncome(state, multipliers, now.wall),
          offlineReport: showModal ? report : null,
        });

        // Mentés-ütemező indítása.
        saveScheduler = new SaveScheduler(() => get().state);
        saveScheduler.start();

        // Szolgáltatások indítása – hibájuk nem blokkolhatja a játékot.
        void adService.initialize(state.settings.personalizedAds);
        void iapService.initialize();

        startLoop(get, mutate);
        attachAppStateListener(get);

        if (outcome.kind === 'fresh' && outcome.reason !== 'No previous save.') {
          get().showToast('The save was corrupted, a new game was started.', 'error');
        }
      } catch (err) {
        log.error('Startup error', err);
        set({ status: 'error', bootError: String(err) });
      }
    },

    shutdown: () => {
      if (loopTimer) clearInterval(loopTimer);
      loopTimer = null;
      appStateSub?.remove();
      appStateSub = null;
      saveScheduler?.stop();
      void saveScheduler?.flush();
      void iapService.disconnect();
    },

    // -----------------------------------------------------------------------
    // Játékakciók
    // -----------------------------------------------------------------------

    tapProduct: (productId) => {
      const { state, multipliers } = get();
      const def = getProduct(productId);
      const payout = serveByHand(state, multipliers, def, systemClock.read().wall);
      // 0 = még tart a kiszolgálási várakozás, vagy a termék automatizált.
      if (payout <= 0) return;

      tapFeedback();
      // Koppintásnál NEM számolunk újra szorzót és NEM mentünk azonnal:
      // ez a leggyakoribb akció, gyorsnak kell lennie.
      set((prev) => ({ state: { ...state }, tick: prev.tick + 1 }));
      saveScheduler?.request();
    },

    /**
     * Egy sorban álló macska kiszolgálása koppintásra.
     *
     * Ugyanaz a `serveByHand` fut, mint korábban – tehát a ciklusidőnkénti
     * korlát és a koppintás-szorzó változatlanul érvényes. A vendég csak
     * akkor kerül „kiszolgálva” állapotba, ha tényleg volt fizetés.
     */
    serveCustomer: (customerId) => {
      const { state, multipliers, cooking } = get();

      // Egyszerre egy rendelést készít a szakács.
      if (cooking) {
        get().showToast('You are cooking - wait until it is ready!', 'info');
        return;
      }

      const customer = customerWorld.customers.find((c) => c.id === customerId);
      if (!customer || customer.phase !== 'waiting') return;

      const productState = state.products[customer.productId];
      if (!productState || productState.hasManager) return;

      const wallMs = systemClock.read().wall;
      const def = getProduct(customer.productId);
      const seconds = cycleSeconds(
        def,
        productState.level,
        multipliers.productCycle[def.id] ?? 1,
      );

      /**
       * A főzés hossza PONTOSAN egy ciklusidő — se több, se kevesebb.
       *
       * Ez nem esztétikai döntés: a `serveByHand` a ciklusidőnkénti egy adag
       * korlátot érvényesíti, és ha rövidebbre vágnánk a főzést, a kifizetés
       * a végén elbukna, a vendég pedig örökre a sorban ragadna. Így viszont
       * a főzés végére a várakozás mindig letelt.
       *
       * A kiszolgálási várakozást szándékosan NEM ellenőrizzük itt: a főzés
       * maga a várakozás, tehát a következő rendelést azonnal el lehet kezdeni.
       */
      tapFeedback();
      set((prev) => ({
        cooking: {
          customerId,
          productId: def.id,
          startedAt: wallMs,
          duration: Math.max(350, seconds * 1000),
        },
        tick: prev.tick + 1,
      }));
    },

    buyProduct: (productId) => {
      const quantity = get().state.settings.buyQuantity;
      mutate((state) => {
        handle(actions.buyProductLevels(state, productId, quantity), () => successFeedback());
      });
    },

    hireManager: (productId) => {
      mutate((state) => {
        handle(actions.hireManager(state, productId), () => {
          noteSignificantEvent(state);
          milestoneFeedback();
          get().showToast('Manager hired - it earns on its own from now on!', 'success');
        });
      });
    },

    buyEquipment: (equipmentId) => {
      mutate((state) => {
        handle(actions.buyEquipmentTier(state, equipmentId), () => successFeedback());
      });
    },

    hireStaff: (staffId) => {
      mutate((state) => {
        handle(actions.hireStaffLevel(state, staffId), () => successFeedback());
      });
    },

    unlockCity: async (cityId) => {
      let unlocked = false;
      mutate((state) => {
        unlocked = handle(actions.unlockCity(state, cityId), () => {
          noteSignificantEvent(state);
          milestoneFeedback();
        });
      });

      if (unlocked) {
        resetCustomerWorld(customerWorld, systemClock.read().wall);
        set({ cooking: null });
        get().showToast('New spot opened! Go!', 'success');
        // Városnyitás = természetes szünet, itt jöhet interstitial.
        await maybeShowInterstitial();
      }
    },

    selectCity: (cityId) => {
      mutate((state) => {
        handle(actions.setActiveCity(state, cityId), () => {
          resetCustomerWorld(customerWorld, systemClock.read().wall);
          set({ cooking: null });
        });
      });
    },

    setBuyQuantity: (quantity) => {
      mutate((state) => actions.setBuyQuantity(state, quantity), {
        recomputeMultipliers: false,
      });
    },

    claimQuest: (questId) => {
      const coinFind = get().multipliers.coinFind;
      mutate((state) => {
        handle(actions.claimQuest(state, questId, coinFind), (reward) => {
          successFeedback();
          get().showToast(`+${reward} Food Coin`, 'success');
        });
      });
    },

    claimDailyBonus: () => {
      mutate((state) => {
        handle(actions.claimDailyBonus(state), (reward) => {
          milestoneFeedback();
          get().showToast(`Daily bonus: +${reward} Food Coins!`, 'success');
        });
      });
    },

    buyPerk: (perkId) => {
      mutate((state) => {
        handle(actions.buyPerk(state, perkId), () => {
          milestoneFeedback();
          get().showToast('Franchise perk activated!', 'success');
        });
      });
    },

    franchise: async () => {
      let stars = 0;
      let didFranchise = false;

      mutate((state) => {
        didFranchise = handle(
          actions.doFranchise(state, systemClock.read().wall),
          (earned) => {
            stars = earned;
            noteSignificantEvent(state);
          },
        );
      });

      if (didFranchise) {
        resetCustomerWorld(customerWorld, systemClock.read().wall);
        set({ cooking: null });
        milestoneFeedback();
        get().showToast(`+${stars} Golden Ladle!`, 'success');
        // Azonnali mentés: a franchise a legdrágább visszafordíthatatlan lépés.
        await saveScheduler?.flush();
        await maybeShowInterstitial();
      }
    },

    spendCoins: (spendId) => {
      mutate((state) => {
        handle(actions.spendCoins(state, spendId, systemClock.read().wall), (message) => {
          successFeedback();
          get().showToast(message, 'success');
        });
      });
    },

    buyCosmetic: (cosmeticId) => {
      mutate((state) => {
        handle(actions.buyCosmetic(state, cosmeticId), () => {
          successFeedback();
          get().showToast('New look unlocked!', 'success');
        });
      });
    },

    equipCosmetic: (cosmeticId) => {
      mutate((state) => {
        handle(actions.equipCosmetic(state, cosmeticId));
      });
    },

    toggleSetting: (key) => {
      mutate((state) => {
        actions.toggleSetting(state, key);
        if (key === 'haptics') setHapticsEnabled(state.settings.haptics);
        if (key === 'personalizedAds') {
          adService.setPersonalizedAds(state.settings.personalizedAds);
        }
      });
    },

    hardReset: async () => {
      mutate((state) => actions.hardReset(state, systemClock.read().wall));
      await saveScheduler?.flush();
      get().showToast('The game has restarted.', 'info');
    },

    // -----------------------------------------------------------------------
    // Reklám
    // -----------------------------------------------------------------------

    /**
     * Jutalomvideó folyamat.
     *
     * A jutalom KIZÁRÓLAG `earned` státusznál jár. Ha a játékos bezárja a
     * videót, nem kap semmit, de hibaüzenetet sem — az nem az ő hibája.
     * Ha megvette a reklámmentességet, a videó kimarad, a jutalom jár.
     */
    watchRewarded: async (placement) => {
      const { state } = get();
      const wallMs = systemClock.read().wall;

      const gate = canShowRewarded(state, placement, wallMs);
      if (!gate.allowed) {
        get().showToast(gate.reason ?? 'Not available right now.', 'error');
        return false;
      }

      const free = rewardIsFree(state);

      if (!free) {
        if (!adService.rewardedReady(placement)) {
          get().showToast('The video is still loading, try again in a few seconds.', 'error');
          adService.preloadAll();
          return false;
        }

        set({ busy: true });
        const result = await adService.showRewarded(placement);
        set({ busy: false });

        if (result.status !== 'earned') {
          if (result.status === 'error' || result.status === 'unavailable') {
            get().showToast('The video did not start. Please try again!', 'error');
          }
          return false;
        }
      }

      // --- A jutalom kiosztása ---
      const now = systemClock.read().wall;
      mutate((s) => {
        if (!free) noteRewardedWatched(s, placement, now);

        switch (placement) {
          case 'doubleIncome':
            actions.activateBooster(s, 'doubleIncome', now);
            break;
          case 'turbo':
            actions.activateBooster(s, 'turbo', now);
            break;
          case 'freeCrate': {
            const result = actions.openCrate(s, now, get().multipliers.coinFind);
            if (result.ok) {
              noteFreeCrateOpened(s, now);
              set({ rewardPopup: { kind: 'crate', reward: result.value } });
            }
            break;
          }
          case 'offlineBoost':
          case 'questReroll':
            // Ezeket a hívó kezeli (offline modál / küldetéslista).
            break;
        }
      });

      if (placement === 'doubleIncome') {
        set({
          rewardPopup: {
            kind: 'booster',
            title: 'Double income!',
            body: 'Every product pays twice as much for 15 minutes.',
          },
        });
      }
      if (placement === 'turbo') {
        set({
          rewardPopup: {
            kind: 'booster',
            title: 'Turbo shift!',
            body: 'Everything cooks in half the time for 10 minutes.',
          },
        });
      }

      successFeedback();
      adService.preloadAll();
      return true;
    },

    openFreeCrate: async () => {
      const { state } = get();
      const wallMs = systemClock.read().wall;

      const gate = canOpenFreeCrate(state, wallMs);
      if (!gate.allowed) {
        get().showToast(gate.reason ?? 'Not available right now.', 'error');
        return;
      }

      await get().watchRewarded('freeCrate');
    },

    /**
     * Offline bevétel jóváírása. `withAd = true` esetén előbb lefut a
     * jutalomvideó, és csak sikeres megtekintés után jár a dupla összeg.
     */
    claimOffline: async (withAd) => {
      const report = get().offlineReport;
      if (!report) return;

      let multiplier = 1;

      if (withAd) {
        const state = get().state;
        const wallMs = systemClock.read().wall;
        const free = rewardIsFree(state);
        const gate = canShowRewarded(state, 'offlineBoost', wallMs);

        if (!free && !gate.allowed) {
          get().showToast(gate.reason ?? 'Not available right now.', 'error');
        } else if (free) {
          multiplier = GAME_CONFIG.offline.adMultiplier;
        } else if (!adService.rewardedReady('offlineBoost')) {
          get().showToast('The video is still loading - you get the plain reward.', 'error');
        } else {
          set({ busy: true });
          const result = await adService.showRewarded('offlineBoost');
          set({ busy: false });
          if (result.status === 'earned') {
            multiplier = GAME_CONFIG.offline.adMultiplier;
            mutate((s) => noteRewardedWatched(s, 'offlineBoost', systemClock.read().wall));
          }
        }
      }

      const now = systemClock.read();
      let payout = 0;
      mutate((s) => {
        payout = applyOfflineEarnings(s, report, now, multiplier);
      });

      set({ offlineReport: null });
      if (payout > 0) {
        successFeedback();
        adService.preloadAll();
      }
    },

    dismissOffline: () => {
      const report = get().offlineReport;
      if (!report) return;
      const now = systemClock.read();
      mutate((s) => {
        applyOfflineEarnings(s, report, now, 1);
      });
      set({ offlineReport: null });
    },

    // -----------------------------------------------------------------------
    // Vásárlás
    // -----------------------------------------------------------------------

    /**
     * A vásárlás kézbesítésének sorrendje kritikus:
     *   store visszaigazolás -> jóváírás -> MENTÉS -> tranzakció lezárása.
     * Így a folyamat bármelyik pontján történő összeomlás után is a játékos
     * megkapja, amit vett (a store újrakézbesíti, a jóváírás idempotens).
     */
    purchase: async (sku) => {
      const def = getIapProduct(sku);
      if (!def) {
        get().showToast('Unknown product.', 'error');
        return;
      }

      set({ busy: true });
      const result = await iapService.purchase(sku);
      set({ busy: false });

      switch (result.status) {
        case 'cancelled':
          return;

        case 'pending':
          get().showToast('The purchase is being processed.', 'info');
          return;

        case 'alreadyOwned':
          await get().restorePurchases();
          return;

        case 'error':
          get().showToast(result.reason, 'error');
          return;

        case 'purchased':
          break;
      }

      // 1-2. Jóváírás
      mutate((state) => {
        const wallMs = systemClock.read().wall;
        if (def.entitlement) {
          const applied = actions.applyEntitlement(state, def.entitlement, wallMs);
          if (!applied.ok && def.coins) actions.grantCoins(state, def.coins);
        } else if (def.coins) {
          actions.grantCoins(state, def.coins);
        }
      });

      // 3. Mentés – innentől a jóváírás nem veszhet el.
      await saveScheduler?.flush();

      // 4. Tranzakció lezárása
      if (result.transactionId) {
        await iapService.finish(result.transactionId, sku);
      }

      milestoneFeedback();
      get().showToast('Thanks for the support!', 'success');
    },

    restorePurchases: async () => {
      set({ busy: true });
      const result = await iapService.restore();
      set({ busy: false });

      if (result.status === 'error') {
        get().showToast(result.reason, 'error');
        return;
      }

      const restored: Entitlement[] = [];
      mutate((state) => {
        const wallMs = systemClock.read().wall;
        for (const sku of result.skus) {
          const def = getIapProduct(sku);
          if (!def?.entitlement) continue;
          const applied = actions.applyEntitlement(state, def.entitlement, wallMs);
          if (applied.ok) restored.push(def.entitlement);
        }
      });

      await saveScheduler?.flush();

      get().showToast(
        restored.length > 0
          ? 'Your purchases have been restored.'
          : 'No restorable purchases were found.',
        restored.length > 0 ? 'success' : 'info',
      );
    },

    // -----------------------------------------------------------------------
    // UI
    // -----------------------------------------------------------------------

    showToast: (text, tone = 'info') => {
      toastId += 1;
      set({ toast: { id: toastId, text, tone } });
    },

    dismissToast: () => set({ toast: null }),
    dismissRewardPopup: () => set({ rewardPopup: null }),
    dismissAchievement: () =>
      set((prev) => ({ achievementQueue: prev.achievementQueue.slice(1) })),
  };
});

// ---------------------------------------------------------------------------
// Szimulációs hurok
// ---------------------------------------------------------------------------

/**
 * A hurok NEM a React render ciklusához kötődik, és nem hoz létre új
 * GameState objektumot ticknként. Csak:
 *   1. lépteti a szimulációt (helyben),
 *   2. növeli a `tick` számlálót, amire a UI feliratkozik.
 *
 * A szorzókat másodpercenként egyszer számoljuk újra (nem 5×), mert
 * booster-lejáraton és eseményváltáson kívül nem változnak.
 */
function startLoop(
  get: () => GameStore,
  mutate: (fn: (state: GameState) => void, options?: { save?: boolean }) => void,
): void {
  if (loopTimer) clearInterval(loopTimer);
  lastTickAt = systemClock.read().mono;

  const intervalMs = 1000 / GAME_CONFIG.loop.tickHz;
  let secondsSinceMultiplierRefresh = 0;

  loopTimer = setInterval(() => {
    const store = get();
    if (store.status !== 'ready') return;

    const now = systemClock.read();
    const rawDt = (now.mono - lastTickAt) / 1000;
    lastTickAt = now.mono;

    // Védekezés: ha a JS szál hosszan blokkolt (GC, navigáció), nem adunk
    // egyszerre óriási ugrást – az offline rendszer feladata a nagy szünetek.
    const dt = Math.min(Math.max(rawDt, 0), GAME_CONFIG.loop.maxTickSeconds);
    if (dt <= 0) return;

    const state = store.state;
    simulateTick(state, dt, store.multipliers);

    // --- Elkészült-e, amit a szakács macska (a játékos) főz? ---
    let cooking = store.cooking;
    if (cooking && now.wall >= cooking.startedAt + cooking.duration) {
      const def = getProduct(cooking.productId);
      const payout = serveByHand(state, store.multipliers, def, now.wall);

      if (payout > 0) {
        markServed(customerWorld, cooking.customerId, payout, now.wall);
        // A fejléc bevétel/mp értéke ebből számol – enélkül a játék eleje
        // végig „0 Ft/mp”-et mutatna.
        noteManualEarning(payout, now.wall);
        successFeedback();
      }

      cooking = null;
      useGameStore.setState({ cooking: null });
      saveScheduler?.request();
    }

    // A vendégsor léptetése. Ez csak látvány (a pénzt a simulateTick és a
    // fenti kiszolgálás írja jóvá), de a listát minden ticknél átadjuk a
    // UI-nak, mert a macskák fázisváltásai indítják a natív animációkat.
    tickCustomers(
      customerWorld,
      state,
      store.multipliers,
      now.wall,
      dt,
      cooking?.customerId ?? null,
    );
    const customers = customerWorld.customers;

    secondsSinceMultiplierRefresh += dt;
    const needsRefresh = secondsSinceMultiplierRefresh >= 1;

    if (needsRefresh) {
      secondsSinceMultiplierRefresh = 0;
      const multipliers = computeMultipliers(state, now.wall);
      useGameStore.setState((prev) => ({
        multipliers,
        incomePerSecond: displayIncome(state, multipliers, now.wall),
        customers,
        tick: prev.tick + 1,
      }));

      // Napváltás ellenőrzése (éjfélkor új küldetések).
      if (refreshDailyIfNeeded(state, now.wall)) {
        mutate(() => undefined);
        get().showToast('New daily quests have arrived!', 'info');
      }
    } else {
      useGameStore.setState((prev) => ({ customers, tick: prev.tick + 1 }));
    }
  }, intervalMs);
}

// ---------------------------------------------------------------------------
// Alkalmazás-életciklus
// ---------------------------------------------------------------------------

/**
 * Háttérbe váltáskor azonnal mentünk és rögzítjük az időt; előtérbe
 * visszatéréskor kiszámoljuk az offline bevételt.
 *
 * Ez az a pont, ahol a legtöbb idle játék elhasal: ha csak a mentésre
 * hagyatkozol, a rendszer által kilőtt app után elvész a haladás.
 */
function attachAppStateListener(get: () => GameStore): void {
  appStateSub?.remove();

  let previous: AppStateStatus = AppState.currentState;

  appStateSub = AppState.addEventListener('change', (next) => {
    const store = get();
    if (store.status !== 'ready') return;

    const now = systemClock.read();
    const goingToBackground = next === 'background' || next === 'inactive';
    const returning = previous !== 'active' && next === 'active';

    if (goingToBackground) {
      const state = store.state;
      state.lastSeenWallClock = now.wall;
      state.maxSeenWallClock = Math.max(state.maxSeenWallClock, now.wall);
      void saveScheduler?.flush();
      log.debug('Moved to background - saved');
    }

    if (returning) {
      const state = store.state;
      lastTickAt = now.mono;

      refreshDailyIfNeeded(state, now.wall);
      actions.pruneBoosters(state, now.wall);
      // A háttérben eltelt idő alatt a sor "megállt"; tiszta lappal indulunk,
      // különben a régi vendégek azonnal lejárt türelemmel tűnnének fel.
      resetCustomerWorld(customerWorld, now.wall);
      useGameStore.setState({ cooking: null });

      const report = computeOfflineReport(state, now);
      if (shouldShowOfflineModal(report)) {
        useGameStore.setState({ offlineReport: report });
      } else {
        applyOfflineEarnings(state, report, now, 1);
      }

      const multipliers = computeMultipliers(state, now.wall);
      useGameStore.setState((prev) => ({
        state: { ...state },
        multipliers,
        incomePerSecond: displayIncome(state, multipliers, now.wall),
        tick: prev.tick + 1,
      }));

      adService.preloadAll();
    }

    previous = next;
  });
}

// ---------------------------------------------------------------------------
// Kényelmi hookok
// ---------------------------------------------------------------------------

/** A UI frissítési ütemére feliratkozó hook. */
export const useTick = (): number => useGameStore((s) => s.tick);

/**
 * Készpénz, érme, csillag – a fejléchez.
 * A `useShallow` nélkül a szelektor minden store-változásnál új objektumot
 * adna vissza, és a komponens végtelen ciklusban rajzolna újra.
 */
export const useWallet = () =>
  useGameStore(
    useShallow((s) => ({
      cash: s.state.cash,
      coins: s.state.coins,
      stars: s.state.stars,
      incomePerSecond: s.incomePerSecond,
    })),
  );

/** Az azonnali mentés kikényszerítése (pl. kilépés előtt). */
export async function flushSave(): Promise<void> {
  await saveScheduler?.flush();
}

/** Csak teszthez: a mentés-ütemező injektálása. */
export function setSaveSchedulerForTesting(scheduler: SaveScheduler | null): void {
  saveScheduler = scheduler;
}

export { saveGame };
