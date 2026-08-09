import { log } from '@/core/logger';
import { IAP_PRODUCTS } from '@/game/content/shop';
import type {
  IapProvider,
  PurchaseResult,
  RestoreResult,
  StoreProduct,
} from '@/services/iap/types';

/**
 * Fejlesztői IAP-szolgáltató.
 *
 * Expo Go-ban és tesztekben fut. A vásárlás azonnal sikeres, de a folyamat
 * minden lépése (aszinkronitás, tranzakció-lezárás, restore) ugyanúgy le van
 * modellezve, hogy a hívó kód éles környezetben ne viselkedjen máshogy.
 *
 * FIGYELEM: ez a szolgáltató éles buildben soha nem aktiválódik, mert a
 * `createIapProvider` csak akkor választja, ha a natív modul hiányzik.
 */
export class MockIapProvider implements IapProvider {
  readonly name = 'mock';

  private owned = new Set<string>();
  private nextTransactionId = 1;

  async initialize(): Promise<boolean> {
    log.info('MockIapProvider initialised (no real purchases)');
    return true;
  }

  async getProducts(): Promise<StoreProduct[]> {
    await delay(150);
    return IAP_PRODUCTS.map((product) => ({
      sku: product.sku,
      localizedPrice: product.fallbackPrice,
      title: product.name,
      description: product.description,
    }));
  }

  async purchase(sku: string): Promise<PurchaseResult> {
    const def = IAP_PRODUCTS.find((p) => p.sku === sku);
    if (!def) return { status: 'error', reason: `Unknown product: ${sku}` };

    await delay(400);

    if (def.type === 'nonConsumable' && this.owned.has(sku)) {
      return { status: 'alreadyOwned', sku };
    }

    if (def.type === 'nonConsumable') this.owned.add(sku);

    return {
      status: 'purchased',
      sku,
      transactionId: `mock-tx-${this.nextTransactionId++}`,
    };
  }

  async restorePurchases(): Promise<RestoreResult> {
    await delay(300);
    return { status: 'restored', skus: [...this.owned] };
  }

  async finishTransaction(transactionId: string): Promise<void> {
    log.debug('Mock transaction finished', transactionId);
  }

  async disconnect(): Promise<void> {
    // Nincs teendő.
  }

  /** Csak teszthez: birtokolt termékek beállítása. */
  setOwnedForTesting(skus: readonly string[]): void {
    this.owned = new Set(skus);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
