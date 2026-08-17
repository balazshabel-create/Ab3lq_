/**
 * Transport.ts — how the client talks to the authority.
 *
 * Two implementations behind one interface:
 *
 *   • LocalTransport runs a GameHost inside this browser tab and hands packets
 *     across directly. Single-player is therefore not a special mode with its
 *     own rules — it is a one-client server, running exactly the same authority
 *     code path as an online match.
 *   • SocketTransport talks to the Node server over a WebSocket.
 *
 * Because the two are interchangeable, a bug that only shows up online is
 * almost always a networking bug rather than a gameplay one, which makes it far
 * easier to find.
 */

import { GameHost, type HostConnection } from './GameHost';
import {
  ClientMsg,
  InputAction,
  PROTOCOL_VERSION,
  decodeSnapshot,
  type ClientPacket,
  type ServerPacket,
  type Snapshot,
} from './Protocol';
import { CLIENT_INPUT_RATE, SIM_TICK_RATE } from '../Systems/Config';

export interface TransportHandlers {
  onPacket: (packet: ServerPacket) => void;
  onSnapshot: (snapshot: Snapshot) => void;
  onOpen: () => void;
  onClose: (reason: string) => void;
  onError: (message: string) => void;
}

export interface Transport {
  /** Open the connection. Resolves once the transport is usable. */
  connect(handlers: TransportHandlers): Promise<void>;
  /** Send a control packet. */
  send(packet: ClientPacket): void;
  /** Advance a locally hosted authority. No-op for a remote server. */
  update(dt: number): void;
  /** Close and clean up. */
  disconnect(): void;
  /** True if this transport owns the authority in-process. */
  readonly isLocal: boolean;
  /** Round-trip time in milliseconds, or 0 for local play. */
  readonly ping: number;
}

// ---------------------------------------------------------------------------
// Local (single-player / listen server)
// ---------------------------------------------------------------------------

export interface LocalTransportOptions {
  seed?: number;
  /** Number of AI-driven "practice bots" to add alongside the human player. */
  practiceBots?: number;
}

export class LocalTransport implements Transport {
  readonly isLocal = true;
  readonly ping = 0;

  host: GameHost;
  private handlers: TransportHandlers | null = null;
  private clientId = 'local-player';
  private connection: HostConnection;
  private botIds: string[] = [];
  private botState: BotState[] = [];
  /** Pending "bot presses ready" timers, so leaving the lobby cancels them. */
  private readyTimers: ReturnType<typeof setTimeout>[] = [];
  /** Fixed-rate clock for the in-process authority. */
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastStep = 0;

  constructor(options: LocalTransportOptions = {}) {
    this.host = new GameHost({
      seed: options.seed,
      autoStart: false,
      // The local host is also the renderer's world source, so it needs the
      // cosmetic prop layer that a dedicated server would skip.
      cosmetic: true,
    });

    this.connection = {
      id: this.clientId,
      send: (packet) => {
        // Deliver on a microtask so local play has the same "packets arrive
        // between frames" behaviour as the network, rather than re-entering the
        // client mid-update.
        queueMicrotask(() => this.handlers?.onPacket(packet));
      },
      sendBinary: (data) => {
        queueMicrotask(() => {
          const snap = decodeSnapshot(data);
          if (snap) this.handlers?.onSnapshot(snap);
        });
      },
      close: (reason) => {
        queueMicrotask(() => this.handlers?.onClose(reason));
      },
    };

    // Practice bots: extra players so a solo player gets a real lobby, roles get
    // dealt meaningfully, and the hunter has somebody to actually hunt.
    const bots = options.practiceBots ?? 0;
    for (let i = 0; i < bots; i++) {
      this.botIds.push(`bot-${i + 1}`);
      this.botState.push({
        id: `bot-${i + 1}`,
        dirX: 0,
        dirZ: 0,
        yaw: Math.random() * Math.PI * 2,
        actionTimer: Math.random() * 2,
        whistleTimer: 10 + Math.random() * 30,
        seq: 0,
        sendAccumulator: 0,
      });
    }
  }

