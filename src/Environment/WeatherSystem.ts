/**
 * WeatherSystem.ts — dynamic weather and the march from afternoon to night.
 *
 * Weather is not decoration here; each state changes the information available
 * to both sides:
 *   • Rain masks footsteps and knocks flies out of the air, which favours
 *     survivors trying to move.
 *   • Storms cut visibility and drown out whistles, which favours whoever moves
 *     first and decisively.
 *   • Fog cuts sight range for everyone, including the AI, so herds scatter
 *     less predictably.
 *   • Night is the big one: the round always ends in darkness, so the last
 *     three minutes play completely differently from the first three.
 */

import {
  RAIN_NOISE_DAMPING,
  ROUND_DURATION,
  TIME_OF_DAY_END,
  TIME_OF_DAY_START,
  WEATHER_MAX_DURATION,
  WEATHER_MIN_DURATION,
  WEATHER_WEIGHTS,
} from '../Systems/Config';
import { Weather } from '../Core/Types';
import { Rng } from '../Systems/Rng';
import { clamp01, lerp, smoothstep } from '../Systems/Noise';

/** Everything downstream systems need to know about the sky. */
export interface WeatherState {
  current: Weather;
  /** The state being blended towards, so transitions are gradual. */
  next: Weather;
  /** 0..1 blend between current and next. */
  blend: number;
  /** Seconds until the next weather change. */
  timeToChange: number;
  /** Effective rain intensity, 0..1. */
  rain: number;
  /** Effective fog density, 0..1. */
  fog: number;
  /** Wind strength, 0..1 — drives foliage sway and rain slant. */
  wind: number;
  /** Lightning flash intensity this frame, 0..1. Storms only. */
  lightning: number;
  /** Seconds until the next lightning strike. */
  nextStrike: number;
  /** Hour of day, 0..24. */
  hour: number;
  /** 0 = full daylight, 1 = full night. */
  nightFactor: number;
}

const WEATHER_ORDER: Weather[] = [
  Weather.Clear,
  Weather.Cloudy,
  Weather.Rain,
  Weather.Storm,
  Weather.Fog,
];

/** Target rain/fog/wind values per weather state. */
const WEATHER_PROFILE: Record<Weather, { rain: number; fog: number; wind: number }> = {
  [Weather.Clear]: { rain: 0, fog: 0.06, wind: 0.18 },
  [Weather.Cloudy]: { rain: 0, fog: 0.16, wind: 0.34 },
  [Weather.Rain]: { rain: 0.62, fog: 0.3, wind: 0.42 },
  [Weather.Storm]: { rain: 1, fog: 0.45, wind: 0.92 },
  [Weather.Fog]: { rain: 0.05, fog: 0.92, wind: 0.1 },
};

export function createWeather(rng: Rng): WeatherState {
  const start = rng.pickWeighted(WEATHER_ORDER, WEATHER_ORDER.map((w) => WEATHER_WEIGHTS[w]));
  const profile = WEATHER_PROFILE[start];
  return {
    current: start,
    next: start,
    blend: 1,
    timeToChange: rng.range(WEATHER_MIN_DURATION, WEATHER_MAX_DURATION),
    rain: profile.rain,
    fog: profile.fog,
    wind: profile.wind,
    lightning: 0,
    nextStrike: rng.range(4, 14),
    hour: TIME_OF_DAY_START,
    nightFactor: 0,
  };
}

/**
 * Advance the weather and the clock.
 *
 * `roundElapsed` drives the time of day so the sunset always lands at the same
 * dramatic point in the round regardless of frame rate or joins.
 */
