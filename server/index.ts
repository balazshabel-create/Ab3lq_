/**
 * server/index.ts — the dedicated authority server.
 *
 * Runs the same GameHost the browser uses for single-player, but over
 * WebSockets. Rooms are kept simple on purpose: one process hosts as many rooms
 * as it is asked to, each with its own seed and its own simulation.
 *
 * Usage:
 *   npm run server
 *   PORT=9000 npm run server
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

import { GameHost, type HostConnection } from '../src/Networking/GameHost';
import { ServerMsg, type ClientPacket, type ServerPacket } from '../src/Networking/Protocol';
import { DEFAULT_SERVER_PORT, MAX_PLAYERS, SIM_TICK_RATE } from '../src/Systems/Config';

const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
/** How often the authority loop runs. Snapshots are paced separately. */
const LOOP_HZ = SIM_TICK_RATE;

/** One room = one simulation. */
interface Room {
  code: string;
  host: GameHost;
  createdAt: number;
  sockets: Set<WebSocket>;
}

const rooms = new Map<string, Room>();

function createRoom(code?: string): Room {
  const seed = Math.floor(Math.random() * 0x7fffffff);
  const host = new GameHost({ seed, autoStart: true, cosmetic: false });
  const room: Room = {
    code: code ?? host.sim.roomCode,
    host,
    createdAt: Date.now(),
    sockets: new Set(),
  };
  rooms.set(room.code, room);
  log(`room ${room.code} created (seed ${seed})`);
  return room;
}

/** Find a room with space, or open a new one. */
function findOrCreateRoom(requested: string | null): Room {
  if (requested) {
    const existing = rooms.get(requested.toUpperCase());
    if (existing) return existing;
    // An explicit code that does not exist yet becomes a new private room.
    return createRoom(requested.toUpperCase());
  }
  for (const room of rooms.values()) {
    if (room.host.playerCount < MAX_PLAYERS) return room;
  }
  return createRoom();
}

// ---------------------------------------------------------------------------
// HTTP surface: health check and a tiny room listing
// ---------------------------------------------------------------------------

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
    return;
  }
  if (req.url === '/rooms') {
    const list = [...rooms.values()].map((r) => ({
      code: r.code,
      players: r.host.playerCount,
      maxPlayers: MAX_PLAYERS,
      phase: r.host.sim.round.phase,
      animals: r.host.sim.getAnimalCount(),
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(list, null, 2));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Jungle Jukebox authority server. Try /health or /rooms.\n');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
  // Room selection via ?room=CODE, so friends can share a link.
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const requestedRoom = url.searchParams.get('room');
  const room = findOrCreateRoom(requestedRoom);
  room.sockets.add(socket);

  const clientId = randomUUID();
  let closed = false;

  const connection: HostConnection = {
    id: clientId,
    send(packet: ServerPacket) {
      if (closed || socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify(packet));
    },
    sendBinary(data: ArrayBuffer) {
      if (closed || socket.readyState !== socket.OPEN) return;
      socket.send(Buffer.from(data), { binary: true });
    },
    close(reason: string) {
      if (closed) return;
      closed = true;
      try {
        socket.close(1000, reason.slice(0, 100));
      } catch {
        // Already gone; nothing to do.
      }
    },
  };

  room.host.addConnection(connection);
  log(`client ${clientId.slice(0, 8)} joined room ${room.code} (${room.host.clientCount} connected)`);

  socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    // The client never sends binary; treat anything binary as a protocol error
    // rather than trying to interpret it.
    if (isBinary) return;
    let packet: ClientPacket;
    try {
      const text = Array.isArray(raw)
        ? Buffer.concat(raw).toString('utf8')
        : Buffer.from(raw as ArrayBuffer).toString('utf8');
      // Bound the message size: a client should never send more than a few
      // hundred bytes per packet.
      if (text.length > 4096) throw new Error('packet too large');
      packet = JSON.parse(text) as ClientPacket;
    } catch {
      connection.send({ t: ServerMsg.Error, message: 'Malformed packet.' });
      return;
    }
    if (!packet || typeof packet.t !== 'string') return;
    try {
      room.host.handlePacket(clientId, packet);
    } catch (err) {
      // One client's bad input must never take down the room.
      log(`error handling ${packet.t} from ${clientId.slice(0, 8)}: ${String(err)}`);
    }
  });

  socket.on('close', () => {
    closed = true;
    room.sockets.delete(socket);
    room.host.removeConnection(clientId);
    log(`client ${clientId.slice(0, 8)} left room ${room.code} (${room.host.clientCount} left)`);
    reapRoom(room);
  });

  socket.on('error', () => {
    closed = true;
    room.sockets.delete(socket);
    room.host.removeConnection(clientId);
    reapRoom(room);
  });
});

/** Close a room once it has been empty for a while. */
function reapRoom(room: Room): void {
  if (room.host.clientCount > 0) return;
  // Keep it briefly in case somebody is reconnecting.
  setTimeout(() => {
    if (room.host.clientCount === 0) {
      rooms.delete(room.code);
      log(`room ${room.code} closed`);
    }
  }, 30_000);
}

// ---------------------------------------------------------------------------
// The authority loop
// ---------------------------------------------------------------------------

let lastTime = process.hrtime.bigint();

setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Number(now - lastTime) / 1e9;
  lastTime = now;
  for (const room of rooms.values()) {
    try {
      room.host.update(dt);
    } catch (err) {
      log(`simulation error in room ${room.code}: ${String(err)}`);
    }
  }
}, 1000 / LOOP_HZ);

/** Periodic status line, so the console shows something useful. */
setInterval(() => {
  if (rooms.size === 0) return;
  for (const room of rooms.values()) {
    if (room.host.playerCount === 0) continue;
    log(`[${room.code}] ${room.host.statusLine()}`);
  }
}, 15_000);

function log(message: string): void {
  const time = new Date().toISOString().slice(11, 19);
  process.stdout.write(`${time} 🌴 ${message}\n`);
}

httpServer.listen(PORT, () => {
  log(`Jungle Jukebox server listening on :${PORT}`);
  log(`  health: http://localhost:${PORT}/health`);
  log(`  rooms:  http://localhost:${PORT}/rooms`);
});

// Graceful shutdown so nodemon/ctrl-c does not leave the port bound.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`);
    for (const room of rooms.values()) {
      for (const socket of room.sockets) {
        try {
          socket.close(1001, 'Server shutting down');
        } catch {
          // Ignore.
        }
      }
    }
    wss.close();
    httpServer.close(() => process.exit(0));
    // Do not hang forever if a socket refuses to close.
    setTimeout(() => process.exit(0), 3000);
  });
}

/** Exported so a test or another entry point can reuse the room registry. */
export { rooms, createRoom };