  async connect(handlers: TransportHandlers): Promise<void> {
    this.handlers = handlers;
    this.host.addConnection(this.connection);

    // Attach the practice bots as connections that discard everything sent to
    // them. They occupy player slots so roles get dealt to more than one animal.
    for (const id of this.botIds) {
      const sink: HostConnection = {
        id,
        send: () => {},
        sendBinary: () => {},
        close: () => {},
      };
      this.host.addConnection(sink);
      this.host.handlePacket(id, {
        t: ClientMsg.Join,
        name: botName(id),
        version: PROTOCOL_VERSION,
      });

      /*
       * Bots press ready, on a stagger.
       *
       * Without this a solo lobby can never be all-ready, so the drop clock
       * never runs and the only way into a round is the host's own button —
       * which is the one part of matchmaking a single player should not have
       * to do by hand. The delay is randomised because six names flipping to
       * "Ready" in the same frame looks like a scripted set piece, and one at
       * a time looks like people.
       */
      this.readyTimers.push(
        setTimeout(
          () => this.host.handlePacket(id, { t: ClientMsg.SetReady, ready: true }),
          700 + Math.random() * 2600,
        ),
      );
    }

    handlers.onOpen();
    this.startClock();
  }

  send(packet: ClientPacket): void {
    this.host.handlePacket(this.clientId, packet);
  }

  /**
   * Nothing to do here: a timer owns the stepping (see `startClock`).
   *
   * The obvious design is to step the local authority from the render loop, and
   * that is what this did originally — but it couples game time to frame rate.
   * On a slow machine the whole simulation then runs in slow motion: the eight
   * second intro took closer to thirty, hunger and the round clock crawled, and
   * it looked like the game had hung. A remote server keeps its own time, so the
   * local host must too, or single-player and multiplayer would not behave alike.
   */
  update(): void {}

  /** Step the authority on a fixed timer, independent of rendering. */
  private startClock(): void {
    if (this.timer !== null) return;
    this.lastStep = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      // Clamp: after a long stall (a background tab, a GC pause) catch up a
      // little rather than simulating minutes in one step.
      const dt = Math.min(0.25, (now - this.lastStep) / 1000);
      this.lastStep = now;
      if (dt <= 0) return;
      try {
        this.driveBots(dt);
        this.host.update(dt);
      } catch (err) {
        // A throw here would silently kill the interval and freeze the world,
        // which is far harder to diagnose than a logged error.
        console.error('local authority step failed', err);
      }
    }, 1000 / SIM_TICK_RATE);
  }

  /**
   * Give the practice bots something to do.
   *
   * This is not decoration. Two things go wrong if bots send no input at all:
   * the authority times them out after CLIENT_TIMEOUT and stops counting them as
   * survivors (the round then shows "SURVIVORS 0/0" and the hunter has nothing
   * to hunt), and a player animal standing perfectly still among wandering AI is
   * trivially identifiable, which removes the deduction entirely.
   *
   * The behaviour intentionally mimics the AI's grammar — walk a few metres,
   * stop, look around, and whistle roughly on time — so a solo hunter has to do
   * the real work of telling them apart from the ambient animals.
   */
  private driveBots(dt: number): void {
    for (const bot of this.botState) {
      bot.actionTimer -= dt;
      bot.whistleTimer -= dt;

      if (bot.actionTimer <= 0) {
        // Alternate between strolling and pausing, like the AI does.
        if (bot.dirX === 0 && bot.dirZ === 0) {
          bot.yaw += (Math.random() - 0.5) * 2.4;
          bot.dirX = Math.cos(bot.yaw);
          bot.dirZ = Math.sin(bot.yaw);
          bot.actionTimer = 1.5 + Math.random() * 3.5;
        } else {
          bot.dirX = 0;
          bot.dirZ = 0;
          bot.actionTimer = 0.8 + Math.random() * 2.6;
        }
      }

      let actions = 0;
      if (bot.whistleTimer <= 0) {
        // Whistle a little before the deadline, as a competent player would.
        actions |= InputAction.Whistle;
        bot.whistleTimer = 44 + Math.random() * 10;
      }

      // Match the human client's send rate rather than flooding the authority.
      bot.sendAccumulator += dt;
      const interval = 1 / CLIENT_INPUT_RATE;
      if (bot.sendAccumulator < interval && actions === 0) continue;
      bot.sendAccumulator = 0;

      this.host.handlePacket(bot.id, {
        t: ClientMsg.Input,
        input: {
          seq: ++bot.seq,
          moveX: bot.dirX,
          moveZ: bot.dirZ,
          yaw: bot.yaw,
          pitch: 0,
          actions,
        },
      });
    }
  }

  disconnect(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const t of this.readyTimers) clearTimeout(t);
    this.readyTimers.length = 0;
    this.host.removeConnection(this.clientId);
    for (const id of this.botIds) this.host.removeConnection(id);
    this.handlers = null;
  }
}

