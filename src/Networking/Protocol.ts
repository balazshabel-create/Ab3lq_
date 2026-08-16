/**
 * Protocol.ts — the wire format.
 *
 * Two encodings, chosen per message on purpose:
 *
 *   • Snapshots are binary. With ~200 animals at 10 Hz, JSON would cost roughly
 *     200 KB/s per client and the garbage from parsing it would show up as
 *     frame hitches. The packed form is 15 bytes per actor, so a full snapshot
 *     of a busy jungle fits in about 3 KB.
 *   • Everything else — lobby state, role cards, results — is JSON. These are
 *     rare, structurally complex, and much easier to debug as text.
 *
 * Security note: the server never sends a client another player's role,
 * weakness, hunger or whistle timer. A snapshot contains only what an observer
 * standing in the jungle could actually see, which is why a client-side cheat
 * cannot reveal the hunter.
 */

import { ALL_SPECIES, Species } from '../Animals/AnimalTypes';
import type { Weather } from '../Core/Types';
import type { RoleCard, RoundResult, RoundStatus } from '../Gameplay/RoundState';
import type { EventId } from '../Gameplay/RandomEvents';
import type { NoiseKind } from '../Core/Types';

export const PROTOCOL_VERSION = 4;

// ---------------------------------------------------------------------------
// Message type tags
// ---------------------------------------------------------------------------

export enum ClientMsg {
  Join = 'join',
  SetReady = 'set_ready',
  StartRound = 'start_round',
  Input = 'input',
  Leave = 'leave',
  Ping = 'ping',
}

export enum ServerMsg {
  Welcome = 'welcome',
  Lobby = 'lobby',
  RoleCard = 'role_card',
  RoundStatus = 'round_status',
  Event = 'event',
  KillFeed = 'kill_feed',
  Scoreboard = 'scoreboard',
  Result = 'result',
  Error = 'error',
  Pong = 'pong',
}

/** First byte of a binary frame identifies it. */
export const BINARY_SNAPSHOT = 0x01;

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

/**
 * One tick of player intent.
 *
 * Movement is sent as a world-space direction plus a yaw, rather than as key
 * states, so the server does not need to know about the client's camera.
 */
export interface PlayerInput {
  /** Monotonic sequence number, for dropping stale packets. */
  seq: number;
  /** Desired move direction in world space, roughly unit length. */
  moveX: number;
  moveZ: number;
  /** Where the player is looking. */
  yaw: number;
  pitch: number;
  /** Bitmask of InputAction. */
  actions: number;
}

export enum InputAction {
  None = 0,
  Sprint = 1 << 0,
  Jump = 1 << 1,
  Whistle = 1 << 2,
  Eat = 1 << 3,
  Attack = 1 << 4,
  Submerge = 1 << 5,
  ClimbUp = 1 << 6,
  ClimbDown = 1 << 7,
  Ability = 1 << 8,
  Listen = 1 << 9,
  Focus = 1 << 10,
  Fly = 1 << 11,
  Ascend = 1 << 12,
  Descend = 1 << 13,
}

export function hasAction(actions: number, action: InputAction): boolean {
  return (actions & action) !== 0;
}

export type ClientPacket =
  | { t: ClientMsg.Join; name: string; version: number }
  | { t: ClientMsg.SetReady; ready: boolean }
  | { t: ClientMsg.StartRound }
  | { t: ClientMsg.Input; input: PlayerInput }
  | { t: ClientMsg.Leave }
  | { t: ClientMsg.Ping; time: number };

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export interface LobbyPlayer {
  clientId: string;
  name: string;
  ready: boolean;
  isHost: boolean;
  connected: boolean;
}

export interface LobbyState {
  players: LobbyPlayer[];
  /** Room code players can share. */
  code: string;
  maxPlayers: number;
  canStart: boolean;
}

/** A kill notification. Deliberately vague: species, never player names. */
/**
 * One line of the live scoreboard.
 *
 * Names and scores only — no species and no role. What a player is playing as
 * is the round's whole secret, and a scoreboard that leaked it would end the
 * game the moment somebody pressed Tab.
 */
export interface ScoreboardEntry {
  clientId: string;
  name: string;
  score: number;
  alive: boolean;
}

export interface KillFeedEntry {
  /** What was killed. */
  victimSpecies: Species;
  /** True if the victim was a person, which everybody finds out immediately. */
  victimWasPlayer: boolean;
  /** How it died. */
  cause: 'hunter' | 'predator' | 'starvation' | 'storm' | 'left';
  /** Rough distance from the receiving player, for "that was close" framing. */
  distance: number;
  time: number;
}

