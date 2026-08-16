/**
 * GameHost.ts — the transport-agnostic authority.
 *
 * This owns the Simulation, the lobby, and the decision of what each client is
 * allowed to know. It has no idea whether its clients are WebSockets on a
 * server or in-process objects in a browser tab — which is what lets
 * single-player and multiplayer run literally the same authority code.
 */

import { MAX_PLAYERS, SIM_DT, SNAPSHOT_RATE } from '../Systems/Config';
import { Simulation } from '../Core/Simulation';
import { ActorKind, Role, RoundPhase, type Actor } from '../Core/Types';
import { buildRoleCard, canStart } from '../Gameplay/RoundState';
import { EVENTS } from '../Gameplay/RandomEvents';
import {
  ClientMsg,
  PROTOCOL_VERSION,
  ServerMsg,
  encodeSnapshot,
  type ClientPacket,
  type KillFeedEntry,
  type LobbyPlayer,
  type LobbyState,
  type ServerPacket,
  type Snapshot,
  type ZoneWire,
} from './Protocol';
import { dist2D } from '../Core/Types';

/** One connected client, from the host's point of view. */
export interface HostConnection {
  id: string;
  /** Send a JSON control message. */
  send(packet: ServerPacket): void;
  /** Send a binary snapshot frame. */
  sendBinary(data: ArrayBuffer): void;
  /** Drop the connection. */
  close(reason: string): void;
}

interface ClientRecord {
  conn: HostConnection;
  name: string;
  ready: boolean;
  joined: boolean;
}

export interface GameHostOptions {
  seed?: number;
  /** Auto-start a round as soon as the minimum player count is ready. */
  autoStart?: boolean;
  /** Generate cosmetic props in the sim (only useful when the host is the client). */
  cosmetic?: boolean;
}

export class GameHost {
  readonly sim: Simulation;
  private clients = new Map<string, ClientRecord>();
  private hostClientId: string | null = null;
  private snapshotAccumulator = 0;
  private simAccumulator = 0;
  private autoStart: boolean;

  constructor(options: GameHostOptions = {}) {
    const seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff);
    this.autoStart = options.autoStart ?? false;
    this.sim = new Simulation(
      seed,
      {
        onKill: (victim, killer, cause) => this.broadcastKill(victim, killer, cause),
        onEvent: (def) =>
          this.broadcast({
            t: ServerMsg.Event,
            id: def.id,
            announcement: def.announcement,
            detail: def.detail,
            emoji: def.emoji,
          }),
        onRoundEnd: (result) => this.broadcast({ t: ServerMsg.Result, result }),
        onRoundStart: (assignments) => {
          // Role cards go to exactly one client each. This is the single most
          // security-sensitive send in the game: broadcasting here would reveal
          // the hunter to everybody.
          for (const a of assignments) {
            const record = this.clients.get(a.clientId);
            const actor = this.sim.getPlayer(a.clientId);
            if (!record || !actor) continue;
            record.conn.send({
              t: ServerMsg.RoleCard,
              card: buildRoleCard(a),
              actorId: actor.id,
            });
          }
        },
      },
      options.cosmetic ?? false,
    );
    // Populate immediately so the lobby and menu look alive before anyone joins.
    this.sim.populate([]);
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  addConnection(conn: HostConnection): void {
    if (this.clients.size >= MAX_PLAYERS) {
      conn.send({ t: ServerMsg.Error, message: 'This jungle is full.' });
      conn.close('full');
      return;
    }
    this.clients.set(conn.id, {
      conn,
      name: 'Anonymous Capybara',
      ready: false,
      joined: false,
    });
    if (!this.hostClientId) this.hostClientId = conn.id;

    conn.send({
      t: ServerMsg.Welcome,
      clientId: conn.id,
      seed: this.sim.seed,
      version: PROTOCOL_VERSION,
      tickRate: 1 / SIM_DT,
    });
  }

