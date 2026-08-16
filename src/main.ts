/**
 * main.ts — the client. Boots the game, owns the frame loop, wires the screens
 * to the transport.
 *
 * The shape of the client is deliberately simple: it sends input, it receives
 * snapshots, it draws. It holds no authority over anything that matters, which
 * is what makes the deduction trustworthy — a modified client can misdraw its
 * own view but it cannot learn who the hunter is, because that information was
 * never sent to it.
 */

import './UI/styles.css';

import { Terrain } from './World/Terrain';
import { generateWorld, type WorldContent } from './World/WorldGen';
import { Renderer, type RenderWorldState } from './Render/Renderer';
import { graphicsConfig, type GraphicsSettings } from './Graphics/QualitySettings';
import { InputManager } from './Player/InputManager';
import { audioSystem } from './Audio/AudioSystem';
import { Hud, type HudState } from './UI/Hud';
import {
  LoadingScreen,
  LobbyScreen,
  MainMenu,
  ResultScreen,
  RoleScreen,
  SettingsScreen,
  type ScreenActions,
  type ScreenName,
} from './UI/Screens';
import {
  LocalTransport,
  SocketTransport,
  type Transport,
  type TransportHandlers,
} from './Networking/Transport';
import {
  ClientMsg,
  InputAction,
  PROTOCOL_VERSION,
  ServerMsg,
  type PlayerInput,
  type ServerPacket,
  type ScoreboardEntry,
  type Snapshot,
  type ZoneWire,
} from './Networking/Protocol';
import { ActorFlags, Role, RoundPhase, Weather } from './Core/Types';
import { ANIMALS, Species } from './Animals/AnimalTypes';

/**
 * How close a shoal has to be before the game offers to fish, in metres.
 *
 * Wider than EAT_REACH on purpose. The prompt is an *invitation* — it says "there
 * is food here, come and get it" — so it has to appear while you are still
 * swimming towards the fish rather than only once your nose is already in them.
 */
const FISH_PROMPT_RANGE = 9;
import { WEAKNESSES, type WeaknessId } from './Gameplay/Weaknesses';
import type { RoleCard, RoundResult, RoundStatus } from './Gameplay/RoundState';
import { EVENTS } from './Gameplay/RandomEvents';
import {
  CLIENT_INPUT_RATE,
  STEER_MAX_LEAD,
  STEER_RATE,
  WATER_LEVEL,
  WHISTLE_INTERVAL,
} from './Systems/Config';
import { angleDelta, clamp, clamp01 } from './Systems/Noise';
import {
  weatherEmoji,
  weatherLabel,
  type WeatherLabelInput,
} from './Environment/WeatherSystem';
import * as THREE from 'three';

/** Everything the client knows about the current round. */
interface ClientState {
  clientId: string;
  actorId: number;
  role: Role;
  species: Species;
  weakness: WeaknessId | null;
  roleCard: RoleCard | null;
  status: RoundStatus | null;
  /** The storm circle, for the HUD's countdown and distance readout. */
  zone: ZoneWire | null;
  world: RenderWorldState;
  latestSnapshot: Snapshot | null;
  /** Health last frame, to detect damage. */
  lastHealth: number;
  dead: boolean;
  result: RoundResult | null;
}

class Game {
  /*
   * Fields the verification tools read through `window.__jj`. Public for that
   * reason and no other — nothing outside this file writes to them.
   */
  private canvas: HTMLCanvasElement;
  private uiRoot: HTMLElement;

  terrain!: Terrain;
  content!: WorldContent;
  renderer!: Renderer;
  private input!: InputManager;
  private hud!: Hud;

  private loading: LoadingScreen;
  private menu!: MainMenu;
  private settings!: SettingsScreen;
  private lobby!: LobbyScreen;
  private roleScreen!: RoleScreen;
  private results!: ResultScreen;

  private transport: Transport | null = null;
  private screen: ScreenName = 'loading';
  private previousScreen: ScreenName = 'menu';

  state: ClientState = {
    clientId: '',
    actorId: 0,
    role: Role.Survivor,
    species: Species.Capybara,
    weakness: null,
    roleCard: null,
    status: null,
    zone: null,
    world: {
      hour: 15.2,
      weather: Weather.Clear,
      rain: 0,
      fog: 0.06,
      wind: 0.2,
      waterLevel: WATER_LEVEL,
      lightning: 0,
      zone: null,
    },
    latestSnapshot: null,
    lastHealth: 100,
    dead: false,
    result: null,
  };

