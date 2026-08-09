import { GAME_CONFIG } from '@/config/gameConfig';
import { PRODUCTS, productsOfCity } from '@/game/content/products';
import { CITIES } from '@/game/content/cities';
import {
  bulkCost,
  earningsForNextStar,
  incomePerSecond,
  levelCost,
  maxAffordableLevels,
  milestoneEffect,
  nextMilestone,
  resolveBuy,
  starsForRun,
} from '@/game/economy';

const product = PRODUCTS[0]!;

describe('árgörbék', () => {
  it('a szintár mértani sorozat', () => {
    expect(levelCost(product, 0)).toBeCloseTo(product.baseCost);
    expect(levelCost(product, 1)).toBeCloseTo(product.baseCost * product.costGrowth);
    expect(levelCost(product, 10)).toBeCloseTo(
      product.baseCost * Math.pow(product.costGrowth, 10),
    );
  });

  it('a zárt alakú halmozott ár megegyezik a lépésenkénti összeggel', () => {
    for (const from of [0, 5, 37, 120]) {
      for (const count of [1, 3, 10, 25]) {
        let manual = 0;
        for (let i = 0; i < count; i += 1) manual += levelCost(product, from + i);
        expect(bulkCost(product, from, count)).toBeCloseTo(manual, 4);
      }
    }
  });

  it('a maxAffordable soha nem lép túl a kereten', () => {
    for (const cash of [0, 4, 5, 50, 1_000, 1e6, 1e12]) {
      const amount = maxAffordableLevels(product, 0, cash);
      expect(bulkCost(product, 0, amount)).toBeLessThanOrEqual(cash + 1e-6);
      // ...és pontosan egy szinttel többre már nem futná
      if (amount < GAME_CONFIG.purchase.hardBuyCap) {
        expect(bulkCost(product, 0, amount + 1)).toBeGreaterThan(cash);
      }
    }
  });

  it('nulla vagy negatív pénzből nem vehető szint', () => {
    expect(maxAffordableLevels(product, 0, 0)).toBe(0);
    expect(maxAffordableLevels(product, 0, -100)).toBe(0);
    expect(maxAffordableLevels(product, 0, product.baseCost - 0.01)).toBe(0);
  });

  it('a resolveBuy "max" módja megegyezik a maxAffordable-lel', () => {
    const cash = 12_345;
    const resolved = resolveBuy(product, 3, cash, 'max');
    expect(resolved.amount).toBe(maxAffordableLevels(product, 3, cash));
    expect(resolved.cost).toBeLessThanOrEqual(cash);
  });

  it('a fix mennyiségű vásárlás akkor is árat ad, ha nincs rá pénz', () => {
    // A UI ezt használja a "nincs elég pénzed" állapot kirajzolásához.
    const resolved = resolveBuy(product, 0, 0, 10);
    expect(resolved.amount).toBe(10);
    expect(resolved.cost).toBeGreaterThan(0);
  });
});

describe('mérföldkövek', () => {
  it('0. szinten nincs bónusz', () => {
    expect(milestoneEffect(0)).toEqual({ income: 1, cycle: 1 });
  });

  it('a 10. szint duplázza a bevételt', () => {
    expect(milestoneEffect(9).income).toBe(1);
    expect(milestoneEffect(10).income).toBe(2);
  });

  it('az 50. szint felezi a ciklusidőt', () => {
    expect(milestoneEffect(49).cycle).toBe(1);
    expect(milestoneEffect(50).cycle).toBe(0.5);
  });

  it('a szorzó monoton nő a szinttel', () => {
    let previous = 0;
    for (let level = 0; level <= 1200; level += 10) {
      const effect = milestoneEffect(level);
      const combined = effect.income / effect.cycle;
      expect(combined).toBeGreaterThanOrEqual(previous);
      previous = combined;
    }
  });

  it('500 felett 100 szintenként ismétlődik a duplázás', () => {
    const at600 = milestoneEffect(600).income;
    const at700 = milestoneEffect(700).income;
    expect(at700 / at600).toBeCloseTo(GAME_CONFIG.milestones.repeatIncome);
  });

  it('a nextMilestone mindig a jelenlegi szint fölött van', () => {
    for (const level of [0, 9, 10, 99, 500, 640, 1234]) {
      const next = nextMilestone(level);
      expect(next).not.toBeNull();
      expect(next!.level).toBeGreaterThan(level);
    }
  });
});