export function updateWeather(
  state: WeatherState,
  rng: Rng,
  roundElapsed: number,
  dt: number,
): void {
  // --- Time of day -------------------------------------------------------
  const t = clamp01(roundElapsed / ROUND_DURATION);
  state.hour = lerp(TIME_OF_DAY_START, TIME_OF_DAY_END, t);
  // Dusk begins around 18:00 and it is fully dark by 20:30.
  state.nightFactor = smoothstep(17.8, 20.5, state.hour);

  // --- Weather transitions ----------------------------------------------
  state.timeToChange -= dt;
  if (state.timeToChange <= 0 && state.blend >= 1) {
    const weights = WEATHER_ORDER.map((w) => {
      let weight = WEATHER_WEIGHTS[w];
      // Never repeat the same state twice in a row.
      if (w === state.current) weight *= 0.15;
      // Fog is a dawn/dusk phenomenon; make it much likelier after sunset.
      if (w === Weather.Fog) weight *= 0.5 + state.nightFactor * 2.2;
      // Storms build out of rain rather than out of a clear sky.
      if (w === Weather.Storm && state.current === Weather.Clear) weight *= 0.35;
      return weight;
    });
    state.next = rng.pickWeighted(WEATHER_ORDER, weights);
    state.blend = 0;
    state.timeToChange = rng.range(WEATHER_MIN_DURATION, WEATHER_MAX_DURATION);
  }

  // Blend over ~14 seconds so the sky never snaps.
  if (state.blend < 1) {
    state.blend = Math.min(1, state.blend + dt / 14);
    if (state.blend >= 1) state.current = state.next;
  }

  const a = WEATHER_PROFILE[state.current];
  const b = WEATHER_PROFILE[state.next];
  const k = state.blend;
  state.rain = lerp(a.rain, b.rain, k);
  state.fog = lerp(a.fog, b.fog, k);
  state.wind = lerp(a.wind, b.wind, k);

  // Night air is heavier: nudge fog up after dark regardless of weather.
  state.fog = clamp01(state.fog + state.nightFactor * 0.12);

  // --- Lightning --------------------------------------------------------
  const stormy = state.rain > 0.85;
  state.lightning = Math.max(0, state.lightning - dt * 4.5);
  if (stormy) {
    state.nextStrike -= dt;
    if (state.nextStrike <= 0) {
      state.lightning = rng.range(0.6, 1);
      state.nextStrike = rng.range(3.5, 16);
    }
  } else {
    state.nextStrike = Math.max(state.nextStrike, 4);
  }
}

/** Multiplier applied to emitted noise — rain hides you. */
export function noiseDamping(state: WeatherState): number {
  return lerp(1, RAIN_NOISE_DAMPING, clamp01(state.rain));
}

/** Multiplier applied to sight ranges. */
export function visibilityFactor(state: WeatherState): number {
  const fogPenalty = 1 - state.fog * 0.62;
  const rainPenalty = 1 - state.rain * 0.22;
  const nightPenalty = 1 - state.nightFactor * 0.42;
  return clamp01(fogPenalty * rainPenalty * nightPenalty);
}

/**
 * The minimum a caller needs to label the sky. Declared separately from the
 * full WeatherState so the HUD can format a label from a network packet without
 * having to fabricate a whole simulation state.
 */
export interface WeatherLabelInput {
  current: Weather;
  nightFactor: number;
}

/** Human-readable label for the HUD. */
export function weatherLabel(state: WeatherLabelInput): string {
  switch (state.current) {
    case Weather.Clear:
      return state.nightFactor > 0.6 ? 'Clear night' : 'Sunny';
    case Weather.Cloudy:
      return 'Overcast';
    case Weather.Rain:
      return 'Rain';
    case Weather.Storm:
      return 'Tropical storm';
    case Weather.Fog:
      return 'Jungle fog';
    default:
      return 'Unknown';
  }
}

export function weatherEmoji(state: WeatherLabelInput): string {
  switch (state.current) {
    case Weather.Clear:
      return state.nightFactor > 0.6 ? '🌙' : '☀️';
    case Weather.Cloudy:
      return '⛅';
    case Weather.Rain:
      return '🌧️';
    case Weather.Storm:
      return '⛈️';
    case Weather.Fog:
      return '🌫️';
    default:
      return '☁️';
  }
}

/** Time-of-day label, for the HUD and the round summary. */
export function timeOfDayLabel(state: WeatherState): string {
  const h = state.hour;
  if (h < 17) return 'Afternoon';
  if (h < 18.6) return 'Golden hour';
  if (h < 19.6) return 'Sunset';
  if (h < 20.6) return 'Dusk';
  return 'Night';
}