/**
 * The storm circle, as sent to clients.
 *
 * The client could recompute this from the ring plan and the round clock — it is
 * a pure function of both — but the plan is re-drawn every round while the world
 * seed is not, so there is no value the client already has that identifies this
 * round's circles. Sending the evaluated wall costs about a hundred bytes at the
 * status rate and removes any possibility of the drawn boundary disagreeing with
 * the one that does damage.
 */
export interface ZoneWire {
  x: number;
  z: number;
  radius: number;
  stage: number;
  totalStages: number;
  shrinking: boolean;
  /**
   * Seconds until the next shrink begins, or -1 when the circle is done closing.
   * Not Infinity: `JSON.stringify` turns that into `null` and the field would
   * arrive with the wrong type.
   */
  untilShrink: number;
  damageRate: number;
  /** Where the wall is heading, for the preview ring on the map. */
  next: { x: number; z: number; radius: number } | null;
}

export type ServerPacket =
  | {
      t: ServerMsg.Welcome;
      clientId: string;
      seed: number;
      version: number;
      /** Server's authoritative tick rate, so the client can pace prediction. */
      tickRate: number;
    }
  | { t: ServerMsg.Lobby; lobby: LobbyState }
  | { t: ServerMsg.RoleCard; card: RoleCard; actorId: number }
  | {
      t: ServerMsg.RoundStatus;
      status: RoundStatus;
      weather: { current: Weather; rain: number; fog: number; wind: number; hour: number };
      events: { id: EventId; timeLeft: number; duration: number; justStarted: boolean }[];
      zone: ZoneWire | null;
    }
  | { t: ServerMsg.Event; id: EventId; announcement: string; detail: string; emoji: string }
  | { t: ServerMsg.KillFeed; entry: KillFeedEntry }
  | { t: ServerMsg.Scoreboard; entries: ScoreboardEntry[] }
  | { t: ServerMsg.Result; result: RoundResult }
  | { t: ServerMsg.Error; message: string }
  | { t: ServerMsg.Pong; time: number };

// ---------------------------------------------------------------------------
// Binary snapshot encoding
// ---------------------------------------------------------------------------

/** Per-actor data as it appears on the wire. */
export interface SnapshotActor {
  id: number;
  species: Species;
  x: number;
  y: number;
  z: number;
  yaw: number;
  gait: number;
  flags: number;
  flies: number;
}

/** The private half of a snapshot: only ever sent to its owner. */
export interface SnapshotSelf {
  actorId: number;
  health: number;
  maxHealth: number;
  hunger: number;
  stamina: number;
  maxStamina: number;
  sinceWhistle: number;
  whistleCooldown: number;
  flies: number;
  eatProgress: number;
  /** 0..1, 1 = ready. */
  abilityReady: number;
  listenReady: number;
  focusReady: number;
  attackReady: number;
  digesting: number;
  /** This player's own score. Everyone else's arrives in the scoreboard. */
  score: number;
}

/** A noise the hunter's "listen" sense picked up. */
export interface SnapshotNoise {
  x: number;
  z: number;
  volume: number;
  kind: NoiseKind;
  age: number;
}

/** A footprint the hunter can read. */
export interface SnapshotTrack {
  x: number;
  z: number;
  yaw: number;
  species: Species;
  age: number;
}

export interface Snapshot {
  tick: number;
  time: number;
  actors: SnapshotActor[];
  self: SnapshotSelf | null;
  noises: SnapshotNoise[];
  tracks: SnapshotTrack[];
  /** Water level, which a flash flood raises. */
  waterLevel: number;
}

const SPECIES_INDEX = new Map<Species, number>();
ALL_SPECIES.forEach((s, i) => SPECIES_INDEX.set(s, i));

const NOISE_KINDS: NoiseKind[] = [
  'footstep',
  'splash',
  'whistle',
  'attack',
  'death',
  'eat',
  'call',
] as NoiseKind[];

// Frame layout sizes. These must match the writes in encodeSnapshot exactly —
// the buffer is allocated from them, so a mismatch is an immediate overrun.
const ACTOR_BYTES = 15; // id2 + species1 + xyz6 + yaw2 + gait1 + flags2 + flies1
const SELF_BYTES = 30; // eight u16 + six u8 + digesting u16 + 6 reserved
const NOISE_BYTES = 8; // x2 + z2 + volume1 + kind1 + age2
const TRACK_BYTES = 7; // x2 + z2 + yaw1 + species1 + age1
const HEADER_BYTES = 18; // tag1 + hasSelf1 + tick4 + time4 + 3×count2 + water2

/** Fixed-point helpers. Position uses 1/8 m, which is well under a pixel. */
const POS_SCALE = 8;
const HEIGHT_SCALE = 32;
const ANGLE_SCALE = 65535 / (Math.PI * 2);

function packAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return Math.round(x * ANGLE_SCALE) & 0xffff;
}

function unpackAngle(v: number): number {
  return v / ANGLE_SCALE;
}