describe('a gazdaság hosszú távú viselkedése', () => {
  it('a költség gyorsabban nő, mint a bevétel — így nincs végtelen hurok', () => {
    // Ez a legfontosabb balance-invariáns: ha megfordulna, a játék
    // önmagát oldaná meg, és percek alatt elfogyna a tartalom.
    const cheapLevel = 100;
    const expensiveLevel = 900;

    const costRatio = levelCost(product, expensiveLevel) / levelCost(product, cheapLevel);
    const incomeRatio =
      incomePerSecond(product, expensiveLevel, 1, 1, 1) /
      incomePerSecond(product, cheapLevel, 1, 1, 1);

    expect(costRatio).toBeGreaterThan(incomeRatio);
  });

  it('minden városban 6 termék van, növekvő árral', () => {
    for (const city of CITIES) {
      const items = productsOfCity(city.id);
      expect(items).toHaveLength(6);
      for (let i = 1; i < items.length; i += 1) {
        expect(items[i]!.baseCost).toBeGreaterThan(items[i - 1]!.baseCost);
      }
    }
  });

  it('a későbbi termék bevétel/mp-je nagyobb, mint a korábbié', () => {
    const items = productsOfCity(CITIES[0]!.id);
    for (let i = 1; i < items.length; i += 1) {
      const previous = incomePerSecond(items[i - 1]!, 1, 1, 1, 1);
      const current = incomePerSecond(items[i]!, 1, 1, 1, 1);
      expect(current).toBeGreaterThan(previous);
    }
  });

  it('minden szám véges marad a legkésőbbi városban is', () => {
    const last = productsOfCity(CITIES[CITIES.length - 1]!.id);
    for (const def of last) {
      const income = incomePerSecond(def, 2_000, 1e6, 1e6, 1);
      expect(Number.isFinite(income)).toBe(true);
      expect(Number.isFinite(levelCost(def, 2_000))).toBe(true);
    }
  });
});

describe('franchise', () => {
  it('a küszöb alatt nincs csillag', () => {
    // A küszöb 1e20 nagyságrendű, ahol a `- 1` már nem ábrázolható
    // (a double 2^53 fölött egészekben is ugrik), ezért arányosan csökkentünk.
    const threshold = GAME_CONFIG.franchise.minLifetimeToUnlock;
    expect(starsForRun(threshold * 0.99)).toBe(0);
    expect(starsForRun(0)).toBe(0);
    expect(starsForRun(threshold)).toBeGreaterThan(0);
  });

  it('a csillagszám a beállított hatvány szerint nő', () => {
    const { starDivisor, starExponent } = GAME_CONFIG.franchise;
    const earningsFor = (stars: number) =>
      Math.pow(stars, 1 / starExponent) * starDivisor;

    for (const stars of [50, 100, 400]) {
      expect(starsForRun(earningsFor(stars))).toBe(stars);
    }
  });

  it('a csillagszám kezelhető marad a legkésőbbi bevételnél is', () => {
    // 1e30 Ft-nál sem szaladhat el – ez döntötte volna el a négyzetgyököt.
    const late = starsForRun(1e30);
    expect(Number.isFinite(late)).toBe(true);
    expect(late).toBeLessThan(1e7);
  });

  it('a csillagszám monoton nő a bevétellel', () => {
    let previous = 0;
    for (let exponent = 12; exponent <= 30; exponent += 1) {
      const stars = starsForRun(Math.pow(10, exponent));
      expect(stars).toBeGreaterThanOrEqual(previous);
      previous = stars;
    }
  });

  it('a következő csillagig hátralévő összeg mindig pozitív', () => {
    for (const earnings of [1e8, 1e9, 5e10, 1e14]) {
      expect(earningsForNextStar(earnings)).toBeGreaterThan(0);
    }
  });
});
