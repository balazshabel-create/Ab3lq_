import AsyncStorage from '@react-native-async-storage/async-storage';

import { GAME_CONFIG } from '@/config/gameConfig';
import { log, safeAsync } from '@/core/logger';
import { createInitialState } from '@/game/initialState';
import type { GameState } from '@/game/types';
import { computeChecksum, verifyChecksum } from '@/persistence/checksum';
import { migrateAndCoerce } from '@/persistence/migrations';

/**
 * MENTÉSI RENDSZER
 *
 * Tervezési elvek:
 *  - **Sose veszítsünk mentést.** Írás előtt az előző jó mentés átkerül a
 *    backup kulcsra. Betöltéskor, ha a fő mentés sérült, a backupról indulunk.
 *  - **Atomiság közelítése.** Az AsyncStorage `setItem` nem tranzakciós, de a
 *    checksum miatt a félig kiírt adat felismerhető és eldobható.
 *  - **Írásritkítás.** A game loop nem ment minden ticknél; a `SaveScheduler`
 *    összevonja a kéréseket (debounce) és periodikusan is ment.
 *  - **Sose dobjon.** Minden hiba naplózásra kerül, és a játék megy tovább –
 *    egy mentési hiba miatt nem fagyhat ki az app.
 */

type SaveEnvelope = {
  /** Formátumverzió az envelope-hoz (nem a játékállapothoz). */
  f: 1;
  /** A játékállapot JSON-ként. */
  d: string;
  /** Ellenőrzőösszeg. */
  c: string;
  /** Mentés ideje (diagnosztikához). */
  t: number;
};

export type LoadOutcome =
  | { kind: 'loaded'; state: GameState }
  | { kind: 'restoredBackup'; state: GameState; reason: string }
  | { kind: 'fresh'; state: GameState; reason: string };

function serialize(state: GameState): string {
  const payload = JSON.stringify(state);
  const envelope: SaveEnvelope = {
    f: 1,
    d: payload,
    c: computeChecksum(payload, GAME_CONFIG.save.checksumSalt),
    t: Date.now(),
  };
  return JSON.stringify(envelope);
}

type ParseResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

function deserialize(text: string, wallMs: number): ParseResult {
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'A mentés nem érvényes JSON.' };
  }

  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, reason: 'A mentés üres vagy hibás.' };
  }

  const { d, c } = envelope as Partial<SaveEnvelope>;
  if (typeof d !== 'string' || typeof c !== 'string') {
    return { ok: false, reason: 'Hiányzó mezők a mentésben.' };
  }

  if (!verifyChecksum(d, GAME_CONFIG.save.checksumSalt, c)) {
    return { ok: false, reason: 'Az ellenőrzőösszeg nem egyezik (sérült mentés).' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(d);
  } catch {
    return { ok: false, reason: 'A játékállapot nem olvasható.' };
  }

  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'A játékállapot nem objektum.' };
  }

  try {
    return { ok: true, state: migrateAndCoerce(raw as Record<string, unknown>, wallMs) };
  } catch (err) {
    return { ok: false, reason: `Migráció sikertelen: ${String(err)}` };
  }
}

/** Betöltés a fő kulcsról, szükség esetén a backupról, végső esetben új játék. */
export async function loadGame(wallMs: number = Date.now()): Promise<LoadOutcome> {
  const primary = await safeAsync(
    'Mentés olvasása',
    () => AsyncStorage.getItem(GAME_CONFIG.save.storageKey),
    null,
  );

  if (primary) {
    const parsed = deserialize(primary, wallMs);
    if (parsed.ok) return { kind: 'loaded', state: parsed.state };
    log.warn('A fő mentés nem használható, próbáljuk a biztonsági másolatot', parsed.reason);

    const backup = await safeAsync(
      'Biztonsági mentés olvasása',
      () => AsyncStorage.getItem(GAME_CONFIG.save.backupKey),
      null,
    );

    if (backup) {
      const backupParsed = deserialize(backup, wallMs);
      if (backupParsed.ok) {
        return { kind: 'restoredBackup', state: backupParsed.state, reason: parsed.reason };
      }
      log.error('A biztonsági mentés is sérült', backupParsed.reason);
    }

    return {
      kind: 'fresh',
      state: createInitialState(wallMs),
      reason: parsed.reason,
    };
  }

  // Nincs mentés: első indítás.
  return { kind: 'fresh', state: createInitialState(wallMs), reason: 'Nincs korábbi mentés.' };
}

/** Mentés. A korábbi jó mentés előbb átkerül a backup kulcsra. */
export async function saveGame(state: GameState): Promise<boolean> {
  return safeAsync(
    'Mentés írása',
    async () => {
      const previous = await AsyncStorage.getItem(GAME_CONFIG.save.storageKey);
      if (previous) {
        await AsyncStorage.setItem(GAME_CONFIG.save.backupKey, previous);
      }
      await AsyncStorage.setItem(GAME_CONFIG.save.storageKey, serialize(state));
      return true;
    },
    false,
  );
}

export async function clearSave(): Promise<void> {
  await safeAsync(
    'Mentés törlése',
    async () => {
      await AsyncStorage.removeItem(GAME_CONFIG.save.storageKey);
      await AsyncStorage.removeItem(GAME_CONFIG.save.backupKey);
    },
    undefined,
  );
}

/** Nyers export – a játékos "biztonsági másolat" gombjához (vágólapra). */
export function exportSave(state: GameState): string {
  return serialize(state);
}

/** Nyers import. Ellenőrzi a checksumot, tehát tetszőleges szöveget nem fogad el. */
export function importSave(text: string, wallMs: number = Date.now()): ParseResult {
  return deserialize(text.trim(), wallMs);
}

// ---------------------------------------------------------------------------
// Ütemező
// ---------------------------------------------------------------------------

/**
 * Összevonja a mentési kéréseket: sok gyors akció (pl. „Max” vásárlás
 * sorozatban) is csak egy írást okoz. Emellett `autoSaveSeconds`-enként
 * mindenképp ment, hogy egy váratlan kilövés se vigyen sokat.
 */
export class SaveScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private pending = false;
  private writing = false;

  constructor(
    private readonly getState: () => GameState,
    private readonly debounceMs = 1500,
  ) {}

  start(): void {
    this.stop();
    this.interval = setInterval(() => {
      void this.flush();
    }, GAME_CONFIG.save.autoSaveSeconds * 1000);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
    this.interval = null;
    this.timer = null;
  }

  /** Mentést kér. Az írás legkésőbb `debounceMs` múlva megtörténik. */
  request(): void {
    this.pending = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Azonnali mentés (háttérbe váltáskor, kilépéskor). */
  async flush(): Promise<boolean> {
    if (this.writing) return false;
    this.writing = true;
    this.pending = false;
    try {
      return await saveGame(this.getState());
    } finally {
      this.writing = false;
    }
  }

  get hasPending(): boolean {
    return this.pending;
  }
}