/** Per-bot wander state. */
interface BotState {
  id: string;
  dirX: number;
  dirZ: number;
  yaw: number;
  /** Seconds until it changes between walking and pausing. */
  actionTimer: number;
  whistleTimer: number;
  seq: number;
  sendAccumulator: number;
}

const BOT_NAMES = [
  'Bugsy',
  'Mango',
  'Tapioca',
  'Pepe',
  'Chico',
  'Nacho',
  'Yara',
  'Pico',
  'Guava',
  'Bruno',
  'Lupe',
];

function botName(id: string): string {
  const n = Number.parseInt(id.replace(/\D/g, ''), 10) || 1;
  return BOT_NAMES[(n - 1) % BOT_NAMES.length];
}

// ---------------------------------------------------------------------------
// Remote (WebSocket)
// ---------------------------------------------------------------------------

export class SocketTransport implements Transport {
  readonly isLocal = false;

  private socket: WebSocket | null = null;
  private url: string;
  private pingMs = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  get ping(): number {
    return this.pingMs;
  }

  connect(handlers: TransportHandlers): Promise<void> {
    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(this.url);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.socket = socket;
      socket.binaryType = 'arraybuffer';

      let settled = false;

      socket.onopen = () => {
        settled = true;
        // Measure round-trip time so the HUD can show a connection quality hint.
        this.pingTimer = setInterval(() => {
          this.send({ t: ClientMsg.Ping, time: performance.now() });
        }, 2000);
        handlers.onOpen();
        resolve();
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const snap = decodeSnapshot(event.data);
          if (snap) handlers.onSnapshot(snap);
          return;
        }
        try {
          const packet = JSON.parse(String(event.data)) as ServerPacket;
          // Intercept pongs to keep the ping estimate up to date.
          if (packet.t === 'pong') {
            this.pingMs = Math.round(performance.now() - packet.time);
            return;
          }
          handlers.onPacket(packet);
        } catch {
          handlers.onError('Received a malformed packet from the server.');
        }
      };

      socket.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error(`Could not reach the server at ${this.url}`));
        }
        handlers.onError('Connection error.');
      };

      socket.onclose = (event) => {
        this.stopPing();
        handlers.onClose(event.reason || 'Connection closed.');
        if (!settled) {
          settled = true;
          reject(new Error(`Could not reach the server at ${this.url}`));
        }
      };
    });
  }

  send(packet: ClientPacket): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(packet));
  }

  /** The authority is remote, so there is nothing to step here. */
  update(): void {}

  disconnect(): void {
    this.stopPing();
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.send({ t: ClientMsg.Leave });
      this.socket.close();
    }
    this.socket = null;
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

/** Default WebSocket URL, derived from where the page is served from. */
export function defaultServerUrl(port = 8787): string {
  if (typeof location === 'undefined') return `ws://localhost:${port}`;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.hostname}:${port}`;
}
