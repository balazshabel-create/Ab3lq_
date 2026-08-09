import { Platform } from 'react-native';

import { log } from '@/core/logger';
import type {
  IapProvider,
  PurchaseResult,
  RestoreResult,
  StoreProduct,
} from '@/services/iap/types';

/**
 * ÉLES IAP SZOLGÁLTATÓ (react-native-iap)
 *
 * A modult futásidőben töltjük be, hogy Expo Go-ban se dőljön el az app.
 *
 * ÉLESÍTÉS (részletek: docs/ADS_AND_IAP.md):
 *   1. npx expo install react-native-iap
 *   2. app.config.ts – vedd ki a 'react-native-iap' plugint a kommentből
 *   3. Google Play Console / App Store Connect – vidd fel a SKU-kat
 *      pontosan a shop.ts-ben szereplő azonosítókkal
 *   4. npx expo prebuild --clean && eas build
 *
 * SZERVEROLDALI NYUGTAELLENŐRZÉS: a `validateReceipt` hook helye előkészítve.
 * Amíg nincs szerver, a kliens a store válaszában bízik. Ez teljesen bevett
 * gyakorlat egy egyjátékos idle játéknál (nincs mit "ellopni" mástól), de ha
 * később bekapcsolod, csak ezt az egy függvényt kell megírni.
 */

type Purchase = {
  productId: string;
  transactionId?: string;
  transactionReceipt?: string;
  purchaseToken?: string;
  purchaseStateAndroid?: number;
};

type RnIapModule = {
  initConnection(): Promise<boolean>;
  endConnection(): Promise<void>;
  getProducts(params: { skus: string[] }): Promise<
    { productId: string; localizedPrice?: string; price?: string; title?: string; description?: string }[]
  >;
  requestPurchase(params: Record<string, unknown>): Promise<Purchase | Purchase[] | void>;
  getAvailablePurchases(): Promise<Purchase[]>;
  finishTransaction(params: { purchase: Purchase; isConsumable?: boolean }): Promise<unknown>;
  flushFailedPurchasesCachedAsPendingAndroid?(): Promise<unknown>;
};

let cachedModule: RnIapModule | null = null;
let loadAttempted = false;

function loadModule(): RnIapModule | null {
  if (loadAttempted) return cachedModule;
  loadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('react-native-iap') as RnIapModule;
  } catch {
    log.info('A react-native-iap nincs telepítve – mock vásárlás fut.');
    cachedModule = null;
  }
  return cachedModule;
}

export function isRnIapAvailable(): boolean {
  return loadModule() !== null;
}

/** A felhasználói megszakítás felismerése – ez nem hiba, nem mutatunk rá üzenetet. */
function isUserCancelled(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? '';
  const message = String((err as { message?: string })?.message ?? '');
  return (
    code === 'E_USER_CANCELLED' ||
    code === 'user-cancelled' ||
    /cancel/i.test(message)
  );
}

export class RnIapProvider implements IapProvider {
  readonly name = 'react-native-iap';

  private mod: RnIapModule | null = null;
  private skus: string[] = [];
  /** A még le nem zárt vásárlások, tranzakcióazonosító szerint. */
  private openPurchases = new Map<string, Purchase>();

  async initialize(skus: readonly string[]): Promise<boolean> {
    const mod = loadModule();
    if (!mod) return false;

    this.mod = mod;
    this.skus = [...skus];

    try {
      await mod.initConnection();
      // Androidon a korábbi, félbemaradt vásárlások kitisztítása.
      if (Platform.OS === 'android' && mod.flushFailedPurchasesCachedAsPendingAndroid) {
        await mod.flushFailedPurchasesCachedAsPendingAndroid().catch(() => undefined);
      }
      log.info('IAP kapcsolat létrejött');
      return true;
    } catch (err) {
      log.warn('IAP kapcsolódás sikertelen', err);
      return false;
    }
  }

  async getProducts(): Promise<StoreProduct[]> {
    const mod = this.mod;
    if (!mod) return [];
    try {
      const products = await mod.getProducts({ skus: this.skus });
      return products.map((p) => ({
        sku: p.productId,
        localizedPrice: p.localizedPrice ?? p.price ?? '',
        title: p.title,
        description: p.description,
      }));
    } catch (err) {
      log.warn('Termékek lekérése sikertelen', err);
      return [];
    }
  }

  async purchase(sku: string): Promise<PurchaseResult> {
    const mod = this.mod;
    if (!mod) return { status: 'error', reason: 'A bolt nem elérhető.' };

    try {
      const response = await mod.requestPurchase(
        Platform.OS === 'ios'
          ? { sku, andDangerouslyFinishTransactionAutomaticallyIOS: false }
          : { skus: [sku] },
      );

      const purchase = Array.isArray(response) ? response[0] : response;
      if (!purchase) {
        // Androidon a vásárlás eseményfolyamon is érkezhet; a hívó ilyenkor
        // a restore-ral tudja bepótolni.
        return { status: 'pending', sku };
      }

      // Android: 1 = purchased, 2 = pending (pl. készpénzes fizetés).
      if (purchase.purchaseStateAndroid === 2) {
        return { status: 'pending', sku };
      }

      const transactionId =
        purchase.transactionId ?? purchase.purchaseToken ?? `${sku}-${Date.now()}`;
      this.openPurchases.set(transactionId, purchase);

      return { status: 'purchased', sku: purchase.productId, transactionId };
    } catch (err) {
      if (isUserCancelled(err)) return { status: 'cancelled' };
      log.warn('Vásárlás sikertelen', err);
      return { status: 'error', reason: 'A vásárlás nem sikerült.' };
    }
  }

  async restorePurchases(): Promise<RestoreResult> {
    const mod = this.mod;
    if (!mod) return { status: 'error', reason: 'A bolt nem elérhető.' };

    try {
      const purchases = await mod.getAvailablePurchases();
      for (const purchase of purchases) {
        const id = purchase.transactionId ?? purchase.purchaseToken;
        if (id) this.openPurchases.set(id, purchase);
      }
      return { status: 'restored', skus: purchases.map((p) => p.productId) };
    } catch (err) {
      log.warn('Visszaállítás sikertelen', err);
      return { status: 'error', reason: 'A vásárlások visszaállítása nem sikerült.' };
    }
  }

  async finishTransaction(transactionId: string, consumable: boolean): Promise<void> {
    const mod = this.mod;
    const purchase = this.openPurchases.get(transactionId);
    if (!mod || !purchase) return;

    try {
      await mod.finishTransaction({ purchase, isConsumable: consumable });
      this.openPurchases.delete(transactionId);
    } catch (err) {
      // Ha a lezárás nem sikerül, a store újra kézbesíti – ezt a restore
      // folyamat kezeli, tehát a játékos nem veszít semmit.
      log.warn('Tranzakció lezárása sikertelen', err);
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.mod?.endConnection();
    } catch (err) {
      log.debug('IAP lecsatlakozás hibája', err);
    }
  }
}
