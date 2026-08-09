/**
 * A JÁTÉK KÖZPONTI HANGOLÓ FÁJLJA.
 *
 * Minden balance-szám, ami nem tartozik egy konkrét tartalmi elemhez (termék,
 * gép, város), itt van egy helyen. Ha a játék "túl gyors" vagy "túl lassú",
 * elsőként ezt a fájlt kell hangolni – kódot nem kell hozzányúlni.
 *
 * A számok indoklását lásd: docs/ECONOMY.md
 */

export const GAME_CONFIG = {
  /** Mentés-formátum verziója. Növeld, ha migrációt írsz! */
  saveVersion: 3,

  /** Induló erőforrások új játékban. */
  start: {
    cash: 12,
    coins: 25,
    /** Az első termék ingyen jár, hogy azonnal legyen mit csinálni. */
    freeFirstProductLevels: 1,
  },

  /** A szimulációs hurok beállításai. */
  loop: {
    /** Logikai frissítés gyakorisága, Hz. 5 Hz gyenge telefonon is stabil. */
    tickHz: 5,
    /** Egy tickben feldolgozott maximális idő (mp) – védekezés a "halál-spirál" ellen. */
    maxTickSeconds: 1,
    /** UI újrarajzolás gyakorisága, Hz. Ennél a számok már folyamatosnak látszanak. */
    uiHz: 5,
  },

  /** Termékszint-vásárlás. */
  purchase: {
    /** A "Max" gomb mennyit hagyjon meg a kasszában (0 = mindent elkölt). */
    maxBuyReserveFraction: 0,
    /** Egy kattintással vehető maximális szint (teljesítmény-korlát). */
    hardBuyCap: 100_000,
  },

  /**
   * Mérföldkövek: egy terméknél elért szintszámhoz tartozó jutalom.
   * `income`: szorzó a termék bevételére. `speed`: a ciklusidő szorzója.
   * A 25-ös ismétlődő lépcső adja a hosszú távú motorháztetőt.
   */
  milestones: {
    /** Egyszeri, kézzel megadott mérföldkövek. */
    fixed: [
      { level: 10, income: 2 },
      { level: 25, income: 2 },
      { level: 50, speed: 0.5 },
      { level: 100, income: 3 },
      { level: 200, speed: 0.5 },
      { level: 300, income: 3 },
      { level: 400, income: 4 },
      { level: 500, speed: 0.5 },
    ] as const,
    /** 500 felett minden `repeatEvery` szinten `repeatIncome` szorzó jár. */
    repeatFrom: 500,
    repeatEvery: 100,
    repeatIncome: 2,
    /** A ciklusidő soha nem mehet ez alá (mp). */
    minCycleSeconds: 0.05,
    /**
     * Ha a ciklusidő ez alá esik, folyamatos bevételre váltunk (nem rajzolunk
     * külön ciklusanimációt) – ez spórolja meg a legtöbb CPU-t késői játékban.
     */
    continuousBelowSeconds: 0.25,
  },

  /** Offline bevétel. */
  offline: {
    /** Az online bevétel hány százaléka termelődik offline. */
    baseRate: 0.5,
    /** Alap sapka órában. Fejlesztésekkel és személyzettel növelhető. */
    baseCapHours: 4,
    /** A sapka abszolút felső határa órában, bármilyen bónusszal. */
    maxCapHours: 24,
    /** Ennél rövidebb távollétre nem mutatunk visszatérő ablakot (mp). */
    minSecondsToShowModal: 60,
    /** Reklámért járó szorzó az offline bevételre. */
    adMultiplier: 2,
    /** Csak automatizált (menedzserrel ellátott) termékek termelnek offline. */
    requiresManager: true,
  },

  /** Boosterek (ideiglenes szorzók). */
  boosters: {
    /** Rewarded videó: dupla bevétel. */
    doubleIncome: { multiplier: 2, durationSeconds: 15 * 60 },
    /** Rewarded videó: gyorsabb termelés (ciklusidő-szorzó). */
    turbo: { cycleMultiplier: 0.5, durationSeconds: 10 * 60 },
    /** Prémium valutáért vehető, erősebb és hosszabb. */
    premiumRush: { multiplier: 4, durationSeconds: 30 * 60, coinCost: 60 },
    /** Ugyanabból a típusból az idő hozzáadódik, eddig a plafonig (mp). */
    maxStackSeconds: 4 * 60 * 60,
  },

  /** Reklám-szabályok. Lásd docs/ADS_AND_IAP.md */
  ads: {
    interstitial: {
      /** Ennyi "jelentős esemény" után jöhet szóba egy interstitial. */
      everyNthEvent: 8,
      /** Két interstitial között kötelező szünet (mp). */
      cooldownSeconds: 180,
      /** Az app indulása után ennyi ideig biztosan nincs interstitial (mp). */
      sessionGraceSeconds: 120,
      /** Napi maximum. */
      dailyCap: 12,
    },
    rewarded: {
      /** Napi limit reklámhely-típusonként. */
      dailyCapPerPlacement: 10,
      /** Két rewarded videó közti minimális szünet (mp). */
      cooldownSeconds: 30,
    },
    /** Ingyen láda: ennyi időnként elérhető. */
    freeCrateCooldownSeconds: 30 * 60,
    freeCrateDailyCap: 6,
  },

  /** Prémium valuta (Food Coin) szerzési és költési arányai. */
  coins: {
    /** Ládából járó mennyiség tartománya. */
    crateRange: [3, 12] as const,
    /** Achievementenként járó alapmennyiség. */
    perAchievement: 15,
    /** Napi küldetésenként járó mennyiség. */
    perDailyQuest: 10,
    /** Az összes napi küldetés teljesítéséért járó bónusz. */
    dailyAllCompleteBonus: 25,
    /** 1 óra offline bevétel megvásárlásának ára. */
    timeSkipHourCost: 40,
    timeSkipMaxHours: 8,
  },

  /** Franchise (presztízs) rendszer. */
  franchise: {
    /**
     * Kapott Arany Merőkanál = floor((futásban keresett pénz / divisor) ^ exponent)
     *
     * Miért NEM négyzetgyök? Mert a bevétel a játék során 1e20-tól 1e30-ig
     * terjed, és a gyökfüggvény ezen a tartományon elszalad (1e30-nál
     * tízmilliós csillagszám). A negyedik gyök végig kezelhető marad:
     *
     *   1e20 →     40 csillag (+80%)     1e26 →  1 265 (+25×)
     *   1e24 →    400 csillag (+8×)      1e30 → 12 650 (+253×)
     */
    starDivisor: 4e13,
    starExponent: 0.25,
    /** Egy csillag ennyi additív bevételbónuszt ad. */
    incomePerStar: 0.02,
    /**
     * Ennyi keresett pénz alatt nem engedjük a franchise-t. Ez védi az első
     * futást: a játékosnak előbb végig kell mennie a korai tartalmon (kb. egy
     * nap játék), mielőtt felajánljuk neki az újrakezdést. Ha ez alacsony,
     * a játékos azelőtt franchise-ol, hogy megértené, mit veszít vele.
     */
    minLifetimeToUnlock: 1e20,
    /** Franchise után is megmarad: csillagok, achievementek, kozmetikák, IAP-k. */
  },

  /** Kattintás (manuális kiszolgálás). */
  tap: {
    /** Alap: a kattintás a termék egy ciklusát fejezi be. */
    baseCycleProgressBoost: 1,
    /** Egyszerre legfeljebb ennyi kattintás számít bele (bot-védelem). */
    maxTapsPerSecond: 12,
  },

  /** Mentés. */
  save: {
    /** Automatikus mentés gyakorisága (mp). */
    autoSaveSeconds: 15,
    /** Kulcsok az AsyncStorage-ban. */
    storageKey: 'sfe.save.v1',
    backupKey: 'sfe.save.backup.v1',
    settingsKey: 'sfe.settings.v1',
    /** Az ellenőrzőösszeg sója. Nem titkosítás, csak a naiv szerkesztés ellen. */
    checksumSalt: 'sfe-2026-kitchen',
  },
} as const;

export type GameConfig = typeof GAME_CONFIG;