  removeConnection(clientId: string): void {
    const record = this.clients.get(clientId);
    if (!record) return;
    this.clients.delete(clientId);
    this.sim.removePlayer(clientId);
    if (this.hostClientId === clientId) {
      // Promote whoever is left, so the lobby is never leaderless.
      this.hostClientId = this.clients.keys().next().value ?? null;
    }
    this.broadcastLobby();
  }

  /** Handle one control packet from a client. */
  handlePacket(clientId: string, packet: ClientPacket): void {
    const record = this.clients.get(clientId);
    if (!record) return;

    switch (packet.t) {
      case ClientMsg.Join: {
        if (packet.version !== PROTOCOL_VERSION) {
          record.conn.send({
            t: ServerMsg.Error,
            message: `Version mismatch: server speaks v${PROTOCOL_VERSION}, you speak v${packet.version}.`,
          });
          record.conn.close('version');
          return;
        }
        record.name = sanitiseName(packet.name);
        record.joined = true;
        this.sim.addPlayer(clientId, record.name);
        this.broadcastLobby();
        break;
      }

      case ClientMsg.SetReady: {
        record.ready = packet.ready;
        this.broadcastLobby();
        this.maybeAutoStart();
        break;
      }

      case ClientMsg.StartRound: {
        // Only the host may start, and only from the lobby.
        if (clientId !== this.hostClientId) return;
        this.startRound();
        break;
      }

      case ClientMsg.Input: {
        this.sim.applyInput(clientId, packet.input);
        break;
      }

      case ClientMsg.Ping: {
        record.conn.send({ t: ServerMsg.Pong, time: packet.time });
        break;
      }

      case ClientMsg.Leave: {
        record.conn.close('left');
        this.removeConnection(clientId);
        break;
      }

      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Round control
  // -------------------------------------------------------------------------

  startRound(): void {
    if (this.sim.round.phase !== RoundPhase.Lobby) return;
    const joined = [...this.clients.values()].filter((c) => c.joined);
    if (!canStart(joined.length)) {
      this.broadcast({ t: ServerMsg.Error, message: 'Not enough players yet.' });
      return;
    }
    this.sim.startRound();
    this.broadcastLobby();
  }

  private maybeAutoStart(): void {
    if (!this.autoStart) return;
    if (this.sim.round.phase !== RoundPhase.Lobby) return;
    const joined = [...this.clients.values()].filter((c) => c.joined);
    if (joined.length > 0 && joined.every((c) => c.ready) && canStart(joined.length)) {
      this.startRound();
    }
  }

  // -------------------------------------------------------------------------
  // The loop
  // -------------------------------------------------------------------------

  /**
   * Advance the host by real elapsed time.
   *
   * The simulation is stepped at a fixed rate regardless of how often this is
   * called, so physics and AI behave identically at 30 fps and 144 fps, and on
   * a Node server with a drifting timer.
   */
  update(realDt: number): void {
    // Clamp: after a long stall, catch up a little rather than simulating a
    // hundred ticks in one frame and hitching even harder.
    this.simAccumulator += Math.min(realDt, 0.25);
    let steps = 0;
    while (this.simAccumulator >= SIM_DT && steps < 8) {
      this.sim.update(SIM_DT);
      this.simAccumulator -= SIM_DT;
      steps++;
    }
    if (steps === 8) this.simAccumulator = 0;

    this.snapshotAccumulator += realDt;
    const interval = 1 / SNAPSHOT_RATE;
    if (this.snapshotAccumulator >= interval) {
      this.snapshotAccumulator %= interval;
      this.sendSnapshots();
      this.sendRoundStatus();
    }
  }

  /** Build and send a per-client snapshot. */
  private sendSnapshots(): void {
    for (const [clientId, record] of this.clients) {
      if (!record.joined) continue;
      const view = this.sim.buildSnapshotFor(clientId);

      const snapshot: Snapshot = {
        tick: this.sim.tick,
        time: this.sim.time,
        waterLevel: this.sim.currentWaterLevel,
        actors: view.actors.map((a) => ({
          id: a.id,
          species: a.species,
          x: a.pos.x,
          y: a.pos.y,
          z: a.pos.z,
          yaw: a.yaw,
          gait: a.gait,
          flags: a.flags,
          // Flies are only transmitted when they would actually be visible from
          // here, so a modified client cannot use the snapshot as an x-ray.
          flies: this.visibleFlies(a, view.self),
        })),
        self: view.self
          ? {
              actorId: view.self.id,
              health: view.self.health,
              maxHealth: view.self.maxHealth,
              hunger: view.self.hunger,
              stamina: view.self.stamina,
              maxStamina: 100,
              sinceWhistle: view.self.sinceWhistle,
              whistleCooldown: view.self.whistleCooldown,
              flies: view.self.flies,
              eatProgress: view.self.eatTimer > 0 ? 1 : 0,
              abilityReady: view.self.abilityCooldown <= 0 ? 1 : 0,
              listenReady: view.self.listenCooldown <= 0 ? 1 : 0,
              focusReady: view.self.focusCooldown <= 0 ? 1 : 0,
              attackReady: view.self.attackCooldown <= 0 ? 1 : 0,
              digesting: view.self.digesting,
              score: view.self.stats.score,
            }
          : null,
        noises: view.noises.map((n) => ({
          x: n.x,
          z: n.z,
          volume: n.volume,
          kind: n.kind,
          age: this.sim.time - n.time,
        })),
        tracks: view.tracks.map((t) => ({
          x: t.x,
          z: t.z,
          yaw: t.yaw,
          species: t.species,
          // Age in seconds, so the client can fade old prints out. Note that
          // whether a player made it is deliberately NOT sent.
          age: Math.round(this.sim.time - t.time),
        })),
      };

      record.conn.sendBinary(encodeSnapshot(snapshot));
    }
  }

  /**
   * How much of an actor's fly swarm this observer can see.
   *
   * Distance-gated on the server on purpose: the flies are the strongest signal
   * in the game, so a client must never receive them for an animal it could not
   * physically see.
   */
  private visibleFlies(actor: Actor, observer: Actor | null): number {
    if (actor.flies <= 0.01) return 0;
    if (!observer) return actor.flies;
    if (actor.id === observer.id) return actor.flies;
    const d = dist2D(actor.pos, observer.pos);
    // 70 m matches FLY_VISIBLE_RANGE; beyond it the swarm is simply not sent.
    if (d > 70) return 0;
    return actor.flies;
  }

  private sendRoundStatus(): void {
    const status = this.sim.roundStatus();
    const weather = {
      current: this.sim.weather.current,
      rain: this.sim.weather.rain,
      fog: this.sim.weather.fog,
      wind: this.sim.weather.wind,
      hour: this.sim.weather.hour,
    };
    const events = this.sim.schedule.active.map((a) => ({
      id: a.id,
      timeLeft: a.timeLeft,
      duration: a.duration,
      justStarted: a.justStarted,
    }));
    const z = this.sim.stormZone ? this.sim.zone : null;
    const zone: ZoneWire | null = z
      ? {
          x: z.x,
          z: z.z,
          radius: z.radius,
          stage: z.stage,
          totalStages: z.totalStages,
          shrinking: z.shrinking,
          untilShrink: Number.isFinite(z.untilShrink) ? z.untilShrink : -1,
          damageRate: z.damageRate,
          next: z.next ? { x: z.next.x, z: z.next.z, radius: z.next.radius } : null,
        }
      : null;
    this.broadcast({ t: ServerMsg.RoundStatus, status, weather, events, zone });

    /*
     * The scoreboard rides along with the status broadcast rather than having a
     * clock of its own: it is the same cadence, the same audience, and a board
     * that updated on its own timer would show a score for a player the status
     * message had already reported dead.
     */
    this.broadcast({
      t: ServerMsg.Scoreboard,
      entries: this.sim
        .getPlayers()
        .filter((p) => p.connected)
        .map((p) => ({
          clientId: p.clientId,
          name: p.name,
          score: Math.round(p.stats.score),
          alive: p.health > 0,
        }))
        .sort((a, b) => b.score - a.score),
    });
  }

  // -------------------------------------------------------------------------
  // Broadcasting
  // -------------------------------------------------------------------------

  private broadcast(packet: ServerPacket): void {
    for (const record of this.clients.values()) {
      if (!record.joined) continue;
      record.conn.send(packet);
    }
  }

  broadcastLobby(): void {
    const lobby = this.lobbyState();
    this.broadcast({ t: ServerMsg.Lobby, lobby });
  }

  lobbyState(): LobbyState {
    const players: LobbyPlayer[] = [];
    for (const [id, record] of this.clients) {
      if (!record.joined) continue;
      players.push({
        clientId: id,
        name: record.name,
        ready: record.ready,
        isHost: id === this.hostClientId,
        connected: true,
      });
    }
    return {
      players,
      code: this.sim.roomCode,
      maxPlayers: MAX_PLAYERS,
      canStart: canStart(players.length),
    };
  }

  /**
   * Announce a kill.
   *
   * The feed names the *species*, never the player. "A capybara has been
   * killed" tells the lobby that somebody's capybara was a person — which is
   * information everyone should have — without revealing who, or which
   * capybara, or who did it.
   */
  private broadcastKill(
    victim: Actor,
    killer: Actor | null,
    cause: 'hunter' | 'predator' | 'starvation' | 'storm',
  ): void {
    const victimWasPlayer = victim.kind === ActorKind.Player;
    // Only player deaths are newsworthy; an AI frog being eaten is not.
    if (!victimWasPlayer) return;

    for (const [clientId, record] of this.clients) {
      if (!record.joined) continue;
      const self = this.sim.getPlayer(clientId);
      const entry: KillFeedEntry = {
        victimSpecies: victim.species,
        victimWasPlayer,
        cause,
        distance: self ? dist2D(self.pos, victim.pos) : 0,
        time: this.sim.time,
      };
      record.conn.send({ t: ServerMsg.KillFeed, entry });
    }
    void killer;
  }

  // -------------------------------------------------------------------------
  // Introspection (for the server console and the debug overlay)
  // -------------------------------------------------------------------------

  get clientCount(): number {
    return this.clients.size;
  }

  get playerCount(): number {
    return [...this.clients.values()].filter((c) => c.joined).length;
  }

  get hunterName(): string | null {
    const hunter = this.sim.getPlayers().find((p) => p.role === Role.Hunter);
    return hunter ? hunter.name : null;
  }

  /** Human-readable status line for the server log. */
  statusLine(): string {
    const s = this.sim.roundStatus();
    const evt = this.sim.schedule.active.map((a) => EVENTS[a.id].name).join(', ') || 'none';
    return [
      `phase=${s.phase}`,
      `t=${s.timeLeft.toFixed(0)}s`,
      `players=${this.playerCount}`,
      `alive=${s.survivorsAlive}/${s.survivorsTotal}`,
      `animals=${this.sim.getAnimalCount()}`,
      `weather=${this.sim.weather.current}`,
      `events=${evt}`,
    ].join(' ');
  }
}

/**
 * Keep player names short, printable and free of markup.
 *
 * Names are rendered into the lobby and the round summary, so anything that
 * could be read as HTML is stripped here at the authority rather than being
 * trusted to every UI that later displays it.
 */
export function sanitiseName(raw: string): string {
  const cleaned = (raw ?? '')
    // Markup-significant characters.
    .replace(/[<>&"'`\\/]/g, '')
    // Control codes, which would otherwise corrupt the lobby list.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // Collapse whitespace runs so names cannot be padded out.
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
  return cleaned.length > 0 ? cleaned : 'Anonymous Capybara';
}
