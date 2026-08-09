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
  /** Aktuális bevétel/mp, a fejlécnek. */
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
  /** Egy konkrét, sorban álló macska kiszolgálása. */
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
      incomePerSecond: totalIncomePerSecond(state, multipliers),
      tick: prev.tick + 1,
      achievementQueue:
        unlocked.length > 0 ? [...prev.achievementQueue, ...unlocked] : prev.achievementQueue,
    }));

    // A mentés-ütemező mindig a store aktuális `state`-jét olvassa, ezért a
    // csere után is a friss adatot menti.
    if (options.save !== false) saveScheduler?.request();
    if (unlocked.length > 0) milestoneFeedback();
  };

  /** Akció-eredmény egységes kezelése: hiba esetén toast + rezgés. */
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
          log.warn('Biztonsági mentésről indultunk', outcome.reason);
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
          incomePerSecond: totalIncomePerSecond(state, multipliers),
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

        if (outcome.kind === 'fresh' && outcome.reason !== 'Nincs korábbi mentés.') {
          get().showToast('A mentés sérült volt, új játék indult.', 'error');
        }
      } catch (err) {
        log.error('Indítási hiba', err);
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
      const { state, multipliers } = get();
      const customer = customerWorld.customers.find((c) => c.id === customerId);
      if (!customer || customer.phase !== 'waiting') return;

      const wallMs = systemClock.read().wall;
      const def = getProduct(customer.productId);
      const payout = serveByHand(state, multipliers, def, wallMs);
      if (payout <= 0) return;

      markServed(customerWorld, customerId, payout, wallMs);
      tapFeedback();

      set((prev) => ({
        state: { ...state },
        customers: customerWorld.customers,
        tick: prev.tick + 1,
      }));
      saveScheduler?.request();
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
          get().showToast('Menedzser felvéve – mostantól magától termel!', 'success');
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
        get().showToast('Új hely megnyitva! Hajrá!', 'success');
        // Városnyitás = természetes szünet, itt jöhet interstitial.
        await maybeShowInterstitial();
      }
    },

    selectCity: (cityId) => {
      mutate((state) => {
        handle(actions.setActiveCity(state, cityId), () => {
          resetCustomerWorld(customerWorld, systemClock.read().wall);
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
          get().showToast(`Napi bónusz: +${reward} Food Coin!`, 'success');
        });
      });
    },

    buyPerk: (perkId) => {
      mutate((state) => {
        handle(actions.buyPerk(state, perkId), () => {
          milestoneFeedback();
          get().showToast('Franchise fejlesztés aktiválva!', 'success');
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
        milestoneFeedback();
        get().showToast(`+${stars} Arany Merőkanál!`, 'success');
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
          get().showToast('Új kinézet feloldva!', 'success');
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
      get().showToast('A játék újraindult.', 'info');
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
        get().showToast(gate.reason ?? 'Most nem elérhető.', 'error');
        return false;
      }

      const free = rewardIsFree(state);

      if (!free) {
        if (!adService.rewardedReady(placement)) {
          get().showToast('A videó még töltődik, próbáld pár másodperc múlva.', 'error');
          adService.preloadAll();
          return false;
        }

        set({ busy: true });
        const result = await adService.showRewarded(placement);
        set({ busy: false });

        if (result.status !== 'earned') {
          if (result.status === 'error' || result.status === 'unavailable') {
            get().showToast('A videó nem indult el. Próbáld újra!', 'error');
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
            title: 'Dupla bevétel!',
            body: '15 percig minden termék kétszer annyit hoz.',
          },
        });
      }
      if (placement === 'turbo') {
        set({
          rewardPopup: {
            kind: 'booster',
            title: 'Turbó műszak!',
            body: '10 percig feleannyi idő alatt készül el minden.',
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
        get().showToast(gate.reason ?? 'Most nem elérhető.', 'error');
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
          get().showToast(gate.reason ?? 'Most nem elérhető.', 'error');
        } else if (free) {
          multiplier = GAME_CONFIG.offline.adMultiplier;
        } else if (!adService.rewardedReady('offlineBoost')) {
          get().showToast('A videó még töltődik – a sima jutalom jár.', 'error');
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
        get().showToast('Ismeretlen termék.', 'error');
        return;
      }

      set({ busy: true });
      const result = await iapService.purchase(sku);
      set({ busy: false });

      switch (result.status) {
        case 'cancelled':
          return;

        case 'pending':
          get().showToast('A vásárlás feldolgozás alatt van.', 'info');
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
      get().showToast('Köszönjük a támogatást!', 'success');
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
          ? 'A vásárlásaid visszaállítva.'
          : 'Nem találtunk visszaállítható vásárlást.',
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

    // A vendégsor léptetése. Ez csak látvány (a pénzt a simulateTick írja
    // jóvá), de a listát minden ticknél átadjuk a UI-nak, mert a macskák
    // fázisváltásai indítják a natív animációkat.
    tickCustomers(customerWorld, state, store.multipliers, now.wall, dt);
    const customers = customerWorld.customers;

    secondsSinceMultiplierRefresh += dt;
    const needsRefresh = secondsSinceMultiplierRefresh >= 1;

    if (needsRefresh) {
      secondsSinceMultiplierRefresh = 0;
      const multipliers = computeMultipliers(state, now.wall);
      useGameStore.setState((prev) => ({
        multipliers,
        incomePerSecond: totalIncomePerSecond(state, multipliers),
        customers,
        tick: prev.tick + 1,
      }));

      // Napváltás ellenőrzése (éjfélkor új küldetések).
      if (refreshDailyIfNeeded(state, now.wall)) {
        mutate(() => undefined);
        get().showToast('Új napi küldetések érkeztek!', 'info');
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
      log.debug('Háttérbe váltás – mentve');
    }

    if (returning) {
      const state = store.state;
      lastTickAt = now.mono;

      refreshDailyIfNeeded(state, now.wall);
      actions.pruneBoosters(state, now.wall);
      // A háttérben eltelt idő alatt a sor "megállt"; tiszta lappal indulunk,
      // különben a régi vendégek azonnal lejárt türelemmel tűnnének fel.
      resetCustomerWorld(customerWorld, now.wall);

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
        incomePerSecond: totalIncomePerSecond(state, multipliers),
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
