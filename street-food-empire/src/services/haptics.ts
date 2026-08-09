import * as Haptics from 'expo-haptics';

import { safeSync } from '@/core/logger';

/**
 * Rezgés-visszajelzés.
 *
 * A koppintásos idle játékban ez a legfontosabb "juiciness" elem, de két
 * dologra figyelni kell:
 *  - **kikapcsolható** legyen (Beállítások),
 *  - és ne fusson minden egyes koppintásnál gyors sorozatban, mert az
 *    olcsóbb Android készülékeken a rezgőmotor-hívás blokkolja a JS szálat.
 *    Ezért van benne throttle.
 */

let enabled = true;
let lastFiredAt = 0;
const MIN_INTERVAL_MS = 40;

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

function fire(run: () => void): void {
  if (!enabled) return;
  const now = Date.now();
  if (now - lastFiredAt < MIN_INTERVAL_MS) return;
  lastFiredAt = now;
  safeSync('Haptics', run, undefined);
}

/** Kézi kiszolgálás – a leggyakoribb, ezért a leggyengébb. */
export function tapFeedback(): void {
  fire(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Vásárlás sikerült. */
export function successFeedback(): void {
  fire(() => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Nem sikerült (nincs elég pénz). */
export function errorFeedback(): void {
  fire(() => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** Nagy esemény: városnyitás, franchise, mérföldkő. */
export function milestoneFeedback(): void {
  fire(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
}
