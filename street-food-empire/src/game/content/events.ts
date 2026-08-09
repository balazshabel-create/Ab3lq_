import type { GameEventDef } from '@/game/types';

/**
 * TIMED EVENTS
 *
 * Fully offline: the rules are computed from the device's local date, no
 * network needed. That is why an event never "expires" even if the player does
 * not update for months.
 *
 * Optionally overridable with a remote JSON (SFE_EVENTS_URL) - see
 * services/remoteEvents.ts. That is the ONLY online feature in the game, and if
 * it is unreachable the local calendar keeps working unchanged.
 */

export const GAME_EVENTS: readonly GameEventDef[] = [
  {
    id: 'weekend-rush',
    name: 'Weekend Rush',
    description: 'Double income at every stand on Saturday and Sunday.',
    schedule: { kind: 'weekly', days: [6, 0] },
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 2 }],
    color: '#F2994A',
    icon: 'flame',
  },
  {
    id: 'happy-hour',
    name: 'Payday Mood',
    description: 'x3 income on the 10th and 25th of every month.',
    schedule: { kind: 'monthDays', days: [10, 25] },
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 3 }],
    color: '#6FCF97',
    icon: 'coin',
  },
  {
    id: 'night-market',
    name: 'Night Market',
    description: 'Everything cooks in half the time on Wednesdays.',
    schedule: { kind: 'weekly', days: [3] },
    effects: [{ type: 'cycleMultiplier', scope: { kind: 'global' }, value: 0.5 }],
    color: '#BB6BD9',
    icon: 'moon',
  },
  {
    id: 'street-festival',
    name: 'Street Music Festival',
    description: 'Double offline income and a bigger cap on the 1st.',
    schedule: { kind: 'monthDays', days: [1] },
    effects: [
      { type: 'offlineRate', value: 0.25 },
      { type: 'offlineCapHours', value: 4 },
    ],
    color: '#56CCF2',
    icon: 'star',
  },
];

/** Is the event active today? `wallMs` is local time. */
export function isEventActive(def: GameEventDef, wallMs: number): boolean {
  const date = new Date(wallMs);
  switch (def.schedule.kind) {
    case 'weekly':
      return def.schedule.days.includes(date.getDay());
    case 'monthDays':
      return def.schedule.days.includes(date.getDate());
    case 'dateRange': {
      const start = Date.parse(`${def.schedule.startsOn}T00:00:00`);
      const end = Date.parse(`${def.schedule.endsOn}T23:59:59`);
      if (Number.isNaN(start) || Number.isNaN(end)) return false;
      return wallMs >= start && wallMs <= end;
    }
    default:
      return false;
  }
}

export function activeEvents(wallMs: number): readonly GameEventDef[] {
  return GAME_EVENTS.filter((e) => isEventActive(e, wallMs));
}

/** When does today's event end (local midnight)? For the countdown. */
export function endOfLocalDay(wallMs: number): number {
  const d = new Date(wallMs);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