  private lastFrame = 0;
  private inputAccumulator = 0;
  private inputSeq = 0;
  private debugVisible = false;
  private running = false;
  private tmpVec = new THREE.Vector3();
  private cameraForward = new THREE.Vector3();
  /** Noises already played, so a repeated snapshot does not double-trigger. */
  private playedNoises = new Set<string>();
  private lastLightningTime = -99;
  /** Tracks the attack cooldown edge, so a bite can be heard and felt. */
  private lastAttackReady = true;
  /**
   * The heading the player is steering towards, in the animal's own frame.
   *
   * Integrated from A/D and tethered to the body's real yaw — see `steer`.
   */
  private steerYaw = 0;
  /** False until the first snapshot has given us a real yaw to seed from. */
  private steerReady = false;
  /** True while Tab is held. */
  private scoreboardOpen = false;
  /** The live scoreboard, as last broadcast. */
  private scoreboardEntries: ScoreboardEntry[] = [];

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.uiRoot = document.getElementById('ui-root') as HTMLElement;
    this.loading = new LoadingScreen();
    document.body.appendChild(this.loading.root);
  }

  // =========================================================================
  // Boot
  // =========================================================================

  async boot(): Promise<void> {
    const settings = graphicsConfig.get();

    // World generation is synchronous and takes a moment, so yield to the
    // browser between steps to keep the loading bar actually animating.
    this.loading.setProgress(0.05, 'Seeding the basin…');
    await nextFrame();

    // A fixed seed for the menu world; a real round uses the server's seed.
    const menuSeed = Math.floor(Math.random() * 0x7fffffff);
    this.terrain = new Terrain(menuSeed);
    this.loading.setProgress(0.35, 'Carving rivers…');
    await nextFrame();

    this.content = generateWorld(this.terrain, menuSeed, {
      cosmetic: true,
      cosmeticDensity: settings.foliageDensity,
    });
    this.loading.setProgress(0.62, 'Planting the canopy…');
    await nextFrame();

    this.renderer = new Renderer(this.canvas, this.terrain, this.content, settings);
    this.loading.setProgress(0.85, 'Waking the animals…');
    await nextFrame();

    this.input = new InputManager(this.canvas);
    this.hud = new Hud();
    this.buildScreens();
    this.loading.setProgress(1, 'Ready');
    await nextFrame();

    window.addEventListener('resize', () => this.onViewportResize());
    document.addEventListener('visibilitychange', () => {
      void audioSystem.setSuspended(document.hidden);
    });
    window.addEventListener('keydown', (e) => this.onGlobalKey(e));
    /*
     * Tab holds the scoreboard open, and the default has to go: in a browser
     * Tab moves focus, so without preventDefault the first press walks the
     * keyboard focus onto some button behind the canvas and the next Space
     * presses it.
     */
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Tab') return;
      e.preventDefault();
      this.scoreboardOpen = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.scoreboardOpen = false;
    });
    // Alt-Tabbing away releases the key somewhere else, so the board would
    // still be up on return.
    window.addEventListener('blur', () => {
      this.scoreboardOpen = false;
    });

    graphicsConfig.onChange((s) => this.applyGraphics(s));

    // The menu shows the live world, so start a local host immediately: the
    // background jungle is a real simulation, not a video.
    await this.startLocalHost(menuSeed, 0);

    this.showScreen('menu');
    this.loading.hide();

    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private buildScreens(): void {
    const actions: ScreenActions = {
      onPlaySolo: () => void this.playSolo(),
      onPlayOnline: (url, room) => void this.playOnline(url, room),
      onOpenSettings: () => {
        this.previousScreen = this.screen;
        this.settings.rebuild();
        this.showScreen('settings');
      },
      onCloseSettings: () => {
        const target = this.previousScreen === 'settings' ? 'menu' : this.previousScreen;
        this.showScreen(target);
        // Returning to a live round: this click is a gesture, so take the mouse
        // back immediately rather than leaving the cursor free until the player
        // happens to click again.
        if (target === 'hud') void this.input.requestLock();
      },
      onSetReady: (ready) => this.transport?.send({ t: ClientMsg.SetReady, ready }),
      onStartRound: () => {
        this.transport?.send({ t: ClientMsg.StartRound });
        /*
         * Take the mouse now, on this click.
         *
         * This is the whole reason the cursor stays on one monitor: pointer lock
         * confines it to the window, and a browser will only grant it from a
         * user gesture. Waiting until the round actually begins is too late —
         * the intro countdown has burned the gesture by then. Players who did
         * not press this button (anyone but the host, online) get the lock from
         * their first click or keypress once the round is live.
         */
        void this.input.requestLock();
      },
      onLeaveLobby: () => void this.leave(),
      onPlayAgain: () => void this.playAgain(),
      onBackToMenu: () => void this.leave(),
      onSettingsChanged: (s) => this.applyGraphics(s),
    };

    this.menu = new MainMenu(actions);
    this.settings = new SettingsScreen(actions);
    this.lobby = new LobbyScreen(actions);
    this.roleScreen = new RoleScreen();
    this.results = new ResultScreen(actions);

    this.uiRoot.append(
      this.menu.root,
      this.settings.root,
      this.lobby.root,
      this.roleScreen.root,
      this.hud.root,
      this.results.root,
    );
  }

  // =========================================================================
  // Screens
  // =========================================================================

  private showScreen(name: ScreenName): void {
    this.screen = name;
    const map: Record<string, HTMLElement | null> = {
      menu: this.menu.root,
      settings: this.settings.root,
      lobby: this.lobby.root,
      role: this.roleScreen.root,
      hud: this.hud.root,
      result: this.results.root,
      loading: null,
    };
    for (const [key, node] of Object.entries(map)) {
      node?.classList.toggle('active', key === name);
    }

    // Input and the hidden cursor belong to the in-round screen only — menus
    // need a visible, working cursor.
    /*
     * Music follows the screen, not the round.
     *
     * The lobby and the results screen get the jungle loop; the round itself
     * gets silence, because the round's soundtrack is rain and insects and the
     * thing you are listening for is a whistle. Starting it here rather than at
     * each transition means there is one place that decides, and no path through
     * the UI can leave music playing over a live round.
     */
    if (name === 'lobby' || name === 'menu') audioSystem.startMusic('lobby');
    else if (name !== 'result') audioSystem.stopMusic();

    const playing = name === 'hud';
    this.input.setEnabled(playing);
    this.renderer.cameraRig.setFreeMode(!playing);
    /*
     * The viewmodel is parented to the camera, so it does not go away on its own
     * when the round does — it would hang in front of the menu's orbit shot of
     * the river. Anything that leaves the round takes the gun with it.
     */
    if (!playing) {
      this.renderer.setViewWeapon(false);
      this.hud.setFirstPerson(false);
    } else {
      /*
       * ...and anything that *enters* the round has to put it back.
       *
       * The role card is a screen, and it is the screen the hunter is on at the
       * exact moment his role arrives — so the packet handler switched the
       * first-person view on and this branch switched it straight back off a
       * line later. The hunter then played with the camera at eye height inside
       * a body that was still being drawn: his own shoulder filled the screen,
       * he had no gun in shot, and the game was behind him.
       *
       * Deriving it here rather than remembering a flag means every route into
       * the round — role card, respawn, a reconnect mid-round — agrees.
       */
      const firstPerson = this.renderer.cameraRig.firstPerson && !this.state.dead;
      this.renderer.setViewWeapon(firstPerson);
      this.hud.setFirstPerson(firstPerson);
    }
    document.body.classList.toggle('playing', playing);

    /*
     * The pointer lock spans the role card as well as the round itself.
     *
     * It is acquired on the click that starts the round (the only user gesture
     * available), and the role card sits between that click and the live round.
     * Releasing it here would throw the lock away a moment after taking it, and
     * the cursor would be free again — able to wander to another monitor —
     * exactly when play begins. Menus and the results screen do release it,
     * because those need clicking.
     */
    const keepsPointerLock = playing || name === 'role';
    if (!keepsPointerLock) {
      this.input.releaseLock();
      this.pointMenuCameraAtSomethingNice();
    }
  }

  /**
   * Aim the menu's orbit camera at a riverbank.
   *
   * A river gives the shot water, a bank, canopy and open sky all at once,
   * which is a far better advertisement for the game than a random patch of
   * undergrowth. The terrain already knows where its rivers are.
   */
  private pointMenuCameraAtSomethingNice(): void {
    const river = this.terrain.rivers[0];
    if (river && river.points.length > 8) {
      // A point a third of the way along the main channel.
      const point = river.points[Math.floor(river.points.length / 3)];
      this.renderer.cameraRig.setFreeAnchor(point.x, point.z, 58);
      return;
    }
    this.renderer.cameraRig.setFreeAnchor(0, 0, 52);
  }

  private onGlobalKey(e: KeyboardEvent): void {
    if (e.code === 'F3') {
      e.preventDefault();
      this.debugVisible = !this.debugVisible;
    }
    if (e.code === 'Escape') {
      if (this.screen === 'hud') {
        this.previousScreen = 'hud';
        this.settings.rebuild();
        this.showScreen('settings');
      } else if (this.screen === 'settings') {
        this.showScreen(this.previousScreen === 'settings' ? 'menu' : this.previousScreen);
      }
    }
  }

  // =========================================================================
  // Connecting
  // =========================================================================

  private transportHandlers(): TransportHandlers {
    return {
      onPacket: (packet) => this.onPacket(packet),
      onSnapshot: (snapshot) => this.onSnapshot(snapshot),
      onOpen: () => {
        this.transport?.send({
          t: ClientMsg.Join,
          name: loadPlayerName(),
          version: PROTOCOL_VERSION,
        });
      },
      onClose: (reason) => {
        this.hud.toast(`Disconnected: ${reason}`, true, 6);
        if (this.screen === 'hud' || this.screen === 'lobby') this.showScreen('menu');
      },
      onError: (message) => this.hud.toast(message, true, 5),
    };
  }

  /** Start (or restart) a local authority in this tab. */
  private async startLocalHost(seed: number, bots: number): Promise<void> {
    this.transport?.disconnect();
    const local = new LocalTransport({ seed, practiceBots: bots });
    this.transport = local;
    await local.connect(this.transportHandlers());
  }

  /** Begin a solo round with practice bots so roles get dealt meaningfully. */
  private async playSolo(): Promise<void> {
    await audioSystem.start();
    this.loading.show();
    this.loading.setProgress(0.2, 'Growing a fresh jungle…');
    this.loading.shuffleTip();
    await nextFrame();

    const seed = Math.floor(Math.random() * 0x7fffffff);
    // Five bots means a real lobby: one hunter and five potential victims.
    await this.startLocalHost(seed, 5);
    await this.rebuildWorld(seed);

    this.loading.hide();
    this.lobby.setClientId(this.state.clientId);
    this.lobby.resetReady();
    this.showScreen('lobby');
  }

  /** Connect to a dedicated server. */
  private async playOnline(url: string, room: string): Promise<void> {
    await audioSystem.start();
    const target = room ? `${url}?room=${encodeURIComponent(room)}` : url;
    this.hud.toast(`Connecting to ${url}…`);
    try {
      this.transport?.disconnect();
      const socket = new SocketTransport(target);
      this.transport = socket;
      await socket.connect(this.transportHandlers());
      this.lobby.resetReady();
      this.showScreen('lobby');
      this.hud.toast('Connected.');
    } catch (err) {
      this.hud.toast(
        `Could not connect. Is the server running? (${err instanceof Error ? err.message : String(err)})`,
        true,
        7,
      );
      // Fall back to the local menu world so the client stays usable.
      await this.startLocalHost(Math.floor(Math.random() * 0x7fffffff), 0);
      this.showScreen('menu');
    }
  }

  /**
   * The viewport changed size — the host window, or the panel the game is
   * embedded in, was resized.
   *
   * The 3D view repaints for free, because the canvas is redrawn every frame. The
   * HTML interface is not: it is only painted when something about it changes, so
   * a resize leaves the compositor holding a paint made for the old layout. In an
   * embedded webview that stale paint is not always discarded, and the result is a
   * ghost copy of the interface — most visibly the role card — still sitting where
   * the old, differently-sized layout had centred it.
   *
   * Removing the blend-mode and backdrop-filter layers removed the cause. Nudging
   * the UI layer into a genuine repaint covers the rest: a forced reflow with the
   * layer detached, so the next paint has to be produced from scratch. It costs
   * one synchronous layout on an event that already triggers several.
   */
  private onViewportResize(): void {
    this.renderer.resize();
    this.uiRoot.style.display = 'none';
    void this.uiRoot.offsetHeight; // read back to force the reflow, not just queue it
    this.uiRoot.style.display = '';
  }

  /** Rebuild terrain, props and the renderer for a new seed. */
  private async rebuildWorld(seed: number): Promise<void> {
    const settings = graphicsConfig.get();
    this.terrain = new Terrain(seed);
    await nextFrame();
    this.content = generateWorld(this.terrain, seed, {
      cosmetic: true,
      cosmeticDensity: settings.foliageDensity,
    });
    await nextFrame();
    this.renderer.dispose();
    this.renderer = new Renderer(this.canvas, this.terrain, this.content, settings);
    this.renderer.resize();
  }

  private async leave(): Promise<void> {
    this.transport?.send({ t: ClientMsg.Leave });
    this.transport?.disconnect();
    this.hud.reset();
    this.state.roleCard = null;
    this.state.result = null;
    this.state.actorId = 0;
    this.steerReady = false;
    await this.startLocalHost(Math.floor(Math.random() * 0x7fffffff), 0);
    this.showScreen('menu');
  }

  private async playAgain(): Promise<void> {
    this.hud.reset();
    this.state.result = null;
    // The host returns to the lobby by itself once the reveal times out; going
    // there now lets the player re-pick a species while they wait.
    this.lobby.resetReady();
    this.showScreen('lobby');
  }

  // =========================================================================
  // Packets
  // =========================================================================

  private onPacket(packet: ServerPacket): void {
    switch (packet.t) {
      case ServerMsg.Welcome:
        this.state.clientId = packet.clientId;
        this.lobby.setClientId(packet.clientId);
        break;

      case ServerMsg.Lobby:
        this.lobby.update(packet.lobby);
        break;

      case ServerMsg.RoleCard: {
        // The only place this client learns its own role. Nobody else's role is
        // ever in a packet addressed to us.
        this.state.roleCard = packet.card;
        this.state.role = packet.card.role;
        this.state.species = packet.card.species;
        this.state.weakness = packet.card.weakness;
        this.state.actorId = packet.actorId;
        // A new round means a new spawn and a new facing, so re-seed the
        // steering heading from the first snapshot rather than carrying the
        // previous round's over.
        this.steerReady = false;
        this.state.dead = false;
        this.state.lastHealth = 100;

        this.renderer.setLocalActor(packet.actorId);
        this.renderer.cameraRig.setSpecies(packet.card.species);
        // The hunter plays from inside his own head, with a shotgun in front of
        // him and his own body hidden. Everyone else plays a body they can see.
        this.renderer.setViewWeapon(this.renderer.cameraRig.firstPerson);
        this.hud.setFirstPerson(this.renderer.cameraRig.firstPerson);

        // Apply the weakness's client-visible effects: a narrowed view for a bad
        // eye, and a matching vignette so the player can feel it.
        const weakness = packet.card.weakness ? WEAKNESSES[packet.card.weakness] : null;
        const sight = weakness?.modifiers.sightMultiplier ?? 1;
        this.renderer.setSightModifier(sight);
        this.hud.setEyeImpairment(weakness?.modifiers.peripheralPenalty ?? 0);

        this.roleScreen.show(packet.card);
        this.showScreen('role');
        break;
      }

      case ServerMsg.RoundStatus: {
        const previousPhase = this.state.status?.phase;
        this.state.status = packet.status;
        this.state.world.hour = packet.weather.hour;
        this.state.world.weather = packet.weather.current;
        this.state.world.rain = packet.weather.rain;
        this.state.world.fog = packet.weather.fog;
        this.state.world.wind = packet.weather.wind;
        // The circle comes straight from the authority. The client deliberately
        // does not recompute it: see the note on ZoneWire in Protocol.ts.
        this.state.zone = packet.zone;
        this.state.world.zone = packet.zone
          ? {
              x: packet.zone.x,
              z: packet.zone.z,
              radius: packet.zone.radius,
              shrinking: packet.zone.shrinking,
            }
          : null;

        // Phase transitions drive the screens.
        if (packet.status.phase === RoundPhase.Intro) {
          this.roleScreen.setCountdown(packet.status.timeLeft);
          if (this.screen !== 'role' && this.state.roleCard) this.showScreen('role');
        } else if (packet.status.phase === RoundPhase.Playing) {
          /*
           * Enter the round only from the screens that lead into it.
           *
           * Testing against `!== 'hud'` looks equivalent and is not: round
           * status arrives ten times a second, so any overlay the player opened
           * deliberately — the settings panel on Escape — was slammed shut
           * within 100 ms, taking the mouse cursor with it.
           */
          const enteringFrom = this.screen === 'role' || this.screen === 'lobby' || this.screen === 'result';
          if (enteringFrom) {
            this.hud.reset();
            this.showScreen('hud');
            void this.input.requestLock();
          }
        } else if (packet.status.phase === RoundPhase.Lobby && previousPhase === RoundPhase.RoundOver) {
          if (this.screen === 'result') this.showScreen('lobby');
        }
        break;
      }

      case ServerMsg.Event: {
        this.hud.showEvent(packet.emoji, packet.announcement, packet.detail);
        const def = EVENTS[packet.id];
        // A storm event gets thunder, since the visual alone under-sells it.
        if (def?.forcesWeather === Weather.Storm) audioSystem.playThunder(0.9);
        break;
      }

      case ServerMsg.Scoreboard:
        // Kept whole rather than trimmed: `clientId` is how the board knows
        // which line is yours, and two players may well share a name.
        this.scoreboardEntries = packet.entries;
        this.hud.setScoreboard(this.scoreboardEntries, this.state.clientId);
        break;

      case ServerMsg.KillFeed:
        this.hud.addKill(packet.entry);
        /*
         * A hit marker for the hunter, inferred rather than sent.
         *
         * There is exactly one hunter in a round, so a kill the server
         * attributes to "hunter" is this player's kill — no extra field in the
         * snapshot, and no chance of crediting someone else's shot. It fires
         * for an animal too, deliberately: that is the shot that kills him, and
         * he should see the moment it lands rather than read about it.
         */
        if (this.state.role === Role.Hunter && packet.entry.cause === 'hunter') {
          this.hud.showHitMarker(packet.entry.victimWasPlayer);
          audioSystem.playHitConfirm(packet.entry.victimWasPlayer);
        }
        break;

      case ServerMsg.Result:
        this.state.result = packet.result;
        this.results.show(packet.result, this.state.clientId);
        this.showScreen('result');
        break;

      case ServerMsg.Error:
        this.hud.toast(packet.message, true, 6);
        break;

      default:
        break;
    }
  }

  private onSnapshot(snapshot: Snapshot): void {
    this.state.latestSnapshot = snapshot;
    this.state.world.waterLevel = snapshot.waterLevel;
    this.renderer.applySnapshot(snapshot);

    // --- Detect damage and death ------------------------------------------
    if (snapshot.self) {
      const health = snapshot.self.health;
      if (health < this.state.lastHealth - 0.5) {
        this.hud.showDamage();
        this.renderer.cameraRig.addShake(0.8);
      }
      this.state.lastHealth = health;

      const self = snapshot.actors.find((a) => a.id === snapshot.self!.actorId);
      const nowDead = health <= 0 || (self ? (self.flags & ActorFlags.Dead) !== 0 : false);
      if (nowDead && !this.state.dead) {
        this.state.dead = true;
        this.hud.setDeathReason(
          this.state.role === Role.Hunter
            ? 'The jungle got you first.'
            : 'Something out there was a player.',
        );
        // Dead players watch the rest of the round from above — from outside
        // their own body, and without a gun in shot.
        this.renderer.cameraRig.setFreeMode(true);
        this.renderer.setViewWeapon(false);
        this.hud.setFirstPerson(false);
        this.input.releaseLock();
      }
      // Your own fly swarm buzzes audibly, so you know without looking.
      audioSystem.updateFlyBuzz(snapshot.self.flies);

      /*
       * Bite feedback.
       *
       * The server emits an attack noise, but noises are only streamed to a
       * player while their "listen" sense is active — so without this the player
       * pressed the mouse button and nothing whatsoever happened, which made the
       * attack feel broken even when it was landing. Driving it off the
       * authority's own cooldown means the sound only plays when the server
       * actually accepted the attack.
       */
      const attackReady = snapshot.self.attackReady > 0.5;
      if (this.lastAttackReady && !attackReady) {
        const pos = this.tmpVec;
        if (this.renderer.animals.getPosition(this.state.actorId, pos)) {
          audioSystem.playAttack(pos.x, pos.y, pos.z, false);
        }
        this.renderer.cameraRig.addShake(0.35);
        // Kick the gun in the player's own hands, if they are holding one, and
        // bloom the reticle with it.
        this.renderer.punchViewWeapon();
        this.hud.punchCrosshair();
      }
      this.lastAttackReady = attackReady;
    }

    // --- Play the noises the server let us hear --------------------------
    for (const noise of snapshot.noises) {
      // De-duplicate: the same noise appears in consecutive snapshots until it
      // ages out, and re-triggering it every time would be a stuttering mess.
      const key = `${noise.kind}:${noise.x.toFixed(1)}:${noise.z.toFixed(1)}:${Math.round(snapshot.time - noise.age)}`;
      if (this.playedNoises.has(key)) continue;
      this.playedNoises.add(key);
      const y = this.terrain.surfaceAt(noise.x, noise.z) + 0.6;
      audioSystem.playNoiseEvent(noise.kind, noise.x, y, noise.z, 0);
    }
    if (this.playedNoises.size > 400) this.playedNoises.clear();
  }

  // =========================================================================
  // The frame loop
  // =========================================================================

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // Step a locally hosted authority. A remote server steps itself.
    this.transport?.update(dt);

    audioSystem.beginFrame(now / 1000);

    if (this.screen === 'hud') {
      this.tickPlayerInput(dt);
    }

    // Lightning: flash the world and fire thunder on the leading edge.
    this.state.world.lightning = Math.max(0, this.state.world.lightning - dt * 3);
    if (this.state.world.rain > 0.85 && Math.random() < dt * 0.09) {
      this.state.world.lightning = 1;
      if (now / 1000 - this.lastLightningTime > 3) {
        this.lastLightningTime = now / 1000;
        // A short delay before the thunder, as distance demands.
        setTimeout(() => audioSystem.playThunder(0.7 + Math.random() * 0.3), 400 + Math.random() * 1400);
      }
    }

    this.renderer.render(dt, this.state.world);
    this.updateAudioListener();
    this.updateHud(dt);

    requestAnimationFrame((t) => this.frame(t));
  }

  /** Read input, convert it to world space, and send it at a fixed rate. */
  private tickPlayerInput(dt: number): void {
    const def = ANIMALS[this.state.species];
    // R and F mean ascend/descend while airborne, and climb up/down otherwise.
    // The authoritative airborne flag comes back in the snapshot.
    const state = this.input.read({
      canFly: def.locomotion.canFly,
      isFlying: this.isAirborne(),
    });

    // Camera look.
    this.renderer.cameraRig.addLook(state.lookX, state.lookY);
    if (state.zoom !== 0) this.renderer.cameraRig.addZoom(state.zoom);

    const { moveX, moveZ } = this.steer(state.moveForward, state.moveRight, dt);

    // Play the local whistle immediately rather than waiting for the round trip:
    // the sound is feedback for a button press, and 100 ms of lag on it feels
    // broken even though the mechanic itself is server-authoritative.
    if ((state.actions & InputAction.Whistle) !== 0) {
      /*
       * Only if the whistle will actually go out.
       *
       * The sound used to play on the key press unconditionally, and a whistle
       * refused for being inside its cooldown then *sounded* exactly like one
       * that worked — while the minute did not reset. That is the whole of
       * "sometimes it does not register": it did register, the server said not
       * yet, and nothing on this side said so. The cooldown is in the snapshot,
       * so the client can tell the difference and give the honest answer.
       */
      const ready = (this.state.latestSnapshot?.self?.whistleCooldown ?? 0) <= 0;
      if (ready) {
        audioSystem.playWhistle(0, 0, 0, this.state.actorId, true);
      } else {
        audioSystem.playUiClick('back');
        this.hud.toast('Catching your breath — wait a moment before whistling again', false, 1.6);
      }
    }

    this.inputAccumulator += dt;
    const interval = 1 / CLIENT_INPUT_RATE;
    // Send at a fixed rate regardless of frame rate, so a 144 Hz client does not
    // flood the server (or gain any advantage over a 60 Hz one).
    if (this.inputAccumulator >= interval) {
      this.inputAccumulator %= interval;
      const input: PlayerInput = {
        seq: ++this.inputSeq,
        moveX,
        moveZ,
        yaw: this.renderer.cameraRig.lookYaw,
        pitch: this.renderer.cameraRig.lookPitch,
        actions: state.actions,
      };
      this.transport?.send({ t: ClientMsg.Input, input });
    } else if (state.actions !== 0) {
      // One-shot actions must never be dropped by the rate limiter, or a
      // whistle press would sometimes silently do nothing.
      const oneShots =
        InputAction.Whistle | InputAction.Ability | InputAction.Listen | InputAction.Attack | InputAction.Jump;
      if ((state.actions & oneShots) !== 0) {
        const input: PlayerInput = {
          seq: ++this.inputSeq,
          moveX,
          moveZ,
          yaw: this.renderer.cameraRig.lookYaw,
          pitch: this.renderer.cameraRig.lookPitch,
          actions: state.actions,
        };
        this.transport?.send({ t: ClientMsg.Input, input });
      }
    }
  }

  /**
   * Turn WASD into a wish direction in the animal's own frame.
   *
   * **The camera does not steer.** W drives along the animal's own facing, A and D
   * turn it, and the mouse only moves the camera — so you can look straight
   * backwards while still running forwards, which is the whole point. Previously
   * the wish direction was built from the camera basis, so "forward" meant "away
   * from the camera": glancing over your shoulder to check for a jaguar turned the
   * animal round and ran you back into it.
   *
   * The heading is integrated on the client and sent as an ordinary world-space
   * direction, so the server needs no changes and stays the sole authority on how
   * fast a body can actually turn. Two details make that safe:
   *
   *  • It is seeded from, and tethered to, the animal's real yaw out of the
   *    snapshot, so the client can never wind it somewhere the body is not.
   *  • Turning on the spot still sends a *tiny* throttle rather than zero. The
   *    movement solver only rotates a body when it has some throttle, so at
   *    exactly zero the animal would refuse to turn at all; 2% is enough to
   *    satisfy it and amounts to about eight centimetres a second of creep.
   *
   * S reverses the drive direction, which turns the animal around and walks it
   * back the way it came. That is deliberate: animals reverse by turning, not by
   * walking backwards, and the tether then carries the steering heading round with
   * the body so W keeps meaning "the way I am now pointing".
   */
  private steer(forward: number, right: number, dt: number): { moveX: number; moveZ: number } {
    const bodyYaw = this.localActorYaw();

    if (bodyYaw !== null && !this.steerReady) {
      this.steerYaw = bodyYaw;
      this.steerReady = true;
    }

    // A/D steer. The animal faces +X at yaw 0 and its own right-hand side is +Z,
    // so turning right is an increase in yaw.
    const steering = Math.abs(right) > 0.01;
    if (steering) this.steerYaw += right * STEER_RATE * dt;

    if (bodyYaw !== null) {
      const lead = angleDelta(bodyYaw, this.steerYaw);
      if (steering) {
        this.steerYaw = bodyYaw + clamp(lead, -STEER_MAX_LEAD, STEER_MAX_LEAD);
      } else {
        /*
         * ## Releasing the key has to stop the turn
         *
         * The steering heading deliberately runs *ahead* of the body — that lead
         * is what keeps the animal turning at its own maximum rate instead of
         * chasing the key frame by frame. But the lead was only ever clamped,
         * never cancelled, so letting go of D at ninety degrees left a target
         * still half a radian further round and the animal kept going to a
         * hundred and twenty. It read as a stuck key or as absurd sensitivity,
         * and it made precise aiming impossible: you cannot stop where you meant
         * to if releasing the control does not mean stop.
         *
         * Collapsing the lead towards zero the moment the key is up fixes it.
         * Quickly rather than instantly, because snapping the heading onto a
         * body yaw that only arrives ten times a second makes the last few
         * degrees of every turn stutter.
         */
        this.steerYaw = bodyYaw + lead * Math.max(0, 1 - dt * 18);
      }
    }

    const driving = Math.abs(forward) > 0.01;
    const turning = Math.abs(right) > 0.01;
    if (!driving && !turning) return { moveX: 0, moveZ: 0 };

    const heading = forward < 0 ? this.steerYaw + Math.PI : this.steerYaw;
    const magnitude = driving ? Math.abs(forward) : 0.02;
    return {
      moveX: Math.cos(heading) * magnitude,
      moveZ: Math.sin(heading) * magnitude,
    };
  }

  /** The local animal's authoritative facing, or null before the first snapshot. */
  private localActorYaw(): number | null {
    const snapshot = this.state.latestSnapshot;
    if (!snapshot || this.state.actorId === 0) return null;
    for (const actor of snapshot.actors) {
      if (actor.id === this.state.actorId) return actor.yaw;
    }
    return null;
  }

  /** Is the local player's animal currently off the ground? */
  private isAirborne(): boolean {
    const snapshot = this.state.latestSnapshot;
    if (!snapshot) return false;
    const self = snapshot.actors.find((a) => a.id === this.state.actorId);
    return self ? (self.flags & ActorFlags.Airborne) !== 0 : false;
  }

  private updateAudioListener(): void {
    const camera = this.renderer.camera;
    camera.getWorldDirection(this.cameraForward);
    audioSystem.setListener(
      camera.position.x,
      camera.position.y,
      camera.position.z,
      this.cameraForward.x,
      this.cameraForward.z,
    );

    // Ambience needs to know where the player is, not just where the camera is.
    const self = this.state.latestSnapshot?.self;
    const nearWater = this.nearWaterAmount();
    audioSystem.updateAmbience({
      rain: this.state.world.rain,
      wind: this.state.world.wind,
      nearWater,
      nightFactor: clamp01((this.state.world.hour - 17.8) / 2.7),
      underCanopy: this.terrain.foliageAt(camera.position.x, camera.position.z),
      whistleTension:
        self && this.state.role === Role.Survivor
          ? clamp01(self.sinceWhistle / WHISTLE_INTERVAL)
          : 0,
      storm: this.renderer.stormExposure,
      dt: 0,
    });
  }

  /** How close the player is to open water, for the river ambience. */
  private nearWaterAmount(): number {
    const pos = this.renderer.camera.position;
    // Sample a small ring rather than a single point, so standing two metres
    // from the bank still sounds like being at a river.
    let closest = 999;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      for (const r of [4, 12, 26]) {
        const x = pos.x + Math.cos(a) * r;
        const z = pos.z + Math.sin(a) * r;
        if (this.terrain.isWater(x, z)) closest = Math.min(closest, r);
      }
    }
    if (closest > 30) return 0;
    return clamp01(1 - closest / 30);
  }

  /**
   * The storm circle as the HUD needs it.
   *
   * The distance is measured from the *player's animal*, not from the camera.
   * The camera trails several metres behind, and a HUD that says you are two
   * metres from safety while your animal is still being cooked would be worse
   * than no readout at all.
   */
  private zoneHudState(): HudState['zone'] {
    const zone = this.state.zone;
    if (!zone) return null;
    const actorId = this.state.actorId;
    let x = this.renderer.camera.position.x;
    let z = this.renderer.camera.position.z;
    if (actorId && this.renderer.animals.getPosition(actorId, this.tmpVec)) {
      x = this.tmpVec.x;
      z = this.tmpVec.z;
    }
    return {
      stage: zone.stage,
      totalStages: zone.totalStages,
      shrinking: zone.shrinking,
      untilShrink: zone.untilShrink,
      distanceOutside: Math.hypot(x - zone.x, z - zone.z) - zone.radius,
    };
  }

  private updateHud(dt: number): void {
    if (this.screen !== 'hud') {
      if (this.debugVisible) this.hud.setDebug(true, this.debugText());
      return;
    }

    const snapshot = this.state.latestSnapshot;
    const self = snapshot?.self;
    const status = this.state.status;

    const hudState: HudState = {
      health: self?.health ?? 0,
      maxHealth: self?.maxHealth ?? 100,
      hunger: self?.hunger ?? 0,
      stamina: self?.stamina ?? 0,
      maxStamina: self?.maxStamina ?? 100,
      sinceWhistle: self?.sinceWhistle ?? 0,
      flies: self?.flies ?? 0,
      score: self?.score ?? 0,
      scoreboardOpen: this.scoreboardOpen,
      role: this.state.role,
      species: this.state.species,
      weakness: this.state.weakness,
      timeLeft: status?.timeLeft ?? 0,
      survivorsAlive: status?.survivorsAlive ?? 0,
      survivorsTotal: status?.survivorsTotal ?? 0,
      weatherLabel: weatherLabel(this.weatherLabelInput()),
      weatherEmoji: weatherEmoji(this.weatherLabelInput()),
      timeOfDay: describeHour(this.state.world.hour),
      abilityReady: (self?.abilityReady ?? 0) > 0.5,
      listenReady: (self?.listenReady ?? 0) > 0.5,
      eating: (self?.eatProgress ?? 0) > 0,
      dead: this.state.dead,
      underwater: this.renderer.cameraRig.underwater,
      zone: this.zoneHudState(),
      interactPrompt: this.buildInteractPrompt(),
      pointerLocked: this.input.isLocked,
      pointerLockUnavailable: this.input.lockUnavailable,
    };

    this.hud.update(hudState, dt);
    this.hud.setDebug(this.debugVisible, this.debugText());
  }

  /** The sky, as the HUD needs it for its label. */
  private weatherLabelInput(): WeatherLabelInput {
    return {
      current: this.state.world.weather,
      nightFactor: this.nightFactor(),
    };
  }

  /** 0 in daylight, 1 in full night. Matches the server's own curve. */
  private nightFactor(): number {
    return clamp01((this.state.world.hour - 17.8) / 2.7);
  }

  /** Contextual prompt: what the player can do right here. */
  private buildInteractPrompt(): string | null {
    if (this.state.dead) return null;
    const pos = this.tmpVec;
    if (!this.renderer.animals.getPosition(this.state.actorId, pos)) return null;

    const def = ANIMALS[this.state.species];
    const canGraze = def.eats.includes('plant');
    const density = this.terrain.foliageAt(pos.x, pos.z);
    const inWater = this.terrain.isWater(pos.x, pos.z);

    if (canGraze && density > 0.28 && !this.terrain.isDeepWater(pos.x, pos.z)) {
      return 'Hold <span class="key-cap">E</span> to graze';
    }

    /*
     * Fishing, offered only when there is actually something to catch.
     *
     * This used to appear the moment a fish-eater touched water, anywhere on the
     * map, which made it a lie: the prompt promised a meal and the shoal was two
     * hundred metres upstream. Worse for this game specifically, a prompt that is
     * always on tells a hunter nothing, while one that appears exactly where the
     * fish are is a place he knows a hungry crocodile has to come to.
     *
     * Two things count as something to catch — a shoal marked in the world, or a
     * live piranha in the water beside you — because either one is a meal and a
     * player should not have to know which kind they are looking at.
     */
    if (def.eats.includes('fish') && inWater) {
      let fishNear = false;
      for (const food of this.content.foodSources) {
        if (food.kind !== 'fish' || !food.available) continue;
        if (Math.hypot(food.x - pos.x, food.z - pos.z) < FISH_PROMPT_RANGE) {
          fishNear = true;
          break;
        }
      }
      if (!fishNear && this.state.latestSnapshot) {
        for (const actor of this.state.latestSnapshot.actors) {
          if (actor.species !== Species.Piranha) continue;
          if (Math.hypot(actor.x - pos.x, actor.z - pos.z) < FISH_PROMPT_RANGE) {
            fishNear = true;
            break;
          }
        }
      }
      if (fishNear) return 'Hold <span class="key-cap">E</span> to fish';
    }
    return null;
  }

  private debugText(): string {
    const stats = this.renderer.stats();
    const snapshot = this.state.latestSnapshot;
    const lines = [
      `fps        ${stats.fps.toFixed(0)}`,
      `draws      ${stats.drawCalls}`,
      `tris       ${(stats.triangles / 1000).toFixed(0)}k`,
      `animals    ${stats.animalsDrawn}/${this.renderer.animals.trackedCount}`,
      `foliage    ${stats.foliageBatches} batches`,
      `snapshot   ${snapshot ? snapshot.actors.length : 0} actors`,
      `ping       ${this.transport?.ping ?? 0} ms`,
      `phase      ${this.state.status?.phase ?? '—'}`,
      `weather    ${this.state.world.weather} rain=${this.state.world.rain.toFixed(2)}`,
      `hour       ${this.state.world.hour.toFixed(1)}`,
      `role       ${this.state.role}`,
    ];
    return lines.join('\n');
  }

  private applyGraphics(settings: GraphicsSettings): void {
    this.renderer.setSettings(settings);
  }
}

