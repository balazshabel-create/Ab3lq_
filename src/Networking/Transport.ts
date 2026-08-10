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
  PROTOCOL_VERSION,
  decodeSnapshot,
  type ClientPacket,
  type ServerPacket,
  type Snapshot,
} from './Protocol';

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

    // Practice bots: extra players so a solo player can see the deduction
    // dynamic at work. They never send input, so they behave like players who
    // have frozen — which is itself a useful thing to be able to spot.
    const bots = options.practiceBots ?? 0;
    for (let i = 0; i < bots; i++) this.botIds.push(`bot-${i + 1}`);
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
    }

    handlers.onOpen();
  }

  send(packet: ClientPacket): void {
    this.host.handlePacket(this.clientId, packet);
  }

  update(dt: number): void {
    this.host.update(dt);
  }

  disconnect(): void {
    this.host.removeConnection(this.clientId);
    for (const id of this.botIds) this.host.removeConnection(id);
    this.handlers = null;
  }
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
