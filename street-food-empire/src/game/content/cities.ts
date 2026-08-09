import type { CityDef, CityId } from '@/game/types';

/**
 * CITIES
 *
 * Every city brings a complete, standalone product set (6 products), and while
 * owned it grants +100% global income (globalMultiplier: 2). Cities are the
 * "big jump": a new city's products are orders of magnitude more expensive, but
 * their income/price ratio is far better, so opening one is always worth it.
 *
 * Scaling (see docs/ECONOMY.md):
 *   cost x 5e4 per city, income x 1.5e5 per city  -> 3x better ratio
 */

export type CityScaling = {
  /** Multiplier on product base cost relative to city 1. */
  costScale: number;
  /** Multiplier on product base revenue relative to city 1. */
  revenueScale: number;
};

const COST_STEP = 5e4;
const REVENUE_STEP = 1.5e5;

/**
 * Step of the city unlock price. It is CRITICAL that this is LARGER than the
 * income step (REVENUE_STEP x the per-city x2 global multiplier = 3e5),
 * otherwise every new city would open *faster* than the previous one and the
 * whole map would be consumed in minutes.
 *
 * 1.5e6 / 3e5 = 5 -> each city takes roughly five times as long as the one
 * before. That is the "first week" arc: 15 min -> 1h -> 6h -> 1.5 days -> 1 week.
 */
const UNLOCK_STEP = 1.5e6;

function scalingFor(index: number): CityScaling {
  return {
    costScale: Math.pow(COST_STEP, index),
    revenueScale: Math.pow(REVENUE_STEP, index),
  };
}

/** City unlock price: the magnitude of the previous city's priciest product. */
function unlockCostFor(index: number): number {
  if (index === 0) return 0;
  return 2.5e6 * Math.pow(UNLOCK_STEP, index - 1);
}

type CitySeed = {
  id: CityId;
  name: string;
  tagline: string;
  colors: readonly [string, string];
};

const CITY_SEEDS: readonly CitySeed[] = [
  {
    id: 'budapest',
    name: 'Budapest',
    tagline: 'One cart, one hotplate, one dream.',
    colors: ['#F2994A', '#EB5757'],
  },
  {
    id: 'prague',
    name: 'Prague',
    tagline: 'Sweet smoke over the cobblestones.',
    colors: ['#56CCF2', '#2F80ED'],
  },
  {
    id: 'berlin',
    name: 'Berlin',
    tagline: 'Open all night, the line never ends.',
    colors: ['#BB6BD9', '#5B2C6F'],
  },
  {
    id: 'istanbul',
    name: 'Istanbul',
    tagline: 'Spice market embers by the strait.',
    colors: ['#F2C94C', '#F2994A'],
  },
  {
    id: 'bangkok',
    name: 'Bangkok',
    tagline: 'Wok fire and neon after midnight.',
    colors: ['#6FCF97', '#219653'],
  },
  {
    id: 'newyork',
    name: 'New York',
    tagline: 'From corner cart to empire.',
    colors: ['#EB5757', '#9B51E0'],
  },
];

export const CITIES: readonly CityDef[] = CITY_SEEDS.map((seed, index) => ({
  id: seed.id,
  name: seed.name,
  tagline: seed.tagline,
  colors: seed.colors,
  unlockCost: unlockCostFor(index),
  unlockRequiresLifetime: index === 0 ? 0 : unlockCostFor(index) * 2,
  // The starting city gives no bonus (it is the 100% baseline); each further city x2.
  globalMultiplier: index === 0 ? 1 : 2,
}));

export const CITY_SCALING: Readonly<Record<CityId, CityScaling>> = Object.fromEntries(
  CITY_SEEDS.map((seed, index) => [seed.id, scalingFor(index)]),
);

export const FIRST_CITY_ID: CityId = CITY_SEEDS[0]!.id;

const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));
const CITY_INDEX = new Map(CITIES.map((c, i) => [c.id, i]));

export function getCity(id: CityId): CityDef {
  const city = CITY_BY_ID.get(id);
  if (!city) throw new Error(`Unknown city: ${id}`);
  return city;
}

export function getCityIndex(id: CityId): number {
  return CITY_INDEX.get(id) ?? 0;
}

/** The next city not yet owned (or null when all are owned). */
export function nextLockedCity(unlockedIds: readonly CityId[]): CityDef | null {
  return CITIES.find((c) => !unlockedIds.includes(c.id)) ?? null;
}
