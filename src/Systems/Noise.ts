/**
 * Noise.ts — seeded value/simplex noise used for terrain, rivers, wind and fog.
 *
 * Deterministic and dependency free: identical output on the server and in the
 * browser, which is what lets both sides agree on the shape of the world.
 */

import { hashInt } from './Rng';

/** 2D gradient noise (Perlin-style) with a seeded permutation table. */
export class Noise2D {
  private perm: Uint8Array;
  private gradX: Float32Array;
  private gradY: Float32Array;

  constructor(seed = 1) {
    const size = 256;
    this.perm = new Uint8Array(size * 2);
    this.gradX = new Float32Array(size);
    this.gradY = new Float32Array(size);

    // Seeded permutation
    const p = new Uint8Array(size);
    for (let i = 0; i < size; i++) p[i] = i;
    let s = hashInt(seed) || 1;
    const rand = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = size - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < size; i++) {
      this.perm[i] = p[i];
      this.perm[i + size] = p[i];
      const a = rand() * Math.PI * 2;
      this.gradX[i] = Math.cos(a);
      this.gradY[i] = Math.sin(a);
    }
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /** Noise in roughly [-1, 1]. */
  sample(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;

    const dot = (gi: number, dx: number, dy: number) =>
      this.gradX[gi] * dx + this.gradY[gi] * dy;

    const aa = this.perm[this.perm[X] + Y] & 255;
    const ba = this.perm[this.perm[X + 1] + Y] & 255;
    const ab = this.perm[this.perm[X] + Y + 1] & 255;
    const bb = this.perm[this.perm[X + 1] + Y + 1] & 255;

    const u = Noise2D.fade(xf);
    const v = Noise2D.fade(yf);

    const x1 = dot(aa, xf, yf) * (1 - u) + dot(ba, xf - 1, yf) * u;
    const x2 = dot(ab, xf, yf - 1) * (1 - u) + dot(bb, xf - 1, yf - 1) * u;
    return (x1 * (1 - v) + x2 * v) * 1.4;
  }

  /** Fractal Brownian motion: layered noise, in roughly [-1, 1]. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2.03, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.sample(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  /**
   * Ridged noise — sharp crests, good for mountain spines and, inverted,
   * for carving river valleys.
   */
  ridged(x: number, y: number, octaves = 4): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.sample(x * freq, y * freq));
      sum += n * n * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.07;
    }
    return norm > 0 ? sum / norm : 0;
  }
}

/** Smoothstep helper used all over the generation code. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-6)));
  return t * t * (3 - 2 * t);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest signed angular difference, in radians. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Move `from` towards `to` by at most `maxStep` radians. */
export function turnTowards(from: number, to: number, maxStep: number): number {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}
