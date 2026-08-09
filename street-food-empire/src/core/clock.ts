/**
 * Időforrás és óracsalás-védelem.
 *
 * Az offline bevétel a fali óra (Date.now) különbségéből számolódik, amit a
 * játékos át tud állítani. Két védelmet használunk, mindkettő offline működik:
 *
 *  1. **Monoton óra** (performance.now): ez nem állítható át, és a folyamat
 *     élettartama alatt mindig előre megy. Amíg az app fut, ezt használjuk.
 *  2. **Magas vízszint** (`maxSeenWallClock`): a mentés eltárolja a valaha
 *     látott legnagyobb fali óra értéket. Ha a játékos visszaállítja az órát,
 *     a különbség negatív lesz -> 0 másodpercnek vesszük, és amíg vissza nem
 *     éri a magas vízszintet, nem termel offline bevételt.
 *
 * Ez nem kriptográfiai védelem (offline játéknál az nem is lehetséges), de a
 * "állítsd előre az órát egy évvel" trükköt megfogja: az offline sapka miatt
 * egyszerre legfeljebb a maximális offline idő nyerhető.
 */

export type ClockReading = {
  /** Fali óra, ms (Date.now) */
  wall: number;
  /** Monoton óra, ms – csak különbségek képzésére alkalmas */
  mono: number;
};

export interface Clock {
  read(): ClockReading;
}

export const systemClock: Clock = {
  read: () => ({
    wall: Date.now(),
    mono:
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now(),
  }),
};

/** Teszteléshez: kézzel léptethető óra. */
export function createTestClock(startWall = 1_700_000_000_000): Clock & {
  advance(ms: number): void;
  setWall(wall: number): void;
} {
  let wall = startWall;
  let mono = 0;
  return {
    read: () => ({ wall, mono }),
    advance(ms: number) {
      wall += ms;
      mono += ms;
    },
    setWall(next: number) {
      // A monoton óra NEM ugrik – pont ezt modellezi a csalás.
      wall = next;
    },
  };
}

export type ElapsedResult = {
  /** Elfogadott eltelt idő másodpercben (soha nem negatív). */
  seconds: number;
  /** Igaz, ha az órát visszafelé állították (vagy időzóna-ugrás történt). */
  clockRolledBack: boolean;
  /** Az új magas vízszint, amit el kell menteni. */
  nextMaxSeenWall: number;
};

/**
 * Két mentés közt eltelt idő kiszámítása csalásvédelemmel.
 *
 * @param lastWall     a mentésben tárolt utolsó fali óra
 * @param maxSeenWall  a mentésben tárolt magas vízszint
 * @param now          aktuális óraállás
 */
export function computeElapsed(
  lastWall: number,
  maxSeenWall: number,
  now: ClockReading,
): ElapsedResult {
  const reference = Math.max(lastWall, maxSeenWall);
  const deltaMs = now.wall - reference;

  if (deltaMs < 0) {
    // Az óra visszafelé megy: nem adunk bevételt, de a vízszintet megtartjuk.
    return { seconds: 0, clockRolledBack: true, nextMaxSeenWall: reference };
  }

  return {
    seconds: deltaMs / 1000,
    clockRolledBack: false,
    nextMaxSeenWall: Math.max(reference, now.wall),
  };
}

/** Helyi nap kulcsa (`2026-08-09`) – napi küldetések resetjéhez. */
export function localDayKey(wallMs: number): string {
  const d = new Date(wallMs);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}
