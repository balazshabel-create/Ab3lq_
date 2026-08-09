import { CITIES, CITY_SCALING } from '@/game/content/cities';
import type { CityId, ProductCategory, ProductDef, ProductId } from '@/game/types';

/**
 * PRODUCTS
 *
 * 6 products per city, all on the same mathematical skeleton:
 *
 *   price(n)  = baseCost * 1.07^n          (n = levels already bought)
 *   income/s  = level * baseRevenue / baseCycleSeconds
 *
 * Two ratios define the skeleton (docs/ECONOMY.md):
 *   - price of neighbouring products     x14
 *   - income/s of neighbouring products  x3.6
 *
 * Because price grows faster than income, level 1 of a new product is *less*
 * efficient than the next level of the old one - right up until the 1.07^n
 * price curve of the old product catches up. That alternation is what creates
 * the "there is always something to buy" feeling, with no artificial gates.
 */

const COST_GROWTH = 1.07;

/** Raw base values for city 1's products. Every other city scales from these. */
type ProductSeed = {
  slug: string;
  name: string;
  category: ProductCategory;
  icon: string;
  baseCost: number;
  baseRevenue: number;
  baseCycleSeconds: number;
};

/** The same 6 "roles" in every city, but with their own names and icons. */
/**
 * Cycle times are SHORT on purpose (1-12s).
 *
 * A batch that takes half a minute is acceptable in a menu, but unbearable in a
 * visible kitchen: the player just stares at a barely moving bar. The income/s
 * ratios are unchanged though - `baseRevenue` was lowered together with the
 * cycle times, so the economy tuning still holds.
 *
 *   income/s = 1 . 3.5 . 13 . 47 . 170 . 610   (as before)
 */
const PRODUCT_SLOTS: readonly {
  slug: string;
  category: ProductCategory;
  icon: string;
  baseCost: number;
  baseRevenue: number;
  baseCycleSeconds: number;
}[] = [
  { slug: 'snack', category: 'grill', icon: 'sausage', baseCost: 5, baseRevenue: 1, baseCycleSeconds: 1 },
  { slug: 'fried', category: 'fryer', icon: 'fries', baseCost: 70, baseRevenue: 7, baseCycleSeconds: 2 },
  { slug: 'dough', category: 'dough', icon: 'flatbread', baseCost: 980, baseRevenue: 39, baseCycleSeconds: 3 },
  { slug: 'wrap', category: 'grill', icon: 'wrap', baseCost: 13_700, baseRevenue: 235, baseCycleSeconds: 5 },
  { slug: 'drink', category: 'drink', icon: 'cup', baseCost: 192_000, baseRevenue: 1_360, baseCycleSeconds: 8 },
  { slug: 'dessert', category: 'sweet', icon: 'swirl', baseCost: 2_690_000, baseRevenue: 7_320, baseCycleSeconds: 12 },
];

/** Per-city names - in the order of the 6 roles. */
const CITY_PRODUCT_NAMES: Record<CityId, readonly string[]> = {
  budapest: ['Sausage Roll', 'Paper Cone Fries', 'Fried Flatbread', 'Gyros Wrap', 'Elderflower Soda', 'Chimney Cake'],
  prague: ['Grilled Klobasa', 'Cheesy Fries', 'Potato Pancake', 'Chicken Pita', 'Cherry Fizz', 'Cinnamon Roll'],
  berlin: ['Currywurst', 'Pommes Rot-Weiss', 'Soft Pretzel', 'Doner Bowl', 'Apple Spritz', 'Berliner Donut'],
  istanbul: ['Street Skewer', 'Spiced Potatoes', 'Simit Ring', 'Adana Durum', 'Ayran Jug', 'Baklava Square'],
  bangkok: ['Satay Sticks', 'Crispy Banana', 'Roti Pancake', 'Pad Thai Box', 'Iced Thai Tea', 'Mango Sticky Rice'],
  newyork: ['Corner Hot Dog', 'Loaded Steak Fries', 'Sourdough Bagel', 'Halal Platter', 'Egg Cream', 'Cheesecake Slice'],
};

/**
 * The city-wide total earnings at which the product appears in the list.
 * 60% of its base price: by the time you get here you can almost afford it.
 */
function unlockThreshold(baseCost: number, slotIndex: number): number {
  return slotIndex === 0 ? 0 : baseCost * 0.6;
}

/**
 * Manager price is about six times the product's level-14 price.
 *
 * It used to be four times that, and saving for the first manager took minutes
 * - exactly while the player is learning what automation is. The first manager
 * now costs about $13, which is a handful of orders.
 */
function managerCostFor(baseCost: number): number {
  return Math.round(baseCost * Math.pow(COST_GROWTH, 14) * 5);
}

function buildCityProducts(cityId: CityId): ProductDef[] {
  const scaling = CITY_SCALING[cityId];
  if (!scaling) throw new Error(`No scaling for city: ${cityId}`);
  const names = CITY_PRODUCT_NAMES[cityId] ?? [];

  return PRODUCT_SLOTS.map((slot, index) => {
    const baseCost = slot.baseCost * scaling.costScale;
    const baseRevenue = slot.baseRevenue * scaling.revenueScale;

    const seed: ProductSeed = {
      slug: slot.slug,
      name: names[index] ?? `${cityId} #${index + 1}`,
      category: slot.category,
      icon: slot.icon,
      baseCost,
      baseRevenue,
      baseCycleSeconds: slot.baseCycleSeconds,
    };

    return {
      id: `${cityId}.${seed.slug}` as ProductId,
      cityId,
      name: seed.name,
      category: seed.category,
      icon: seed.icon,
      baseCost: seed.baseCost,
      costGrowth: COST_GROWTH,
      baseRevenue: seed.baseRevenue,
      baseCycleSeconds: seed.baseCycleSeconds,
      managerCost: managerCostFor(baseCost),
      unlockAtCityEarnings: unlockThreshold(baseCost, index),
    } satisfies ProductDef;
  });
}

export const PRODUCTS: readonly ProductDef[] = CITIES.flatMap((city) =>
  buildCityProducts(city.id),
);

const PRODUCT_BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

const PRODUCTS_BY_CITY = new Map<CityId, ProductDef[]>();
for (const product of PRODUCTS) {
  const list = PRODUCTS_BY_CITY.get(product.cityId);
  if (list) list.push(product);
  else PRODUCTS_BY_CITY.set(product.cityId, [product]);
}

export function getProduct(id: ProductId): ProductDef {
  const product = PRODUCT_BY_ID.get(id);
  if (!product) throw new Error(`Unknown product: ${id}`);
  return product;
}

export function getProductOrNull(id: ProductId): ProductDef | null {
  return PRODUCT_BY_ID.get(id) ?? null;
}

export function productsOfCity(cityId: CityId): readonly ProductDef[] {
  return PRODUCTS_BY_CITY.get(cityId) ?? [];
}

/** The first product of the first city - the player gets this for free. */
export const STARTER_PRODUCT_ID: ProductId = PRODUCTS[0]!.id;