/** Encode a snapshot into a compact binary frame. */
export function encodeSnapshot(snap: Snapshot): ArrayBuffer {
  const size =
    HEADER_BYTES +
    snap.actors.length * ACTOR_BYTES +
    (snap.self ? SELF_BYTES : 0) +
    snap.noises.length * NOISE_BYTES +
    snap.tracks.length * TRACK_BYTES;

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  let o = 0;

  view.setUint8(o, BINARY_SNAPSHOT); o += 1;
  view.setUint8(o, snap.self ? 1 : 0); o += 1;
  view.setUint32(o, snap.tick, true); o += 4;
  view.setFloat32(o, snap.time, true); o += 4;
  view.setUint16(o, snap.actors.length, true); o += 2;
  view.setUint16(o, snap.noises.length, true); o += 2;
  view.setUint16(o, snap.tracks.length, true); o += 2;
  // Water level packed as centimetres above zero.
  view.setUint16(o, Math.round(snap.waterLevel * 100) & 0xffff, true); o += 2;

  for (const a of snap.actors) {
    view.setUint16(o, a.id, true); o += 2;
    view.setUint8(o, SPECIES_INDEX.get(a.species) ?? 0); o += 1;
    view.setInt16(o, Math.round(a.x * POS_SCALE), true); o += 2;
    view.setInt16(o, Math.round(a.y * HEIGHT_SCALE), true); o += 2;
    view.setInt16(o, Math.round(a.z * POS_SCALE), true); o += 2;
    view.setUint16(o, packAngle(a.yaw), true); o += 2;
    view.setUint8(o, Math.round(Math.min(1, Math.max(0, a.gait)) * 255)); o += 1;
    view.setUint16(o, a.flags & 0xffff, true); o += 2;
    view.setUint8(o, Math.round(Math.min(1, Math.max(0, a.flies)) * 255)); o += 1;
  }

  if (snap.self) {
    const s = snap.self;
    view.setUint16(o, s.actorId, true); o += 2;
    view.setUint16(o, Math.round(s.health * 10), true); o += 2;
    view.setUint16(o, Math.round(s.maxHealth * 10), true); o += 2;
    view.setUint16(o, Math.round(s.hunger * 100), true); o += 2;
    view.setUint16(o, Math.round(s.stamina * 100), true); o += 2;
    view.setUint16(o, Math.round(s.maxStamina * 10), true); o += 2;
    view.setUint16(o, Math.round(Math.min(650, s.sinceWhistle) * 100), true); o += 2;
    view.setUint16(o, Math.round(s.whistleCooldown * 1000), true); o += 2;
    view.setUint8(o, Math.round(Math.min(1, s.flies) * 255)); o += 1;
    view.setUint8(o, Math.round(Math.min(1, s.eatProgress) * 255)); o += 1;
    view.setUint8(o, Math.round(Math.min(1, s.abilityReady) * 255)); o += 1;
    view.setUint8(o, Math.round(Math.min(1, s.listenReady) * 255)); o += 1;
    view.setUint8(o, Math.round(Math.min(1, s.focusReady) * 255)); o += 1;
    view.setUint8(o, Math.round(Math.min(1, s.attackReady) * 255)); o += 1;
    view.setUint16(o, Math.round(Math.min(650, s.digesting) * 100), true); o += 2;
    // Score takes four of the six reserved bytes' worth of room — as a u32,
    // because a long round with a busy hunter can pass 65,535 and a score that
    // silently wraps to zero is worse than no score at all.
    view.setUint32(o, Math.max(0, Math.min(0xffffffff, Math.round(s.score))), true); o += 4;
    // Reserved padding to keep SELF_BYTES stable as fields are added.
    view.setUint16(o, 0, true); o += 2;
  }

  for (const n of snap.noises) {
    view.setInt16(o, Math.round(n.x * POS_SCALE), true); o += 2;
    view.setInt16(o, Math.round(n.z * POS_SCALE), true); o += 2;
    view.setUint8(o, Math.round(Math.min(255, n.volume))); o += 1;
    view.setUint8(o, Math.max(0, NOISE_KINDS.indexOf(n.kind))); o += 1;
    view.setUint16(o, Math.round(Math.min(650, n.age) * 100), true); o += 2;
  }

  for (const tr of snap.tracks) {
    view.setInt16(o, Math.round(tr.x * POS_SCALE), true); o += 2;
    view.setInt16(o, Math.round(tr.z * POS_SCALE), true); o += 2;
    view.setUint8(o, Math.round((packAngle(tr.yaw) / 65535) * 255)); o += 1;
    view.setUint8(o, SPECIES_INDEX.get(tr.species) ?? 0); o += 1;
    view.setUint8(o, Math.round(Math.min(255, tr.age))); o += 1;
  }

  return buf;
}

