/**
 * Determinisztikus álvéletlen generátor (mulberry32).
 *
 * Miért nem Math.random()? Mert a ládanyitás és az eseménysorsolás
 * eredményét a mentésbe írjuk: ha a játékos kilép a jutalom megjelenése és a
 * mentés között, ugyanazt az eredményt kell kapnia visszatéréskor. A seedet
 * a mentés tárolja, így a sorozat reprodukálható és nem "újrapörgethető".
 */

export type Rng = {
  /** [0, 1) */
  next(): number;
  /** [min, max] egész, mindkét vég zárt */
  int(min: number, max: number): number;
  /** p valószínűséggel true */
  chance(p: number): boolean;
  /** Súlyozott választás; a súlyok tetszőleges pozitív számok lehetnek */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
  /** Az aktuális belső állapot, mentéshez */
  state(): number;
};

export function createRng(seed: number): Rng {
  let a = seed >>> 0;

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    weighted: (items, weightOf) => {
      if (items.length === 0) throw new Error('rng.weighted: üres lista');
      let total = 0;
      for (const item of items) total += Math.max(0, weightOf(item));
      if (total <= 0) return items[0] as never;
      let roll = next() * total;
      for (const item of items) {
        roll -= Math.max(0, weightOf(item));
        if (roll <= 0) return item;
      }
      return items[items.length - 1] as never;
    },
    state: () => a,
  };
}

/** Új seed generálása (csak új játék indításakor hívjuk). */
export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}
