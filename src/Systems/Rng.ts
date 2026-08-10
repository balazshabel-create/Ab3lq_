/**
 * Rng.ts — deterministic pseudo-random numbers.
 *
 * The authority server and every client generate the same world from the same
 * seed, so world generation must never touch Math.random(). Every generator
 * here is a pure function of its seed and call order.
 */

/** Small fast integer hash (used to derive independent streams from one seed). */
export function hashInt(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

/** Hash a string into a 32-bit seed (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A seeded random source. `mulberry32` — tiny, fast, good enough statistically
 * for gameplay and world generation.
 */
export class Rng {
  private state: number;

  constructor(seed: number | string = 1) {
    this.state = (typeof seed === 'string' ? hashString(seed) : hashInt(seed)) || 1;
  }

  /** Fork an independent stream, so adding a system cannot shift others. */
  fork(salt: number | string): Rng {
    const s = typeof salt === 'string' ? hashString(salt) : hashInt(salt);
    return new Rng((this.state ^ s) >>> 0);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with the given probability. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Random element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }

  /**
   * Weighted pick. `weights[i]` is the relative likelihood of `items[i]`.
   * Falls back to the last item if the weights sum to zero.
   */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return items[items.length - 1];
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** In-place Fisher-Yates shuffle. Returns the same array for chaining. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** Approximately normal distribution via Box-Muller. */
  gaussian(mean = 0, stdDev = 1): number {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** A uniformly distributed point inside a circle of the given radius. */
  inCircle(radius: number): { x: number; y: number } {
    const a = this.next() * Math.PI * 2;
    const r = radius * Math.sqrt(this.next());
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
}

/** Convenience: a module-level generator for purely cosmetic client-side use. */
export const cosmeticRng = new Rng(0xc0ffee);
