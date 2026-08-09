/**
 * IN-APP PURCHASE ABSZTRAKCIÓ
 *
 * Ugyanaz az elv, mint a reklámoknál: a játék soha nem hívja közvetlenül a
 * store SDK-t. Két megvalósítás: mock (fejlesztés) és `react-native-iap` (éles).
 *
 * A HÁROM SZABÁLY, amit minden IAP-implementációnak be kell tartania:
 *  1. **A jóváírás a tranzakció lezárása ELŐTT történik.** Ha jóváírás után,
 *     a crash pont a kettő között elveszi a játékos pénzét.
 *  2. **Fogyó terméknél a tranzakciót le KELL zárni** (finishTransaction /
 *     consumePurchase), különben a store újra és újra kézbesíti.
 *  3. **A nem fogyó termék idempotens.** A `restorePurchases` ugyanazt a
 *     jogosultságot többször is kézbesítheti – ettől nem járhat duplán.
 */

export type PurchaseState =
  | 'unavailable'
  | 'connecting'
  | 'ready'
  | 'purchasing'
  | 'error';

/** Egy store-ból lekért termék, megjelenítéshez. */
export type StoreProduct = {
  sku: string;
  /** A store lokalizált ára, pl. „1 990 Ft” vagy „$4.99”. */
  localizedPrice: string;
  title?: string;
  description?: string;
};

export type PurchaseResult =
  | { status: 'purchased'; sku: string; transactionId?: string }
  | { status: 'cancelled' }
  | { status: 'pending'; sku: string }
  | { status: 'alreadyOwned'; sku: string }
  | { status: 'error'; reason: string };

export type RestoreResult =
  | { status: 'restored'; skus: string[] }
  | { status: 'error'; reason: string };

export interface IapProvider {
  readonly name: string;

  /** Kapcsolódás a store-hoz. Hibát `false`-szal jelez, nem dobással. */
  initialize(skus: readonly string[]): Promise<boolean>;

  /** A store-ból lekért, lokalizált árak. Üres tömb, ha nem elérhető. */
  getProducts(): Promise<StoreProduct[]>;

  purchase(sku: string): Promise<PurchaseResult>;

  /** Nem fogyó termékek visszaállítása (App Store-nál kötelező gomb!). */
  restorePurchases(): Promise<RestoreResult>;

  /**
   * A tranzakció lezárása. A hívó CSAK a jóváírás sikeres mentése után hívja.
   * @param consumable fogyó termék esetén true (újra megvehető legyen)
   */
  finishTransaction(transactionId: string, consumable: boolean): Promise<void>;

  disconnect(): Promise<void>;
}
