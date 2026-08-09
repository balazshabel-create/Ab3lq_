import { CITIES, CITY_SCALING } from '@/game/content/cities';
import type { CityId, ProductCategory, ProductDef, ProductId } from '@/game/types';

/**
 * TERMÉKEK
 *
 * Városonként 6 termék, azonos matematikai vázzal:
 *
 *   ár(n)      = baseCost * 1.07^n          (n = már megvett szintek száma)
 *   bevétel/mp = szint * baseRevenue / baseCycleSeconds
 *
 * A vázat két arány határozza meg (docs/ECONOMY.md):
 *   - szomszédos termékek ára     ×14
 *   - szomszédos termékek bev./mp ×3,6
 *
 * Mivel az ár gyorsabban nő, mint a bevétel, egy új termék 1. szintje
 * *kevésbé* hatékony, mint a régi termék következő szintje – egészen addig,
 * amíg a régi terméknél a 1,07^n árgörbe utol nem éri. Ez a váltakozás adja a
 * "mindig van mit venni" érzést, és nem igényel mesterséges zárakat.
 */

const COST_GROWTH = 1.07;

/** Az 1. város termékeinek nyers alapértékei. A többi város ebből skálázódik. */
type ProductSeed = {
  slug: string;
  name: string;
  category: ProductCategory;
  icon: string;
  baseCost: number;
  baseRevenue: number;
  baseCycleSeconds: number;
};

/** Minden városban ugyanaz a 6 "szerep", de saját névvel és ikonnal. */
/**
 * A ciklusidők szándékosan RÖVIDEK (1–12 mp).
 *
 * Egy fél percig készülő adag menü-szinten még elfogadható, de a látható
 * konyhában elviselhetetlen: a játékos csak néz egy alig mozduló csíkot.
 * A bevétel/mp arányok viszont változatlanok — a `baseRevenue` értékeket
 * együtt csökkentettük a ciklusidőkkel, tehát a gazdaság hangolása áll.
 *
 *   bevétel/mp = 1 · 3,5 · 13 · 47 · 170 · 610   (mint korábban)
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

/** Városonkénti nevek – a 6 szerep sorrendjében. */
const CITY_PRODUCT_NAMES: Record<CityId, readonly string[]> = {
  budapest: ['Bécsi virsli', 'Sült krumpli tölcsér', 'Lángos', 'Gyros tekercs', 'Bodzás limonádé', 'Kürtőskalács'],
  prague: ['Grillkolbász', 'Sajtos hasábburgonya', 'Bramborák', 'Csirkés pita', 'Meggyes szóda', 'Fahéjas tekercs'],
  berlin: ['Currywurst', 'Pommes rot-weiß', 'Perec', 'Döner tál', 'Almás fröccs', 'Berlini fánk'],
  istanbul: ['Kokoreç falatka', 'Fűszeres burgonya', 'Simit karika', 'Adana dürüm', 'Ayran korsó', 'Baklava kocka'],
  bangkok: ['Satay nyárs', 'Ropogós banán', 'Roti palacsinta', 'Pad thai doboz', 'Jeges thai tea', 'Mangós ragadós rizs'],
  newyork: ['Sarki hot dog', 'Fűszeres steak-fries', 'Kovászos bagel', 'Halal tál', 'Egg cream', 'Cheesecake szelet'],
};

/**
 * Az a városon belüli összbevétel, aminél a termék megjelenik a listában.
 * Az alapár 60%-a: mire eljutsz idáig, épp majdnem meg tudod venni.
 */
function unlockThreshold(baseCost: number, slotIndex: number): number {
  return slotIndex === 0 ? 0 : baseCost * 0.6;
}

/**
 * A menedzser ára ≈ a termék 14. szintjének hatszorosa.
 *
 * Korábban ennek a négyszerese volt, és az első menedzserre percekig kellett
 * gyűjteni — miközben a játékos épp az automatizálást tanulja meg. Az első
 * menedzser most nagyjából 60 Ft, ami néhány kiszolgálás.
 */
function managerCostFor(baseCost: number): number {
  return Math.round(baseCost * Math.pow(COST_GROWTH, 14) * 5);
}

function buildCityProducts(cityId: CityId): ProductDef[] {
  const scaling = CITY_SCALING[cityId];
  if (!scaling) throw new Error(`Nincs skálázás a városhoz: ${cityId}`);
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
  if (!product) throw new Error(`Ismeretlen termék: ${id}`);
  return product;
}

export function getProductOrNull(id: ProductId): ProductDef | null {
  return PRODUCT_BY_ID.get(id) ?? null;
}

export function productsOfCity(cityId: CityId): readonly ProductDef[] {
  return PRODUCTS_BY_CITY.get(cityId) ?? [];
}

/** Az első város első terméke – ezt kapja ingyen a játékos. */
export const STARTER_PRODUCT_ID: ProductId = PRODUCTS[0]!.id;
