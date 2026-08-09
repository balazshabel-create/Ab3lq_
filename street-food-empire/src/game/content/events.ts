import type { GameEventDef } from '@/game/types';

/**
 * IDŐSZAKOS ESEMÉNYEK
 *
 * Teljesen offline működnek: a szabályok a készülék helyi dátumából
 * számítódnak, nincs szükség hálózatra. Ezért az esemény nem "jár le" akkor
 * sem, ha a játékos hónapokig nem frissít.
 *
 * Opcionálisan felülírható távoli JSON-nal (SFE_EVENTS_URL) – lásd
 * services/remoteEvents.ts. Ez az EGYETLEN online funkció a játékban, és ha
 * nem elérhető, a helyi naptár változatlanul működik.
 */

export const GAME_EVENTS: readonly GameEventDef[] = [
  {
    id: 'weekend-rush',
    name: 'Hétvégi roham',
    description: 'Szombat–vasárnap dupla bevétel minden standon.',
    schedule: { kind: 'weekly', days: [6, 0] },
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 2 }],
    color: '#F2994A',
    icon: 'flame',
  },
  {
    id: 'happy-hour',
    name: 'Fizetésnapi hangulat',
    description: 'Minden hónap 10-én és 25-én ×3 bevétel.',
    schedule: { kind: 'monthDays', days: [10, 25] },
    effects: [{ type: 'incomeMultiplier', scope: { kind: 'global' }, value: 3 }],
    color: '#6FCF97',
    icon: 'coin',
  },
  {
    id: 'night-market',
    name: 'Éjjeli piac',
    description: 'Szerdánként feleannyi idő alatt készül el minden.',
    schedule: { kind: 'weekly', days: [3] },
    effects: [{ type: 'cycleMultiplier', scope: { kind: 'global' }, value: 0.5 }],
    color: '#BB6BD9',
    icon: 'moon',
  },
  {
    id: 'street-festival',
    name: 'Utcazenei fesztivál',
    description: 'A hónap 1-jén dupla offline bevétel és nagyobb sapka.',
    schedule: { kind: 'monthDays', days: [1] },
    effects: [
      { type: 'offlineRate', value: 0.25 },
      { type: 'offlineCapHours', value: 4 },
    ],
    color: '#56CCF2',
    icon: 'star',
  },
];

/** Ma aktív-e az esemény? A `wallMs` a helyi idő. */
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

/** Mikor ér véget a ma aktív esemény (helyi éjfél)? Visszaszámlálóhoz. */
export function endOfLocalDay(wallMs: number): number {
  const d = new Date(wallMs);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
