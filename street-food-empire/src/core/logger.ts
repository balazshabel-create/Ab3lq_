/**
 * Nagyon könnyű naplózó. Éles buildben csak a `warn`/`error` marad meg, és
 * ezeket egy opcionális crash-reporter sinkbe is továbbítjuk (Sentry, Crashlytics
 * – lásd docs/ARCHITECTURE.md). Nem használunk külső log-könyvtárat, mert a
 * game loop másodpercenként sokszor fut.
 */

import { IS_DEV } from '@/core/env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogSink = (level: LogLevel, message: string, context?: unknown) => void;

const sinks: LogSink[] = [];

let minLevel: LogLevel = IS_DEV ? 'debug' : 'warn';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

/** Külső sink regisztrálása (pl. Sentry). Visszaad egy leiratkozó függvényt. */
export function addLogSink(sink: LogSink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}

function emit(level: LogLevel, message: string, context?: unknown): void {
  if (ORDER[level] < ORDER[minLevel]) return;

  const prefix = `[SFE:${level}]`;
  if (level === 'error') console.error(prefix, message, context ?? '');
  else if (level === 'warn') console.warn(prefix, message, context ?? '');
  else console.log(prefix, message, context ?? '');

  for (const sink of sinks) {
    try {
      sink(level, message, context);
    } catch {
      // Egy hibás sink soha ne döntse be a játékot.
    }
  }
}

export const log = {
  debug: (message: string, context?: unknown) => emit('debug', message, context),
  info: (message: string, context?: unknown) => emit('info', message, context),
  warn: (message: string, context?: unknown) => emit('warn', message, context),
  error: (message: string, context?: unknown) => emit('error', message, context),
};

/**
 * Biztonságos hívás: a visszaadott érték soha nem dob. Az egész játékban ezzel
 * hívunk minden olyan kódot, ami natív modulhoz vagy hálózathoz nyúl.
 */
export async function safeAsync<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.warn(`${label} sikertelen`, err);
    return fallback;
  }
}

export function safeSync<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    log.warn(`${label} sikertelen`, err);
    return fallback;
  }
}
