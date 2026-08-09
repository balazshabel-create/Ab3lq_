import { log } from '@/core/logger';
import { IAP_PRODUCTS, NON_CONSUMABLE_SKUS, getIapProduct } from '@/game/content/shop';
import { MockIapProvider } from '@/services/iap/MockIapProvider';
import { RnIapProvider, isRnIapAvailable } from '@/services/iap/RnIapProvider';
import type {
  IapProvider,
  PurchaseResult,
  PurchaseState,
  RestoreResult,
  StoreProduct,
} from '@/services/iap/types';

/**
 * IAP SZOLGÁLTATÁS
 *
 * A vásárlás kézbesítése (jóváírás) NEM itt történik, hanem a store-ban
 * (game/store.ts `purchaseSku`), mert az érinti a játékállapotot és a mentést.
 * Itt csak a store-kapcsolat, az árak és a tranzakciókezelés van.
 *
 * A helyes sorrend, amit a hívónak követnie kell:
 *
 *   1. `purchase(sku)`                → a store visszaigazolja
 *   2. jóváírás a játékállapotban     (applyEntitlement / grantCoins)
 *   3. **mentés kiírása**             (saveGame – itt már nem veszhet el)
 *   4. `finishTransaction(...)`       → csak most zárjuk le
 *
 * Ha a 3. és 4. lépés között lehal az app, a store újra kézbesíti a vásárlást,
 * a jóváírás pedig idempotens – tehát a játékos nem veszít és nem is nyer duplán.
 */

class IapServiceImpl {
  private provider: IapProvider = new MockIapProvider();
  private state: PurchaseState = 'unavailable';
  private products = new Map<string, StoreProduct>();
  private initializing: Promise<boolean> | null = null;

  async initialize(): Promise<boolean> {
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      this.state = 'connecting';

      if (isRnIapAvailable()) {
        const real = new RnIapProvider();
        const ready = await real.initialize(IAP_PRODUCTS.map((p) => p.sku));
        if (ready) {
          this.provider = real;
          log.info('IAP provider: react-native-iap');
        } else {
          log.warn('The store is unavailable, running mock IAP.');
          await this.provider.initialize(IAP_PRODUCTS.map((p) => p.sku));
        }
      } else {
        await this.provider.initialize(IAP_PRODUCTS.map((p) => p.sku));
        log.info('IAP provider: mock (no native SDK)');
      }

      await this.refreshProducts();
      this.state = 'ready';
      return true;
    })();

    return this.initializing;
  }

  private async refreshProducts(): Promise<void> {
    const list = await this.provider.getProducts();
    this.products.clear();
    for (const product of list) this.products.set(product.sku, product);
  }

  /** A megjelenítendő ár: a store-é, ha megvan, különben a tartalék. */
  priceFor(sku: string): string {
    const store = this.products.get(sku)?.localizedPrice;
    if (store) return store;
    return getIapProduct(sku)?.fallbackPrice ?? '—';
  }

  get currentState(): PurchaseState {
    return this.state;
  }

  get isMock(): boolean {
    return this.provider.name === 'mock';
  }

  async purchase(sku: string): Promise<PurchaseResult> {
    if (this.state === 'purchasing') {
      return { status: 'error', reason: 'A purchase is already running.' };
    }
    this.state = 'purchasing';
    try {
      return await this.provider.purchase(sku);
    } catch (err) {
      log.error('Unexpected purchase error', err);
      return { status: 'error', reason: 'An unexpected error occurred.' };
    } finally {
      this.state = 'ready';
    }
  }

  async restore(): Promise<RestoreResult> {
    try {
      return await this.provider.restorePurchases();
    } catch (err) {
      log.error('Unexpected restore error', err);
      return { status: 'error', reason: 'An unexpected error occurred.' };
    }
  }

  /** Csak a jóváírás elmentése UTÁN hívd! */
  async finish(transactionId: string, sku: string): Promise<void> {
    const consumable = getIapProduct(sku)?.type === 'consumable';
    await this.provider.finishTransaction(transactionId, consumable);
  }

  async disconnect(): Promise<void> {
    await this.provider.disconnect();
  }

  /** Csak teszthez. */
  setProviderForTesting(provider: IapProvider): void {
    this.provider = provider;
    this.state = 'ready';
  }
}

export const iapService = new IapServiceImpl();

/** A nem fogyó SKU-k listája – a `restore` ezeket keresi. */
export { NON_CONSUMABLE_SKUS };