/** Wait for the next animation frame, so the loading bar can repaint. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function describeHour(hour: number): string {
  if (hour < 17) return 'Afternoon';
  if (hour < 18.6) return 'Golden hour';
  if (hour < 19.6) return 'Sunset';
  if (hour < 20.6) return 'Dusk';
  return 'Night';
}

/** The player's name, remembered between sessions. */
function loadPlayerName(): string {
  try {
    const stored = localStorage.getItem('jungle-jukebox.name');
    if (stored) return stored;
  } catch {
    // Storage unavailable.
  }
  const names = ['Capy', 'Mango', 'Bruno', 'Tapioca', 'Pepe', 'Nacho', 'Yara', 'Pico'];
  const name = `${names[Math.floor(Math.random() * names.length)]}${Math.floor(Math.random() * 90 + 10)}`;
  try {
    localStorage.setItem('jungle-jukebox.name', name);
  } catch {
    // Ignore.
  }
  return name;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const game = new Game();

/*
 * Expose the running client for inspection.
 *
 * This is how the headless verification tools read real numbers out of a live
 * round — camera position, visible instance counts, the authoritative zone —
 * instead of inferring them from pixels. It is also simply the fastest way to
 * debug a rendering problem from a terminal.
 *
 * Note this gives away nothing: the client only ever *receives* its own role,
 * and the whole point of the snapshot design is that another player's role is
 * not in this process's memory to be found. See the note at the top of the file.
 */
(window as unknown as { __jj?: Game }).__jj = game;

void game.boot().catch((err) => {
  // A hard failure during boot must say something useful rather than showing a
  // black screen.
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
                background:#0a1410;color:#f3ede1;font-family:system-ui,sans-serif;padding:30px;text-align:center;">
      <div style="font-size:48px">🌴💥</div>
      <h1 style="margin:14px 0 6px">The jungle failed to grow</h1>
      <p style="opacity:.7;max-width:520px;line-height:1.6">${escapeHtml(message)}</p>
      <p style="opacity:.45;font-size:13px;margin-top:18px">
        This usually means WebGL is unavailable. Check hardware acceleration in your browser settings.
      </p>
    </div>`;
});

function escapeHtml(text: string): string {
  return text.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
