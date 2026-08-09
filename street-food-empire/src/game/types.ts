/**
 * A játék teljes típusrendszere.
 *
 * Két réteg különül el:
 *  - **Content** (`*Def`): statikus, kódban definiált tartalom. Sosem kerül a
 *    mentésbe, csak az azonosítója.
 *  - **State**: a játékos futó állapota. Ez az, amit mentünk és betöltünk.
 *    Szigorúan JSON-szerializálható: nincs benne Map, Set, Date vagy függvény.
 */

// ---------------------------------------------------------------------------
// Tartalom (statikus definíciók)
// ---------------------------------------------------------------------------

export type CityId = string;
export type ProductId = string;
export type EquipmentId = string;
export type StaffId = string;
export type AchievementId = string;
export type QuestId = string;
export type EventId = string;
export type PerkId = string;
export type CosmeticId = string;

/** Egy szorzó hatóköre: mire vonatkozik egy fejlesztés. */
export type EffectScope =
  | { kind: 'global' }
  | { kind: 'city'; cityId: CityId }
  | { kind: 'product'; productId: ProductId }
  | { kind: 'category'; category: ProductCategory };

/** Termékkategóriák – a gépek ezekre adnak bónuszt. */
export type ProductCategory = 'grill' | 'fryer' | 'dough' | 'cold' | 'drink' | 'sweet';

/** Egy fejlesztés hatása. Több is tartozhat egy vásárláshoz. */
export type Effect =
  | { type: 'incomeMultiplier'; scope: EffectScope; value: number }
  | { type: 'cycleMultiplier'; scope: EffectScope; value: number }
  | { type: 'offlineCapHours'; value: number }
  | { type: 'offlineRate'; value: number }
  | { type: 'tapMultiplier'; value: number }
  | { type: 'coinFind'; value: number };

export type ProductDef = {
  id: ProductId;
  cityId: CityId;
  name: string;
  category: ProductCategory;
  /** Ikonkulcs a saját SVG ikonkészletünkből (src/ui/components/FoodIcon.tsx). */
  icon: string;
  /** Az 1. szint ára. */
  baseCost: number;
  /** Az árnövekedés hatványalapja: cost(n) = baseCost * costGrowth^n */
  costGrowth: number;
  /** Egy ciklus alapbevétele 1. szinten. */
  baseRevenue: number;
  /** Egy ciklus alap hossza másodpercben. */
  baseCycleSeconds: number;
  /** A menedzser (automatizálás) egyszeri ára. */
  managerCost: number;
  /** Ennyi pénzt kell összesen keresni a városban, hogy megjelenjen a boltban. */
  unlockAtCityEarnings: number;
};

export type CityDef = {
  id: CityId;
  name: string;
  /** Rövid hangulati leírás a városválasztón. */
  tagline: string;
  /** Színpár a város kártyájához (gradiens). */
  colors: readonly [string, string];
  /** A város feloldásának ára készpénzben. */
  unlockCost: number;
  /** Ennyi összes (lifetime) keresett pénz kell a feloldás engedélyezéséhez. */
  unlockRequiresLifetime: number;
  /** A város birtoklása ennyivel szorozza a globális bevételt. */
  globalMultiplier: number;
};

export type EquipmentTierDef = {
  /** 1-től induló szint. */
  tier: number;
  name: string;
  cost: number;
  effects: readonly Effect[];
  /** Rövid, játékosnak szóló magyarázat. */
  description: string;
};

export type EquipmentDef = {
  id: EquipmentId;
  cityId: CityId | 'all';
  name: string;
  icon: string;
  tiers: readonly EquipmentTierDef[];
};

export type StaffRole = 'manager' | 'chef' | 'courier' | 'cashier' | 'marketer';

export type StaffDef = {
  id: StaffId;
  role: Exclude<StaffRole, 'manager'>;
  name: string;
  icon: string;
  description: string;
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
  /** Szintenkénti hatás; a value szintenként lineárisan összeadódik. */
  effectPerLevel: Effect;
};

export type AchievementDef = {
  id: AchievementId;
  name: string;
  description: string;
  /** A feltétel kiértékelése a statisztikákon. */
  metric: StatMetric;
  threshold: number;
  coinReward: number;
  /** Tartós, additív globális bevételbónusz (0.01 = +1%). */
  incomeBonus: number;
};

export type StatMetric =
  | 'lifetimeEarnings'
  | 'runEarnings'
  | 'totalTaps'
  | 'totalLevelsBought'
  | 'managersHired'
  | 'citiesUnlocked'
  | 'franchiseCount'
  | 'adsWatched'
  | 'questsCompleted'
  | 'cratesOpened';

