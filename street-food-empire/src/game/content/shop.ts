import { GAME_CONFIG } from '@/config/gameConfig';
import type { CoinSpendDef, CosmeticDef, ShopIapDef } from '@/game/types';

/**
 * BOLT
 *
 * Három réteg, szigorúan elválasztva:
 *  1. **IAP** – valódi pénz. Csak kényelem és kozmetika, semmi olyan, ami
 *     nélkül a játék ne lenne végigjátszható.
 *  2. **Food Coin költés** – prémium valuta, amit ingyen is lehet szerezni
 *     (küldetés, achievement, láda, reklám). Ugyanazok az előnyök, csak idő
 *     kérdése.
 *  3. **Kozmetika** – tisztán vizuális, nulla játékhatás.
 *
 * NINCS multiplayer és nincs semmilyen játékos-játékos összehasonlítás,
 * ezért pay-to-win sem tud kialakulni.
 *
 * A SKU-kat pontosan ugyanígy kell felvenni a Google Play Console-ban és az
 * App Store Connectben. Lásd docs/ADS_AND_IAP.md
 */

export const IAP_PRODUCTS: readonly ShopIapDef[] = [
  {
    sku: 'sfe.remove_ads',
    type: 'nonConsumable',
    name: 'Reklámmentes',
    description:
      'Eltávolítja az összes automatikus (interstitial) reklámot. A jutalomvideók megmaradnak — és a jutalmuk reklám nélkül is jár.',
    fallbackPrice: '1 990 Ft',
    entitlement: 'removeAds',
    badge: 'Népszerű',
  },
  {
    sku: 'sfe.starter_pack',
    type: 'nonConsumable',
    name: 'Kezdőcsomag',
    description: '250 Food Coin + 4 óra bevétel + azonnali menedzser az első 3 termékre.',
    fallbackPrice: '990 Ft',
    entitlement: 'starterPack',
    coins: 250,
    badge: 'Egyszeri',
  },
  {
    sku: 'sfe.golden_counter',
    type: 'nonConsumable',
    name: 'Aranypult',
    description: 'Végleg: ×1,25 bevétel, dupla offline sapka és arany pult-kinézet.',
    fallbackPrice: '3 990 Ft',
    entitlement: 'goldenCounter',
  },
  {
    sku: 'sfe.coins_small',
    type: 'consumable',
    name: 'Marék érme',
    description: '120 Food Coin',
    fallbackPrice: '590 Ft',
    coins: 120,
  },
  {
    sku: 'sfe.coins_medium',
    type: 'consumable',
    name: 'Erszény',
    description: '400 Food Coin',
    fallbackPrice: '1 790 Ft',
    coins: 400,
    badge: '+13%',
  },
  {
    sku: 'sfe.coins_large',
    type: 'consumable',
    name: 'Pénzesláda',
    description: '1 100 Food Coin',
    fallbackPrice: '4 490 Ft',
    coins: 1_100,
    badge: '+24%',
  },
  {
    sku: 'sfe.coins_mega',
    type: 'consumable',
    name: 'Széf',
    description: '3 000 Food Coin',
    fallbackPrice: '10 990 Ft',
    coins: 3_000,
    badge: 'Legjobb ár',
  },
];

/** A `nonConsumable` SKU-k listája – ezeket kell visszaállítani `restorePurchases`-kor. */
export const NON_CONSUMABLE_SKUS: readonly string[] = IAP_PRODUCTS.filter(
  (p) => p.type === 'nonConsumable',
).map((p) => p.sku);

export const COIN_SPENDS: readonly CoinSpendDef[] = [
  {
    id: 'spend.time2',
    name: '2 óra bevétel',
    description: 'Azonnal megkapod 2 óra offline termelésed értékét.',
    coinCost: GAME_CONFIG.coins.timeSkipHourCost * 2,
    icon: 'clock',
    kind: { type: 'timeSkipHours', hours: 2 },
  },
  {
    id: 'spend.time8',
    name: '8 óra bevétel',
    description: 'Egy teljes műszak bevétele egy koppintással.',
    coinCost: Math.round(GAME_CONFIG.coins.timeSkipHourCost * 8 * 0.85),
    icon: 'clock',
    kind: { type: 'timeSkipHours', hours: 8 },
  },
  {
    id: 'spend.rush',
    name: 'Csúcsforgalom',
    description: '30 percig ×4 bevétel.',
    coinCost: GAME_CONFIG.boosters.premiumRush.coinCost,
    icon: 'flame',
    kind: { type: 'booster', booster: 'premiumRush' },
  },
  {
    id: 'spend.manager',
    name: 'Azonnali menedzser',
    description: 'A legolcsóbb menedzser nélküli termékedre azonnal menedzser kerül.',
    coinCost: 75,
    icon: 'chef',
    kind: { type: 'instantManager' },
  },
];

export const COSMETICS: readonly CosmeticDef[] = [
  {
    id: 'cosmetic.classic',
    name: 'Klasszikus',
    description: 'Az eredeti, meleg utcai hangulat.',
    palette: { primary: '#F2994A', secondary: '#EB5757', accent: '#F2C94C' },
    coinCost: 0,
  },
  {
    id: 'cosmetic.neon',
    name: 'Neonpiac',
    description: 'Éjszakai piac lilában és ciánban.',
    palette: { primary: '#BB6BD9', secondary: '#56CCF2', accent: '#F2C94C' },
    coinCost: 150,
  },
  {
    id: 'cosmetic.mint',
    name: 'Menta',
    description: 'Friss, világos, nyugodt pult.',
    palette: { primary: '#6FCF97', secondary: '#56CCF2', accent: '#F2F2F2' },
    coinCost: 150,
  },
  {
    id: 'cosmetic.gold',
    name: 'Aranypult',
    description: 'Csak Aranypult-vásárlóknak.',
    palette: { primary: '#F2C94C', secondary: '#BB8B2E', accent: '#FFF3C4' },
    coinCost: 0,
  },
];

export const DEFAULT_COSMETIC_ID = COSMETICS[0]!.id;

export function getCosmetic(id: string): CosmeticDef | null {
  return COSMETICS.find((c) => c.id === id) ?? null;
}

export function getIapProduct(sku: string): ShopIapDef | null {
  return IAP_PRODUCTS.find((p) => p.sku === sku) ?? null;
}

export function getCoinSpend(id: string): CoinSpendDef | null {
  return COIN_SPENDS.find((s) => s.id === id) ?? null;
}
