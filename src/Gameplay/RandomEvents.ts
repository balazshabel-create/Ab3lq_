/**
 * RandomEvents.ts — the chaos layer.
 *
 * Events exist to break stalemates. Roughly two minutes into a round the
 * survivors have found their bushes and the hunter has run out of leads; an
 * event forces everybody to move, or floods the riverbank they were all hiding
 * along, or fills the map with so many crocodiles that the hunter genuinely
 * cannot tell which one is which.
 *
 * Every event announces itself to all players. Concealing them would just feel
 * like a bug, and the announcement is itself a tactical beat: everyone knows
 * the fog is coming, so everyone repositions at once.
 */

import {
  EVENT_CHANCE,
  EVENT_INTERVAL_MAX,
  EVENT_INTERVAL_MIN,
  EVENT_LOCKOUT_END,
  EVENT_LOCKOUT_START,
  ROUND_DURATION,
} from '../Systems/Config';
import { Species } from '../Animals/AnimalTypes';
import { Weather } from '../Core/Types';
import { Rng } from '../Systems/Rng';

export enum EventId {
  TropicalStorm = 'tropical_storm',
  CrocodileMigration = 'crocodile_migration',
  FlashFlood = 'flash_flood',
  JaguarTerritory = 'jaguar_territory',
  JungleFog = 'jungle_fog',
  FruitFall = 'fruit_fall',
  InsectBloom = 'insect_bloom',
  MonkeyRiot = 'monkey_riot',
  DeadCalm = 'dead_calm',
}

export interface EventDef {
  id: EventId;
  name: string;
  emoji: string;
  /** Banner text shown to every player. */
  announcement: string;
  /** Longer explanation shown under the banner. */
  detail: string;
  duration: number;
  /** Relative likelihood of being picked. */
  weight: number;
  /** Weather this event forces, if any. */
  forcesWeather?: Weather;
  /** Species to spawn a burst of, and how many. */
  spawnBurst?: { species: Species; count: number };
  /** Multiplier on the river water level. */
  waterRise?: number;
  /** Multiplier applied to all AI movement speed. */
  aiSpeedScale?: number;
  /** Multiplier applied to global noise levels. */
  noiseScale?: number;
  /** Extra food sources to make available. */
  refillFood?: boolean;
}

export const EVENTS: Record<EventId, EventDef> = {
  [EventId.TropicalStorm]: {
    id: EventId.TropicalStorm,
    name: 'Tropical Storm',
    emoji: '🌩️',
    announcement: 'A TROPICAL STORM ROLLS IN',
    detail: 'Visibility is collapsing and the rain is swallowing every sound.',
    duration: 75,
    weight: 16,
    forcesWeather: Weather.Storm,
    noiseScale: 0.55,
  },
  [EventId.CrocodileMigration]: {
    id: EventId.CrocodileMigration,
    name: 'Crocodile Migration',
    emoji: '🐊',
    announcement: 'CROCODILE MIGRATION',
    detail: 'The river is suddenly full of caimans. Good luck telling them apart.',
    duration: 90,
    weight: 13,
    spawnBurst: { species: Species.Caiman, count: 22 },
  },
  [EventId.FlashFlood]: {
    id: EventId.FlashFlood,
    name: 'Flash Flood',
    emoji: '🌊',
    announcement: 'FLASH FLOOD',
    detail: 'The river is rising fast. The banks are no longer safe ground.',
    duration: 70,
    weight: 11,
    waterRise: 1.7,
    forcesWeather: Weather.Rain,
  },
  [EventId.JaguarTerritory]: {
    id: EventId.JaguarTerritory,
    name: 'Jaguar Territory',
    emoji: '🐆',
    announcement: 'A JAGUAR IS HUNTING',
    detail: 'Something big has claimed this stretch of jungle, and it is not a player.',
    duration: 80,
    weight: 12,
    spawnBurst: { species: Species.Jaguar, count: 3 },
  },
  [EventId.JungleFog]: {
    id: EventId.JungleFog,
    name: 'Jungle Fog',
    emoji: '🌫️',
    announcement: 'FOG FLOODS THE VALLEY',
    detail: 'You can see about four metres. So can everything else.',
    duration: 65,
    weight: 14,
    forcesWeather: Weather.Fog,
  },
  [EventId.FruitFall]: {
    id: EventId.FruitFall,
    name: 'Fruit Fall',
    emoji: '🥭',
    announcement: 'THE CANOPY IS DROPPING FRUIT',
    detail: 'Food everywhere — and everything in the jungle knows it.',
    duration: 50,
    weight: 12,
    refillFood: true,
  },
  [EventId.InsectBloom]: {
    id: EventId.InsectBloom,
    name: 'Insect Bloom',
    emoji: '🦟',
    announcement: 'INSECT BLOOM',
    detail: 'Clouds of midges everywhere. Are those flies on that capybara, or just the bloom?',
    duration: 60,
    weight: 13,
  },
  [EventId.MonkeyRiot]: {
    id: EventId.MonkeyRiot,
    name: 'Monkey Riot',
    emoji: '🐒',
    announcement: 'THE HOWLERS HAVE LOST IT',
    detail: 'Every monkey in the valley is screaming. Perfect cover, total confusion.',
    duration: 55,
    weight: 12,
    spawnBurst: { species: Species.HowlerMonkey, count: 14 },
    noiseScale: 0.6,
  },
  [EventId.DeadCalm]: {
    id: EventId.DeadCalm,
    name: 'Dead Calm',
    emoji: '🍃',
    announcement: 'THE JUNGLE GOES QUIET',
    detail: 'No wind, no rain, no birds. Every footstep carries.',
    duration: 45,
    weight: 10,
    forcesWeather: Weather.Clear,
    noiseScale: 1.55,
    aiSpeedScale: 0.72,
  },
};