export type QuestDef = {
  id: QuestId;
  /** Sablonszöveg; a `{target}` helyére a formázott célszám kerül. */
  text: string;
  metric: StatMetric;
  /** A cél a napi kezdőértékhez képest ennyivel nő. */
  target: number;
  /** Ha igaz, a cél a játékos aktuális bevételéhez skálázódik. */
  scaleWithIncome?: boolean;
  coinReward: number;
  cashRewardSeconds?: number;
};

/**
 * Esemény-ütemezés. Szándékosan **ismétlődő** szabályokat is támogat, hogy a
 * játékban szerver nélkül is legyen élő eseménynaptár, és a tartalom ne
 * "járjon le" egy év múlva.
 */
export type EventSchedule =
  | { kind: 'dateRange'; startsOn: string; endsOn: string }
  /** A hét megadott napjain (0 = vasárnap). */
  | { kind: 'weekly'; days: readonly number[] }
  /** A hónap megadott napjain. */
  | { kind: 'monthDays'; days: readonly number[] };

export type GameEventDef = {
  id: EventId;
  name: string;
  description: string;
  schedule: EventSchedule;
  effects: readonly Effect[];
  /** Bannerszín. */
  color: string;
  icon: string;
};

export type FranchisePerkDef = {
  id: PerkId;
  name: string;
  description: string;
  starCost: number;
  /** Előfeltétel perk. */
  requires?: PerkId;
  effects: readonly Effect[];
};

// ---------------------------------------------------------------------------
// Bolt (IAP + prémium valuta)
// ---------------------------------------------------------------------------

export type IapProductType = 'consumable' | 'nonConsumable';

export type ShopIapDef = {
  /** A store-ban regisztrált termékazonosító. */
  sku: string;
  type: IapProductType;
  name: string;
  description: string;
  /** Megjelenített tartalék ár, amíg a store ára be nem töltődik. */
  fallbackPrice: string;
  /** Consumable csomagoknál: ennyi Food Coin jár. */
  coins?: number;
  /** Kiemelt ajánlat jelölése. */
  badge?: string;
  /** Nem fogyó termékeknél: melyik jogosultságot adja. */
  entitlement?: Entitlement;
};

export type Entitlement = 'removeAds' | 'goldenCounter' | 'starterPack';

export type CoinSpendDef = {
  id: string;
  name: string;
  description: string;
  coinCost: number;
  icon: string;
  kind:
    | { type: 'timeSkipHours'; hours: number }
    | { type: 'booster'; booster: 'premiumRush' }
    | { type: 'instantManager' }
    | { type: 'cosmetic'; cosmeticId: CosmeticId };
};

export type CosmeticDef = {
  id: CosmeticId;
  name: string;
  description: string;
  /** A főképernyő téma-felülírása. */
  palette: { primary: string; secondary: string; accent: string };
  coinCost: number;
};

// ---------------------------------------------------------------------------
// Játékos-állapot (mentett)
// ---------------------------------------------------------------------------

export type ProductState = {
  /** Megvásárolt szintek száma. 0 = még nincs meg. */
  level: number;
  /** Van-e menedzser (automatizálás). */
  hasManager: boolean;
  /** Az aktuális ciklus előrehaladása 0..1 (csak automatizált terméknél). */
  progress: number;
  /**
   * Fali óra (ms), ameddig a termék nem szolgálható ki kézzel újra.
   *
   * Ez a mező tartja kordában a kézi kiszolgálást: egy terméket legfeljebb
   * ciklusidőnként egyszer lehet kézzel eladni. Enélkül egy 30 másodperces
   * ciklusú termékből másodpercenként több teljes ciklusnyi bevétel jönne,
   * ami két nagyságrenddel veri az automatizálást, és pillanatok alatt
   * kijátszhatóvá teszi a gazdaságot.
   */
  nextServeAt: number;
};

export type BoosterState = {
  /** Fali óra ms, ameddig aktív. */
  expiresAt: number;
  /** Bevétel-szorzó (1 = nincs hatás). */
  incomeMultiplier: number;
  /** Ciklusidő-szorzó (1 = nincs hatás). */
  cycleMultiplier: number;
};

export type BoosterKey = 'doubleIncome' | 'turbo' | 'premiumRush' | 'event';

export type QuestState = {
  questId: QuestId;
  /** A metrika értéke a küldetés kiosztásakor. */
  baseline: number;
  target: number;
  claimed: boolean;
};

export type DailyState = {
  /** `YYYY-MM-DD` – ha eltér a mai naptól, újragenerálunk. */
  dayKey: string;
  quests: QuestState[];
  allClaimedBonusTaken: boolean;
  /** Reklámszámlálók napi bontásban. */
  interstitialsShown: number;
  rewardedByPlacement: Record<string, number>;
  cratesOpened: number;
};

