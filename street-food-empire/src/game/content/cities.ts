import type { CityDef, CityId } from '@/game/types';

/**
 * VÁROSOK
 *
 * Minden város egy teljes, önálló termékkészletet hoz (6 termék), és amíg
 * birtokolod, +100% globális bevételt ad (globalMultiplier: 2). A városok
 * jelentik a "nagy ugrást": egy új város termékei nagyságrendekkel drágábbak,
 * de a bevétel/ár arányuk `ratioBoost`-szor jobb, ezért mindig megéri nyitni.
 *
 * Skálázás (lásd docs/ECONOMY.md):
 *   költség × 5e4 városonként, bevétel × 1.5e5 városonként  → 3× jobb arány
 */

export type CityScaling = {
  /** A termékek alapárának szorzója az 1. városhoz képest. */
  costScale: number;
  /** A termékek alapbevételének szorzója az 1. városhoz képest. */
  revenueScale: number;
};

const COST_STEP = 5e4;
const REVENUE_STEP = 1.5e5;

/**
 * A város-feloldási ár lépése. KRITIKUS, hogy ez NAGYOBB legyen, mint a
 * bevétel lépése (REVENUE_STEP × a városonkénti ×2 globális szorzó = 3e5),
 * különben minden újabb város *gyorsabban* nyílna meg, mint az előző, és az
 * egész térkép percek alatt elfogyna.
 *
 * 1,5e6 / 3e5 = 5 → minden város nagyjából ötször annyi ideig tart, mint az
 * előző. Ez adja az „első hét” ívét: 15 perc → 1 óra → 6 óra → 1,5 nap → 1 hét.
 */
const UNLOCK_STEP = 1.5e6;

function scalingFor(index: number): CityScaling {
  return {
    costScale: Math.pow(COST_STEP, index),
    revenueScale: Math.pow(REVENUE_STEP, index),
  };
}

/** Város-feloldási ár: az előző város legdrágább termékének nagyságrendje. */
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
    tagline: 'Egy kocsi, egy rezsó, egy álom.',
    colors: ['#F2994A', '#EB5757'],
  },
  {
    id: 'prague',
    name: 'Prága',
    tagline: 'Kürtős illat a macskaköveken.',
    colors: ['#56CCF2', '#2F80ED'],
  },
  {
    id: 'berlin',
    name: 'Berlin',
    tagline: 'Éjjel-nappal nyitva, mindig sor áll.',
    colors: ['#BB6BD9', '#5B2C6F'],
  },
  {
    id: 'istanbul',
    name: 'Isztambul',
    tagline: 'Fűszerpiac és parázs a Boszporusznál.',
    colors: ['#F2C94C', '#F2994A'],
  },
  {
    id: 'bangkok',
    name: 'Bangkok',
    tagline: 'Wok-tűz és neonfény éjfél után.',
    colors: ['#6FCF97', '#219653'],
  },
  {
    id: 'newyork',
    name: 'New York',
    tagline: 'A sarki kocsiból lett birodalom.',
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
  // A kezdőváros nem ad bónuszt (az a 100%-os alap); minden további város ×2.
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
  if (!city) throw new Error(`Ismeretlen város: ${id}`);
  return city;
}

export function getCityIndex(id: CityId): number {
  return CITY_INDEX.get(id) ?? 0;
}

/** A soron következő, még nem birtokolt város (vagy null, ha mind megvan). */
export function nextLockedCity(unlockedIds: readonly CityId[]): CityDef | null {
  return CITIES.find((c) => !unlockedIds.includes(c.id)) ?? null;
}
