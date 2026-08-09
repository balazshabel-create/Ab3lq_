import { GAME_CONFIG } from '@/config/gameConfig';
import type { CoinSpendDef, CosmeticDef, ShopIapDef } from '@/game/types';

/**
 * SHOP
 *
 * Three strictly separated layers:
 *  1. **IAP** - real money. Convenience and cosmetics only, nothing the game
 *     cannot be completed without.
 *  2. **Food Coin spends** - premium currency that can also be earned for free
 *     (quests, achievements, crates, ads). Same benefits, just a matter of time.
 *  3. **Cosmetics** - purely visual, zero gameplay effect.
 *
 * There is NO multiplayer and no player-vs-player comparison of any kind, so
 * pay-to-win cannot even form.
 *
 * The SKUs must be created exactly like this in the Google Play Console and in
 * App Store Connect. See docs/ADS_AND_IAP.md
 */

export const IAP_PRODUCTS: readonly ShopIapDef[] = [
  {
    sku: 'sfe.remove_ads',
    type: 'nonConsumable',
    name: 'Remove Ads',
    description:
      'Removes every automatic (interstitial) ad. Rewarded videos stay - and you get their reward without watching anything.',
    fallbackPrice: '$4.99',
    entitlement: 'removeAds',
    badge: 'Popular',
  },
  {
    sku: 'sfe.starter_pack',
    type: 'nonConsumable',
    name: 'Starter Pack',
    description: '250 Food Coins + 4h of income + an instant manager on your first 3 products.',
    fallbackPrice: '$2.99',
    entitlement: 'starterPack',
    coins: 250,
    badge: 'One-time',
  },
  {
    sku: 'sfe.golden_counter',
    type: 'nonConsumable',
    name: 'Golden Counter',
    description: 'Permanent: x1.25 income, double offline cap and a gold counter look.',
    fallbackPrice: '$9.99',
    entitlement: 'goldenCounter',
  },
  {
    sku: 'sfe.coins_small',
    type: 'consumable',
    name: 'Handful of Coins',
    description: '120 Food Coins',
    fallbackPrice: '$1.99',
    coins: 120,
  },
  {
    sku: 'sfe.coins_medium',
    type: 'consumable',
    name: 'Coin Pouch',
    description: '400 Food Coins',
    fallbackPrice: '$4.99',
    coins: 400,
    badge: '+13%',
  },
  {
    sku: 'sfe.coins_large',
    type: 'consumable',
    name: 'Cash Crate',
    description: '1,100 Food Coins',
    fallbackPrice: '$9.99',
    coins: 1_100,
    badge: '+24%',
  },
  {
    sku: 'sfe.coins_mega',
    type: 'consumable',
    name: 'Vault',
    description: '3,000 Food Coins',
    fallbackPrice: '$19.99',
    coins: 3_000,
    badge: 'Best value',
  },
];

/** List of `nonConsumable` SKUs - these are what `restorePurchases` restores. */
export const NON_CONSUMABLE_SKUS: readonly string[] = IAP_PRODUCTS.filter(
  (p) => p.type === 'nonConsumable',
).map((p) => p.sku);

export const COIN_SPENDS: readonly CoinSpendDef[] = [
  {
    id: 'spend.time2',
    name: '2 Hours of Income',
    description: 'Instantly collect the value of 2 hours of offline production.',
    coinCost: GAME_CONFIG.coins.timeSkipHourCost * 2,
    icon: 'clock',
    kind: { type: 'timeSkipHours', hours: 2 },
  },
  {
    id: 'spend.time8',
    name: '8 Hours of Income',
    description: 'A full shift of income with one tap.',
    coinCost: Math.round(GAME_CONFIG.coins.timeSkipHourCost * 8 * 0.85),
    icon: 'clock',
    kind: { type: 'timeSkipHours', hours: 8 },
  },
  {
    id: 'spend.rush',
    name: 'Rush Hour',
    description: 'x4 income for 30 minutes.',
    coinCost: GAME_CONFIG.boosters.premiumRush.coinCost,
    icon: 'flame',
    kind: { type: 'booster', booster: 'premiumRush' },
  },
  {
    id: 'spend.manager',
    name: 'Instant Manager',
    description: 'Puts a manager on your cheapest product that has none.',
    coinCost: 75,
    icon: 'chef',
    kind: { type: 'instantManager' },
  },
];

export const COSMETICS: readonly CosmeticDef[] = [
  {
    id: 'cosmetic.classic',
    name: 'Classic',
    description: 'The original warm street-side mood.',
    palette: { primary: '#F2994A', secondary: '#EB5757', accent: '#F2C94C' },
    coinCost: 0,
  },
  {
    id: 'cosmetic.neon',
    name: 'Neon Market',
    description: 'A night market in purple and cyan.',
    palette: { primary: '#BB6BD9', secondary: '#56CCF2', accent: '#F2C94C' },
    coinCost: 150,
  },
  {
    id: 'cosmetic.mint',
    name: 'Mint',
    description: 'Fresh, bright, calm counter.',
    palette: { primary: '#6FCF97', secondary: '#56CCF2', accent: '#F2F2F2' },
    coinCost: 150,
  },
  {
    id: 'cosmetic.gold',
    name: 'Golden Counter',
    description: 'Golden Counter owners only.',
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
