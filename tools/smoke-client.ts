/**
 * tools/smoke-client.ts — headless end-to-end check of the authority server.
 *
 * Connects a real WebSocket client, joins, sends input, and verifies that the
 * server deals a role card and streams binary snapshots. Useful in CI and when
 * changing the protocol, since it exercises the wire format rather than the
 * in-process transport.
 *
 * Usage: npx tsx tools/smoke-client.ts [ws://host:port] [room]
 */

import WebSocket from 'ws';
import { PROTOCOL_VERSION, decodeSnapshot, type ServerPacket } from '../src/Networking/Protocol';
import { DEFAULT_SERVER_PORT } from '../src/Systems/Config';

const url = process.argv[2] ?? `ws://localhost:${DEFAULT_SERVER_PORT}`;
const room = process.argv[3] ?? 'SMOKE';
const RUN_SECONDS = 6;

const seen = new Set<string>();
let snapshots = 0;
let actorsSeen = 0;
let bytes = 0;
let gotSelf = false;
let roleSummary = '';

const socket = new WebSocket(`${url}?room=${room}`);
socket.binaryType = 'arraybuffer';

socket.on('open', () => {
  console.log(`connected to ${url} (room ${room})`);
  socket.send(JSON.stringify({ t: 'join', name: 'SmokeTest', version: PROTOCOL_VERSION }));
  socket.send(JSON.stringify({ t: 'set_ready', ready: true }));

  // Walk forwards and whistle, so movement and the whistle path are exercised.
  let seq = 0;
  const inputTimer = setInterval(() => {
    seq++;
    socket.send(
      JSON.stringify({
        t: 'input',
        input: {
          seq,
          moveX: Math.cos(seq * 0.1),
          moveZ: Math.sin(seq * 0.1),
          yaw: seq * 0.1,
          pitch: 0,
          // Whistle (1<<2) on every 20th tick, sprint (1<<0) otherwise.
          actions: seq % 20 === 0 ? 1 << 2 : 1 << 0,
        },
      }),
    );
  }, 50);
  socket.on('close', () => clearInterval(inputTimer));
});

/**
 * `ws` hands us an ArrayBuffer when binaryType is 'arraybuffer' and a Buffer
 * otherwise, so normalise before decoding.
 */
function toArrayBuffer(data: ArrayBuffer | Buffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

socket.on('message', (data: ArrayBuffer | Buffer, isBinary: boolean) => {
  if (isBinary) {
    snapshots++;
    bytes += data.byteLength;
    const snap = decodeSnapshot(toArrayBuffer(data));
    if (snap) {
      actorsSeen = Math.max(actorsSeen, snap.actors.length);
      if (snap.self) gotSelf = true;
    }
    return;
  }
  const text = data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : data.toString('utf8');
  const packet = JSON.parse(text) as ServerPacket;
  seen.add(packet.t);
  if (packet.t === 'role_card') {
    roleSummary = `${packet.card.role} / ${packet.card.species} / weakness=${packet.card.weakness ?? 'none'}`;
  }
  if (packet.t === 'error') console.error(`server error: ${packet.message}`);
});

socket.on('error', (err: Error) => {
  console.error(`socket error: ${err.message}`);
  process.exit(1);
});

setTimeout(() => {
  const kbPerSec = bytes / 1024 / RUN_SECONDS;
  console.log('');
  console.log('control packets :', [...seen].sort().join(', '));
  console.log('role card       :', roleSummary || '(none)');
  console.log('snapshots       :', snapshots);
  console.log('max actors seen :', actorsSeen);
  console.log('private block   :', gotSelf ? 'present' : 'MISSING');
  console.log('bandwidth       :', `${kbPerSec.toFixed(1)} KB/s`);

  const failures: string[] = [];
  if (!seen.has('welcome')) failures.push('no welcome packet');
  if (!seen.has('lobby')) failures.push('no lobby state');
  if (!seen.has('role_card')) failures.push('no role card (round never started)');
  if (snapshots < 10) failures.push(`only ${snapshots} snapshots in ${RUN_SECONDS}s`);
  if (actorsSeen < 5) failures.push(`only ${actorsSeen} actors visible; the world looks empty`);
  if (!gotSelf) failures.push('snapshots carried no private self block');

  socket.close();
  if (failures.length > 0) {
    console.error('\nFAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nOK — server, protocol and round flow all working.');
  process.exit(0);
}, RUN_SECONDS * 1000);