export type StatsState = Record<StatMetric, number>;

export type AdState = {
  /** Utolsó interstitial fali óra ms-ban. */
  lastInterstitialAt: number;
  /** Utolsó rewarded fali óra ms-ban. */
  lastRewardedAt: number;
  /** Jelentős események számlálója az utolsó interstitial óta. */
  eventsSinceInterstitial: number;
  /** Mikor lesz újra elérhető az ingyen láda (fali óra ms). */
  nextFreeCrateAt: number;
};

export type SettingsState = {
  sound: boolean;
  haptics: boolean;
  /** Csökkentett animáció – gyenge készülékeken vagy akadálymentesítéshez. */
  reducedMotion: boolean;
  /** Személyre szabott reklám (GDPR / ATT). */
  personalizedAds: boolean;
  /** Melyik szorzóval vásárol a "vásárlás" gomb. */
  buyQuantity: BuyQuantity;
  activeCosmetic: CosmeticId | null;
};

export type BuyQuantity = 1 | 10 | 100 | 'max';

export type GameState = {
  /** Mentés-séma verziója. */
  version: number;

  cash: number;
  coins: number;
  /** Franchise valuta (Arany Merőkanál). */
  stars: number;

  /** Éppen nézett város. */
  activeCityId: CityId;
  unlockedCityIds: CityId[];
  /** Városonként a futásban keresett pénz – termékfeloldáshoz. */
  cityEarnings: Record<CityId, number>;

  products: Record<ProductId, ProductState>;
  /** Gépenként az aktuálisan megvett legmagasabb szint (0 = nincs). */
  equipment: Record<EquipmentId, number>;
  /** Személyzeti szerepenkénti szint (0 = nincs felvéve). */
  staff: Record<StaffId, number>;

  unlockedAchievementIds: AchievementId[];
  ownedPerkIds: PerkId[];
  ownedCosmeticIds: CosmeticId[];
  entitlements: Entitlement[];

  boosters: Partial<Record<BoosterKey, BoosterState>>;

  daily: DailyState;
  stats: StatsState;
  ads: AdState;
  settings: SettingsState;

  /** Óra és mentés metaadatok. */
  lastSeenWallClock: number;
  maxSeenWallClock: number;
  /** RNG állapot, hogy a sorsolások reprodukálhatók legyenek. */
  rngState: number;

  /** Statisztika: hányszor franchise-olt. */
  franchiseCount: number;
  /** Az aktuális futásban keresett pénz (franchise-kor nullázódik). */
  runEarnings: number;
};

// ---------------------------------------------------------------------------
// Számított (nem mentett) értékek
// ---------------------------------------------------------------------------

/** Egy termék teljes, kiszámolt állapota – a UI ezt kapja. */
export type ProductView = {
  def: ProductDef;
  state: ProductState;
  /** Egy ciklus bevétele az összes szorzóval. */
  revenuePerCycle: number;
  /** Egy ciklus tényleges hossza mp-ben. */
  cycleSeconds: number;
  /** Bevétel másodpercenként (csak ha automatizált vagy fut). */
  incomePerSecond: number;
  /** A következő vásárlás ára és darabszáma az aktuális beállítás szerint. */
  buyCost: number;
  buyAmount: number;
  affordable: boolean;
  unlocked: boolean;
  /** Következő mérföldkő szintje és szorzója (UI motiváció). */
  nextMilestone: { level: number; label: string } | null;
  /** Folyamatos módban van-e (nagyon rövid ciklus). */
  continuous: boolean;
  /** Kiszolgálható-e most kézzel (nincs menedzsere és lejárt a várakozás)? */
  canServe: boolean;
  /**
   * A haladássávban megjelenítendő érték 0..1.
   * Automatizált terméknél a ciklus állása, kézinél a várakozás visszatöltése.
   */
  displayProgress: number;
};

/** Az összes aktív szorzó összesítve – a szimuláció ezt használja. */
export type Multipliers = {
  /** Globális bevételszorzó (városok, gépek, csillagok, boosterek, események). */
  globalIncome: number;
  /** Termékenkénti egyedi szorzó. */
  productIncome: Record<ProductId, number>;
  /** Termékenkénti ciklusidő-szorzó. */
  productCycle: Record<ProductId, number>;
  /** Offline sapka órában. */
  offlineCapHours: number;
  /** Offline bevételi arány. */
  offlineRate: number;
  /** Kattintás-szorzó. */
  tapMultiplier: number;
  /** Food Coin találati szorzó (ládák, küldetések). */
  coinFind: number;
};