export const ALL_EVENTS: EventId[] = Object.keys(EVENTS) as EventId[];

/** One currently running event. */
export interface ActiveEvent {
  id: EventId;
  timeLeft: number;
  /** Total duration, for progress bars. */
  duration: number;
  /** Set on the tick it started, so the client can play the banner once. */
  justStarted: boolean;
}

/** Scheduler state. */
export interface EventSchedule {
  nextIn: number;
  active: ActiveEvent[];
  /** Events already fired this round, to avoid repeats. */
  fired: EventId[];
}

export function createSchedule(rng: Rng): EventSchedule {
  return {
    nextIn: rng.range(EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX),
    active: [],
    fired: [],
  };
}

/**
 * Advance the scheduler. Returns any events that started this tick so the
 * simulation can apply their one-off effects (spawn bursts, food refills).
 */
export function updateSchedule(
  schedule: EventSchedule,
  rng: Rng,
  roundElapsed: number,
  dt: number,
): EventDef[] {
  const started: EventDef[] = [];

  // Expire running events.
  for (let i = schedule.active.length - 1; i >= 0; i--) {
    const evt = schedule.active[i];
    evt.justStarted = false;
    evt.timeLeft -= dt;
    if (evt.timeLeft <= 0) schedule.active.splice(i, 1);
  }

  // No events at the very start (players need to orient) or the very end
  // (a flood in the last ten seconds is just unfair).
  const tooEarly = roundElapsed < EVENT_LOCKOUT_START;
  const tooLate = roundElapsed > ROUND_DURATION - EVENT_LOCKOUT_END;
  if (tooEarly || tooLate) return started;

  schedule.nextIn -= dt;
  if (schedule.nextIn > 0) return started;

  schedule.nextIn = rng.range(EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX);
  if (!rng.chance(EVENT_CHANCE)) return started;

  // Only one weather-forcing event at a time, or the sky fights itself.
  const weatherBusy = schedule.active.some((a) => EVENTS[a.id].forcesWeather !== undefined);

  const candidates = ALL_EVENTS.filter((id) => {
    if (schedule.active.some((a) => a.id === id)) return false;
    if (weatherBusy && EVENTS[id].forcesWeather !== undefined) return false;
    return true;
  });
  if (candidates.length === 0) return started;

  const weights = candidates.map((id) => {
    // Firing the same event twice in a round is possible but unlikely.
    const repeat = schedule.fired.includes(id) ? 0.25 : 1;
    return EVENTS[id].weight * repeat;
  });

  const chosen = rng.pickWeighted(candidates, weights);
  const def = EVENTS[chosen];
  schedule.active.push({
    id: chosen,
    timeLeft: def.duration,
    duration: def.duration,
    justStarted: true,
  });
  schedule.fired.push(chosen);
  started.push(def);
  return started;
}

/** Combined noise multiplier from all running events. */
export function eventNoiseScale(schedule: EventSchedule): number {
  let scale = 1;
  for (const a of schedule.active) scale *= EVENTS[a.id].noiseScale ?? 1;
  return scale;
}

/** Combined AI speed multiplier from all running events. */
export function eventAiSpeedScale(schedule: EventSchedule): number {
  let scale = 1;
  for (const a of schedule.active) scale *= EVENTS[a.id].aiSpeedScale ?? 1;
  return scale;
}

/** Extra water level from a flood, in metres above the normal water line. */
export function eventWaterRise(schedule: EventSchedule): number {
  let rise = 0;
  for (const a of schedule.active) {
    const def = EVENTS[a.id];
    if (!def.waterRise) continue;
    // Ease in and out so the flood visibly swells and recedes.
    const t = 1 - Math.abs((a.timeLeft / a.duration) * 2 - 1);
    rise = Math.max(rise, (def.waterRise - 1) * t);
  }
  return rise;
}

/** Weather forced by a running event, if any. */
export function eventForcedWeather(schedule: EventSchedule): Weather | null {
  for (const a of schedule.active) {
    const w = EVENTS[a.id].forcesWeather;
    if (w) return w;
  }
  return null;
}