/** Decode a binary snapshot frame. */
export function decodeSnapshot(buf: ArrayBuffer): Snapshot | null {
  const view = new DataView(buf);
  if (view.byteLength < HEADER_BYTES) return null;
  if (view.getUint8(0) !== BINARY_SNAPSHOT) return null;

  let o = 1;
  const hasSelf = view.getUint8(o) === 1; o += 1;
  const tick = view.getUint32(o, true); o += 4;
  const time = view.getFloat32(o, true); o += 4;
  const actorCount = view.getUint16(o, true); o += 2;
  const noiseCount = view.getUint16(o, true); o += 2;
  const trackCount = view.getUint16(o, true); o += 2;
  const waterLevel = view.getUint16(o, true) / 100; o += 2;

  const actors: SnapshotActor[] = new Array(actorCount);
  for (let i = 0; i < actorCount; i++) {
    const id = view.getUint16(o, true); o += 2;
    const speciesIdx = view.getUint8(o); o += 1;
    const x = view.getInt16(o, true) / POS_SCALE; o += 2;
    const y = view.getInt16(o, true) / HEIGHT_SCALE; o += 2;
    const z = view.getInt16(o, true) / POS_SCALE; o += 2;
    const yaw = unpackAngle(view.getUint16(o, true)); o += 2;
    const gait = view.getUint8(o) / 255; o += 1;
    const flags = view.getUint16(o, true); o += 2;
    const flies = view.getUint8(o) / 255; o += 1;
    actors[i] = {
      id,
      species: ALL_SPECIES[speciesIdx] ?? ALL_SPECIES[0],
      x,
      y,
      z,
      yaw,
      gait,
      flags,
      flies,
    };
  }

  let self: SnapshotSelf | null = null;
  if (hasSelf) {
    const actorId = view.getUint16(o, true); o += 2;
    const health = view.getUint16(o, true) / 10; o += 2;
    const maxHealth = view.getUint16(o, true) / 10; o += 2;
    const hunger = view.getUint16(o, true) / 100; o += 2;
    const stamina = view.getUint16(o, true) / 100; o += 2;
    const maxStamina = view.getUint16(o, true) / 10; o += 2;
    const sinceWhistle = view.getUint16(o, true) / 100; o += 2;
    const whistleCooldown = view.getUint16(o, true) / 1000; o += 2;
    const flies = view.getUint8(o) / 255; o += 1;
    const eatProgress = view.getUint8(o) / 255; o += 1;
    const abilityReady = view.getUint8(o) / 255; o += 1;
    const listenReady = view.getUint8(o) / 255; o += 1;
    const focusReady = view.getUint8(o) / 255; o += 1;
    const attackReady = view.getUint8(o) / 255; o += 1;
    const digesting = view.getUint16(o, true) / 100; o += 2;
    const score = view.getUint32(o, true); o += 4;
    o += 2; // reserved
    self = {
      actorId,
      health,
      maxHealth,
      hunger,
      stamina,
      maxStamina,
      sinceWhistle,
      whistleCooldown,
      flies,
      eatProgress,
      abilityReady,
      listenReady,
      focusReady,
      attackReady,
      digesting,
      score,
    };
  }

  const noises: SnapshotNoise[] = new Array(noiseCount);
  for (let i = 0; i < noiseCount; i++) {
    const x = view.getInt16(o, true) / POS_SCALE; o += 2;
    const z = view.getInt16(o, true) / POS_SCALE; o += 2;
    const volume = view.getUint8(o); o += 1;
    const kind = NOISE_KINDS[view.getUint8(o)] ?? NOISE_KINDS[0]; o += 1;
    const age = view.getUint16(o, true) / 100; o += 2;
    noises[i] = { x, z, volume, kind, age };
  }

  const tracks: SnapshotTrack[] = new Array(trackCount);
  for (let i = 0; i < trackCount; i++) {
    const x = view.getInt16(o, true) / POS_SCALE; o += 2;
    const z = view.getInt16(o, true) / POS_SCALE; o += 2;
    const yaw = (view.getUint8(o) / 255) * Math.PI * 2; o += 1;
    const species = ALL_SPECIES[view.getUint8(o)] ?? ALL_SPECIES[0]; o += 1;
    const age = view.getUint8(o); o += 1;
    tracks[i] = { x, z, yaw, species, age };
  }

  return { tick, time, actors, self, noises, tracks, waterLevel };
}

/** Byte size of a snapshot without building it — used by the netgraph. */
export function snapshotSize(snap: Snapshot): number {
  return (
    HEADER_BYTES +
    snap.actors.length * ACTOR_BYTES +
    (snap.self ? SELF_BYTES : 0) +
    snap.noises.length * NOISE_BYTES +
    snap.tracks.length * TRACK_BYTES
  );
}
