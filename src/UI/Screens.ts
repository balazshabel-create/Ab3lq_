/**
 * Screens.ts — the main menu, settings, lobby, role reveal and round summary.
 *
 * The menu and the round-over screen are where the game either earns another
 * round or loses the player, so they are the loud, cinematic half of the UI. The
 * main menu deliberately sits over the live 3D jungle rather than a static
 * image: animals walk past behind the logo, it rains, the light changes.
 */

import { ANIMALS, PLAYABLE_SPECIES, type AnimalDef } from '../Animals/AnimalTypes';
import { Role } from '../Core/Types';
import { WEAKNESSES } from '../Gameplay/Weaknesses';
import {
  Winner,
  describeKill,
  winnerHeadline,
  type RoleCard,
  type RoundResult,
} from '../Gameplay/RoundState';
import { DEFAULT_BINDINGS } from '../Player/InputManager';
import {
  graphicsConfig,
  type GraphicsSettings,
  type LevelSetting,
} from '../Graphics/QualitySettings';
import { audioSystem } from '../Audio/AudioSystem';
import type { LobbyState } from '../Networking/Protocol';
import { MAX_PLAYERS, ROUND_DURATION, WHISTLE_INTERVAL } from '../Systems/Config';
import {
  clearChildren,
  el,
  formatDuration,
  selectControl,
  settingRow,
  sliderControl,
  toggleControl,
} from './UiUtils';

/** Callbacks the screens fire back into the game. */
export interface ScreenActions {
  onPlaySolo: () => void;
  /**
   * Resolves true once the client is in a lobby, false if the connection
   * failed. The matchmaking dialog needs the answer, not just the attempt: it
   * holds a "searching" animation up until one or the other happens.
   */
  onPlayOnline: (serverUrl: string, roomCode: string) => Promise<boolean>;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onSetReady: (ready: boolean) => void;
  onStartRound: () => void;
  onLeaveLobby: () => void;
  onPlayAgain: () => void;
  onBackToMenu: () => void;
  onSettingsChanged: (settings: GraphicsSettings) => void;
}

export type ScreenName = 'loading' | 'menu' | 'settings' | 'lobby' | 'role' | 'hud' | 'result';

// ---------------------------------------------------------------------------
// Loading screen
// ---------------------------------------------------------------------------

/** Loading tips double as the game's tutorial. */
const LOADING_TIPS = [
  'Whistle every minute. If you forget, flies gather around you — and flies mean "this animal is a person".',
  'The hunter is an animal too. That crocodile in the river might be scenery, AI, or the thing that is going to kill you.',
  'AI animals stop. Constantly. They wander a few metres, pause, look around, graze. If you run in a straight line for forty metres, you are telling on yourself.',
  'Every survivor has a secret weakness. You know yours. Nobody else does — including the hunter.',
  'Hunger is a real clock. Predators starve fastest, which is why they have to keep going out into the open.',
  'Rain hides your footsteps and knocks the flies down. A downpour is the best time to move.',
  'Hide inside a herd, not behind a bush. Nine AI capybaras is better cover than any tree.',
  'The hunter has no weakness, no fly timer, and a slight speed edge. What it does not have is any idea which animal you are.',
  'Eating locks you in place. Never start a meal somewhere you would not want to be caught standing still.',
  'It gets dark. The round always ends at night, and the last three minutes play nothing like the first three.',
];

export class LoadingScreen {
  readonly root: HTMLElement;
  private fill: HTMLElement;
  private status: HTMLElement;
  private tip: HTMLElement;

  constructor() {
    this.root = el('div', { class: 'loading-screen' });
    const title = el('div', { class: 'loading-title' }, 'JUKEJUNGLE');
    const bar = el('div', { class: 'loading-bar' });
    this.fill = el('div', { class: 'loading-fill' });
    bar.appendChild(this.fill);
    this.status = el('div', { class: 'loading-status' }, 'Growing the jungle…');
    this.tip = el('div', { class: 'loading-tip' }, LOADING_TIPS[0]);
    this.root.append(title, bar, this.status, this.tip);
    this.shuffleTip();
  }

  setProgress(fraction: number, status: string): void {
    this.fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    this.status.textContent = status;
  }

  shuffleTip(): void {
    this.tip.textContent = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
  }

  hide(): void {
    this.root.classList.add('hidden');
    // Remove from the layout once the fade has finished.
    setTimeout(() => {
      this.root.style.display = 'none';
    }, 700);
  }

  show(): void {
    this.root.style.display = '';
    this.root.classList.remove('hidden');
  }
}

// ---------------------------------------------------------------------------
// Main menu
// ---------------------------------------------------------------------------

export class MainMenu {
  readonly root: HTMLElement;

  constructor(actions: ScreenActions) {
    this.root = el('div', { id: 'screen-menu', class: 'screen' });

    /*
     * The wordmark, in two halves.
     *
     * "JukeJungle" is one word, but setting it as one word gives a single very
     * wide block of identical lettering and nothing for the eye to catch on.
     * Splitting it lets the two halves carry different weight — a light "JUKE"
     * against a heavy "JUNGLE" — which is what makes a compound name read as a
     * logo rather than as a heading. Two spans, no images.
     */
    const logo = el('div', { class: 'logo' });
    const title = el('h1', { class: 'logo-title' });
    title.append(
      el('span', { class: 'logo-juke' }, 'JUKE'),
      el('span', { class: 'logo-jungle' }, 'JUNGLE'),
    );
    logo.append(
      title,
      // A hairline rule that draws itself in under the title.
      el('div', { class: 'logo-rule' }),
      el('div', { class: 'logo-sub' }, 'One of these animals is a player'),
    );

    const buttons = el('div', { class: 'menu-buttons' });

    const play = el('button', { class: 'btn btn-primary' }, 'Play');
    play.addEventListener('click', () => {
      audioSystem.playUiClick('confirm');
      actions.onPlaySolo();
    });

    const online = el('button', { class: 'btn' }, 'Multiplayer');
    online.addEventListener('click', () => {
      audioSystem.playUiClick();
      this.showOnlineDialog(actions);
    });

    const settings = el('button', { class: 'btn' }, 'Settings');
    settings.addEventListener('click', () => {
      audioSystem.playUiClick();
      actions.onOpenSettings();
    });

    const exit = el('button', { class: 'btn btn-danger' }, 'Exit');
    exit.addEventListener('click', () => {
      audioSystem.playUiClick('back');
      // A browser cannot close a tab it did not open, so be honest about it.
      window.close();
      setTimeout(() => {
        const note = el(
          'div',
          { class: 'toast' },
          'Your browser will not let a page close itself — just close the tab.',
        );
        this.root.appendChild(note);
        setTimeout(() => note.remove(), 4000);
      }, 120);
    });

    buttons.append(play, online, settings, exit);

    this.root.append(
      logo,
      buttons,
      el(
        'div',
        { class: 'menu-footer' },
        'A 3D social-deduction survival game · WASD to move · Q to whistle',
      ),
      el('div', { class: 'menu-version' }, 'prototype build'),
    );
  }

  /**
   * The matchmaking dialog.
   *
   * Two modes, because there are exactly two things a player wants here: drop
   * into whatever jungle has space, or meet friends in a named one. The server
   * address is the third thing, and it is the one nobody wants to think about,
   * so it folds away under "advanced" with a sensible guess already in it.
   *
   * The searching state is not decoration. Connecting either works in a few
   * hundred milliseconds or fails after a timeout, and both of those feel like
   * a frozen button unless something on screen is visibly working. The radar
   * sweep runs while the socket handshake does, and the status line says what
   * is actually being attempted.
   */
  private showOnlineDialog(actions: ScreenActions): void {
    const existing = this.root.querySelector('.online-dialog');
    if (existing) {
      existing.remove();
      return;
    }

    const dialog = el('div', { class: 'panel online-dialog' });

    const header = el('div', { class: 'panel-header' });
    header.append(el('h2', { class: 'panel-title' }, '◈ Find a jungle'));
    const body = el('div', { class: 'panel-body' });

    const defaultUrl =
      typeof location !== 'undefined'
        ? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname}:8787`
        : 'ws://localhost:8787';

    // --- Mode chips --------------------------------------------------------
    let mode: 'quick' | 'code' = 'quick';
    const modeRow = el('div', { class: 'mm-modes' });
    const codeField = el('div', { class: 'mm-field' });
    const codeInput = el('input', {
      type: 'text',
      value: '',
      maxlength: '8',
      placeholder: 'e.g. MANGO',
      class: 'mm-code-input',
    });
    codeField.append(el('div', { class: 'section-title' }, 'Room code'), codeInput);

    const modes: { id: 'quick' | 'code'; label: string; hint: string }[] = [
      { id: 'quick', label: 'Quick match', hint: 'First jungle with space' },
      { id: 'code', label: 'Room code', hint: 'Play with friends' },
    ];
    const modeButtons = new Map<string, HTMLElement>();
    for (const def of modes) {
      const chip = el('button', { class: 'mm-mode' });
      chip.append(el('strong', {}, def.label), el('span', {}, def.hint));
      chip.addEventListener('click', () => {
        audioSystem.playUiClick();
        mode = def.id;
        for (const [id, node] of modeButtons) node.classList.toggle('active', id === mode);
        codeField.classList.toggle('hidden', mode !== 'code');
        if (mode === 'code') codeInput.focus();
      });
      modeButtons.set(def.id, chip);
      modeRow.appendChild(chip);
    }
    modeButtons.get('quick')!.classList.add('active');
    codeField.classList.add('hidden');

    // --- Advanced: the server address --------------------------------------
    const urlInput = el('input', { type: 'text', value: defaultUrl });
    const advanced = el('details', { class: 'mm-advanced' });
    const summary = el('summary', {}, 'Server address');
    advanced.append(summary, urlInput);

    // --- The searching state -----------------------------------------------
    const searching = el('div', { class: 'mm-searching hidden' });
    const radar = el('div', { class: 'mm-radar' });
    radar.append(el('div', { class: 'mm-radar-sweep' }), el('div', { class: 'mm-radar-blip' }));
    const searchText = el('div', { class: 'mm-search-text' }, 'Scanning the canopy…');
    searching.append(radar, searchText);

    const error = el('div', { class: 'mm-error hidden' });

    body.append(
      el(
        'div',
        { class: 'hint-text' },
        'Multiplayer needs a host: run "npm run server" on one machine and share its address. Everyone else drops in from here.',
      ),
      modeRow,
      codeField,
      advanced,
      searching,
      error,
    );

    const footer = el('div', { class: 'panel-footer' });
    const cancel = el('button', { class: 'btn btn-small' }, 'Cancel');
    cancel.addEventListener('click', () => {
      audioSystem.playUiClick('back');
      dialog.remove();
    });
    const connect = el('button', { class: 'btn btn-small btn-primary' }, 'Search');

    // Cycle the status line while the socket is opening, so a slow connection
    // reads as progress rather than as a hang.
    const PHASES = [
      'Scanning the canopy…',
      'Following the river…',
      'Knocking on the jungle…',
      'Waiting for the host…',
    ];
    let phaseTimer = 0;

    const beginSearch = () => {
      audioSystem.playUiClick('confirm');
      error.classList.add('hidden');
      searching.classList.remove('hidden');
      dialog.classList.add('is-searching');
      connect.disabled = true;
      connect.textContent = 'Searching…';
      let phase = 0;
      searchText.textContent = PHASES[0];
      phaseTimer = window.setInterval(() => {
        phase = (phase + 1) % PHASES.length;
        searchText.textContent = PHASES[phase];
      }, 1400);

      const code = mode === 'code' ? codeInput.value.trim().toUpperCase() : '';
      void actions.onPlayOnline(urlInput.value.trim(), code).then((ok) => {
        window.clearInterval(phaseTimer);
        if (ok) {
          dialog.remove();
          return;
        }
        searching.classList.add('hidden');
        dialog.classList.remove('is-searching');
        connect.disabled = false;
        connect.textContent = 'Search again';
        error.classList.remove('hidden');
        error.textContent =
          'No jungle answered. Check that the server is running and that the address is reachable from here.';
      });
    };

    connect.addEventListener('click', beginSearch);
    codeInput.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') beginSearch();
    });
    footer.append(cancel, connect);

    dialog.append(header, body, footer);
    this.root.appendChild(dialog);
    connect.focus();
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export class SettingsScreen {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private presetButtons = new Map<string, HTMLElement>();
  private actions: ScreenActions;
  private activeTab = 'graphics';

  constructor(actions: ScreenActions) {
    this.actions = actions;
    this.root = el('div', { id: 'screen-settings', class: 'screen panel-screen' });

    const panel = el('div', { class: 'panel' });
    const header = el('div', { class: 'panel-header' });
    header.append(el('h2', { class: 'panel-title' }, '⚙ Settings'));
    const close = el('button', { class: 'btn btn-small' }, 'Close');
    close.addEventListener('click', () => {
      audioSystem.playUiClick('back');
      actions.onCloseSettings();
    });
    header.appendChild(close);

    this.body = el('div', { class: 'panel-body' });
    panel.append(header, this.body);
    this.root.appendChild(panel);
    this.rebuild();
  }

  /** Rebuild the whole panel from the current settings. */
  rebuild(): void {
    clearChildren(this.body);
    this.presetButtons.clear();

    // --- Tabs ------------------------------------------------------------
    const tabs = el('div', { class: 'settings-tabs' });
    const panels = new Map<string, HTMLElement>();
    const tabDefs: { id: string; label: string }[] = [
      { id: 'graphics', label: 'Graphics' },
      { id: 'audio', label: 'Audio' },
      { id: 'controls', label: 'Controls' },
      { id: 'howto', label: 'How to play' },
    ];

    for (const def of tabDefs) {
      const tab = el('div', { class: 'tab' }, def.label);
      const panel = el('div', { class: 'tab-panel' });
      panels.set(def.id, panel);
      tab.addEventListener('click', () => {
        audioSystem.playUiClick();
        this.activeTab = def.id;
        for (const [id, node] of panels) node.classList.toggle('active', id === this.activeTab);
        for (const child of Array.from(tabs.children)) {
          child.classList.toggle('active', child.textContent === def.label);
        }
      });
      if (def.id === this.activeTab) {
        tab.classList.add('active');
        panel.classList.add('active');
      }
      tabs.appendChild(tab);
    }
    this.body.appendChild(tabs);

    this.buildGraphicsTab(panels.get('graphics')!);
    this.buildAudioTab(panels.get('audio')!);
    this.buildControlsTab(panels.get('controls')!);
    this.buildHowToTab(panels.get('howto')!);

    for (const panel of panels.values()) this.body.appendChild(panel);
  }

  private buildGraphicsTab(container: HTMLElement): void {
    const settings = graphicsConfig.get();

    // --- Presets ---------------------------------------------------------
    container.append(el('div', { class: 'section-title' }, 'Preset'));
    const presetRow = el('div', { class: 'preset-row' });
    const presets: { id: 'low' | 'medium' | 'high'; label: string; hint: string }[] = [
      { id: 'low', label: 'LOW', hint: 'Older machines' },
      { id: 'medium', label: 'MEDIUM', hint: 'Balanced' },
      { id: 'high', label: 'HIGH', hint: 'Full jungle' },
    ];
    for (const preset of presets) {
      const btn = el('button', { class: 'preset-btn' });
      btn.append(el('strong', {}, preset.label), el('span', {}, preset.hint));
      if (settings.preset === preset.id) btn.classList.add('active');
      btn.addEventListener('click', () => {
        audioSystem.playUiClick('confirm');
        graphicsConfig.applyPreset(preset.id);
        this.actions.onSettingsChanged(graphicsConfig.get());
        this.rebuild();
      });
      this.presetButtons.set(preset.id, btn);
      presetRow.appendChild(btn);
    }
    container.appendChild(presetRow);

    if (settings.preset === 'custom') {
      container.append(
        el('div', { class: 'hint-text' }, 'Custom settings — pick a preset above to reset.'),
      );
    }

    // --- Individual options ----------------------------------------------
    container.append(el('div', { class: 'section-title' }, 'Detail'));

    const levelOptions: { value: LevelSetting; label: string }[] = [
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ];

    const level = (
      label: string,
      hint: string,
      key: 'shadowQuality' | 'textureQuality' | 'effectsQuality' | 'foliageQuality' | 'waterQuality',
      allowOff = true,
    ) => {
      const options = allowOff ? levelOptions : levelOptions.filter((o) => o.value !== 'off');
      container.appendChild(
        settingRow(
          label,
          hint,
          selectControl(options, settings[key], (value) => {
            graphicsConfig.set(key, value);
            this.actions.onSettingsChanged(graphicsConfig.get());
          }),
        ),
      );
    };

    level('Shadow Quality', 'Sun shadows. The biggest single cost.', 'shadowQuality');
    level('Texture Quality', 'Surface detail on terrain and props.', 'textureQuality', false);
    level('Effects Quality', 'Rain, particles, flies.', 'effectsQuality');
    level('Foliage Quality', 'How thick the jungle is — affects hiding places.', 'foliageQuality', false);
    level('Water Quality', 'River reflections and waves.', 'waterQuality', false);

    const viewSlider = sliderControl({
      min: 90,
      max: 320,
      step: 10,
      value: settings.viewDistance,
      format: (v) => `${v} m`,
      onChange: (v) => {
        graphicsConfig.set('viewDistance', v);
        this.actions.onSettingsChanged(graphicsConfig.get());
      },
    });
    container.appendChild(
      settingRow(
        'View Distance',
        'How far you can see. Also pulls the fog in.',
        viewSlider.control,
        viewSlider.value,
      ),
    );

    const resSlider = sliderControl({
      min: 0.5,
      max: 1.5,
      step: 0.05,
      value: settings.resolutionScale,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => {
        graphicsConfig.set('resolutionScale', v);
        this.actions.onSettingsChanged(graphicsConfig.get());
      },
    });
    container.appendChild(
      settingRow(
        'Resolution Scale',
        'Lower this first if the frame rate is poor.',
        resSlider.control,
        resSlider.value,
      ),
    );

    container.append(el('div', { class: 'section-title' }, 'Post-processing'));

    const boolean = (
      label: string,
      hint: string,
      key: 'antiAliasing' | 'ambientOcclusion' | 'volumetricFog' | 'motionBlur' | 'vsync' | 'stars',
    ) => {
      container.appendChild(
        settingRow(
          label,
          hint,
          toggleControl(settings[key], (value) => {
            graphicsConfig.set(key, value);
            this.actions.onSettingsChanged(graphicsConfig.get());
          }),
        ),
      );
    };

    boolean('Anti-Aliasing', 'Smooths jagged edges. Needs a reload to fully apply.', 'antiAliasing');
    boolean('Ambient Occlusion', 'Contact shadows in the undergrowth.', 'ambientOcclusion');
    boolean('Volumetric Fog', 'Layered ground mist. Strongly recommended.', 'volumetricFog');
    boolean('Motion Blur', 'Blur while turning quickly.', 'motionBlur');
    boolean('VSync', 'Caps the frame rate to your monitor.', 'vsync');
    boolean('Star Field', 'Stars at night.', 'stars');
  }

  private buildAudioTab(container: HTMLElement): void {
    const audio = audioSystem.getSettings();
    container.append(el('div', { class: 'section-title' }, 'Volume'));

    const volume = (
      label: string,
      hint: string,
      key: 'master' | 'sfx' | 'ambience' | 'music',
    ) => {
      const slider = sliderControl({
        min: 0,
        max: 1,
        step: 0.05,
        value: audio[key],
        format: (v) => `${Math.round(v * 100)}%`,
        onChange: (v) => audioSystem.setVolume(key, v),
      });
      container.appendChild(settingRow(label, hint, slider.control, slider.value));
    };

    volume('Master', 'Everything.', 'master');
    volume('Sound Effects', 'Whistles, footsteps, bites.', 'sfx');
    volume('Ambience', 'Rain, insects, the river.', 'ambience');
    volume('Tension', 'The drone that rises when your whistle is overdue.', 'music');

    container.appendChild(
      settingRow(
        'Mute All',
        'Silence everything.',
        toggleControl(audio.muted, (value) => audioSystem.setMuted(value)),
      ),
    );

    container.append(
      el(
        'div',
        { class: 'hint-text' },
        'Every sound in this game is synthesised at runtime — there are no audio files. Sound is also information: whistles are positional, so you can tell roughly where one came from.',
      ),
    );
  }

  private buildControlsTab(container: HTMLElement): void {
    container.append(el('div', { class: 'section-title' }, 'Mouse'));
    const sens = sliderControl({
      min: 0.0004,
      max: 0.006,
      step: 0.0002,
      value: 0.0022,
      format: (v) => `${(v * 1000).toFixed(1)}`,
      onChange: () => {
        // Applied by the game loop, which owns the InputManager.
      },
    });
    container.appendChild(settingRow('Sensitivity', 'Mouse look speed.', sens.control, sens.value));

    container.append(el('div', { class: 'section-title' }, 'Controls'));
    const list = el('div', { class: 'controls-list' });
    for (const binding of DEFAULT_BINDINGS) {
      const row = el('div', { class: 'control-row' });
      row.append(
        el('div', { class: 'control-key' }, binding.label),
        el('div', {}, binding.description),
      );
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  private buildHowToTab(container: HTMLElement): void {
    const sections: { title: string; body: string }[] = [
      {
        title: 'The premise',
        body: `You are an animal in the Amazon, surrounded by hundreds of AI animals that look and move exactly like you. One of the players is the HUNTER — also an animal, also surrounded by its own kind. Survive ${Math.round(ROUND_DURATION / 60)} minutes.`,
      },
      {
        title: 'The whistle',
        body: `Every ${WHISTLE_INTERVAL} seconds you must press Q to whistle. You choose exactly when. Miss the deadline and flies start gathering on you — and a swarm of flies is the one thing that says "this animal is a person". Whistling is loud, so the timing is the whole decision.`,
      },
      {
        title: 'Behave like an animal',
        body: 'There is no disguise button. The AI animals wander a few metres, stop, look around, graze, drift towards water, sleep at night. If you sprint in straight lines and pivot instantly, you will be found. Copy them.',
      },
      {
        title: 'Your secret weakness',
        body: 'Every survivor gets one random handicap suited to their species — a limp, a bad eye, a fast metabolism. You are the only one who knows yours. The hunter has to work out from your behaviour why you are slower than the others.',
      },
      {
        title: 'Hunger',
        body: 'You have to eat. Herbivores can graze almost anywhere; predators have to hunt, which means going into the open. Every species starves at a different rate, so what is safe for a sloth is fatal for a jaguar.',
      },
      {
        title: 'The hunter',
        body: 'No weapon, no weakness, no fly timer, and a slight speed edge. What the hunter does not have is any way of knowing which animal is a person. It has to watch, listen for noises, read footprints, and pick its moment. A missed lunge is loud and has a long cooldown.',
      },
    ];

    for (const section of sections) {
      container.append(
        el('div', { class: 'section-title' }, section.title),
        el('div', { class: 'hint-text' }, section.body),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

/**
 * A stable colour per player.
 *
 * The lobby is the only place where players are told apart by name alone, and
 * six lines of identical text is a list, not a lobby. Hashing the name into a
 * hue gives everyone a consistent badge colour for as long as they keep the
 * name — and it costs nothing over the wire, because both ends derive it from
 * something they already have.
 */
function playerHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/** The initial shown in a player's badge. */
function monogram(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

/**
 * How many slots to draw for a lobby of this size.
 *
 * Drawing all twelve would make a solo practice lobby eleven-twelfths empty,
 * which reads as "nobody is here and nobody is coming". Showing a couple of
 * open slots past the last player reads as "there is room for more" — the
 * header still says how many the room actually takes.
 */
function visibleSlots(playerCount: number): number {
  return Math.min(MAX_PLAYERS, Math.max(6, playerCount + 2));
}

/** Seconds between the lobby going all-ready and the round starting itself. */
const AUTO_START_SECONDS = 3;

export class LobbyScreen {
  readonly root: HTMLElement;
  private slotGrid: HTMLElement;
  private roomCodeValue: HTMLElement;
  private copyNote: HTMLElement;
  private headCount: HTMLElement;
  private readyFill: HTMLElement;
  private readyCount: HTMLElement;
  private searchNote: HTMLElement;
  private speciesGrid: HTMLElement;
  private speciesDetail: HTMLElement;
  private readyButton: HTMLButtonElement;
  private startButton: HTMLButtonElement;
  private statusLine: HTMLElement;
  private countdownBar: HTMLElement;
  private countdownNumber: HTMLElement;
  private countdownFill: HTMLElement;

  private ready = false;
  private myClientId = '';
  private isHost = false;
  private countdownTimer = 0;
  private countdownLeft = 0;
  private startRound: () => void;
  private setReady: (ready: boolean) => void;

  constructor(actions: ScreenActions) {
    this.startRound = actions.onStartRound;
    this.setReady = actions.onSetReady;
    this.root = el('div', { id: 'screen-lobby', class: 'screen panel-screen' });

    const panel = el('div', { class: 'panel lobby-panel' });
    const header = el('div', { class: 'panel-header' });
    const titleWrap = el('div', { class: 'lobby-heading' });
    titleWrap.append(
      el('h2', { class: 'panel-title' }, 'Matchmaking'),
      el('div', { class: 'lobby-subtitle' }, 'One of you will be the hunter'),
    );
    header.appendChild(titleWrap);

    /*
     * The room code, as a button.
     *
     * Sharing it is the entire point of it existing, and the way a person
     * shares five characters is by copying them. Making the code itself the
     * control means there is nothing to find.
     */
    const roomCode = el('button', { class: 'room-code', title: 'Copy the room code' });
    this.roomCodeValue = el('div', { class: 'room-code-value' }, '—');
    this.copyNote = el('div', { class: 'room-code-copied' }, 'Copied');
    roomCode.append(
      el('div', { class: 'room-code-label' }, 'Room'),
      this.roomCodeValue,
      this.copyNote,
    );
    roomCode.addEventListener('click', () => {
      const code = this.roomCodeValue.textContent ?? '';
      if (!code || code === '—') return;
      audioSystem.playUiClick('confirm');
      // Clipboard access can be refused (insecure origin, denied permission);
      // the flash is the confirmation either way, so failure is not worth a
      // dialog — the code is on screen to be typed.
      void navigator.clipboard?.writeText(code).catch(() => {});
      this.copyNote.classList.add('show');
      window.setTimeout(() => this.copyNote.classList.remove('show'), 1100);
    });
    header.appendChild(roomCode);

    const leave = el('button', { class: 'btn btn-small' }, 'Leave');
    leave.addEventListener('click', () => {
      audioSystem.playUiClick('back');
      this.cancelCountdown();
      actions.onLeaveLobby();
    });
    header.appendChild(leave);

    const body = el('div', { class: 'panel-body' });
    const grid = el('div', { class: 'lobby-grid' });

    // --- Left: the queue ---------------------------------------------------
    const left = el('div');

    /*
     * The status strip: a live pulse, a head count, and a ready meter.
     *
     * Waiting in a lobby is dead time, and dead time with nothing moving on
     * screen feels broken. The pulse runs whenever the room still has space,
     * which is exactly when the player is waiting for something to happen.
     */
    const strip = el('div', { class: 'mm-strip' });
    const pulse = el('div', { class: 'mm-pulse' });
    pulse.append(el('span', {}), el('span', {}), el('span', {}));
    const stripText = el('div', { class: 'mm-strip-text' });
    this.headCount = el('div', { class: 'mm-headcount' }, `0 / ${MAX_PLAYERS}`);
    this.searchNote = el('div', { class: 'mm-search-note' }, 'Searching for players…');
    stripText.append(this.headCount, this.searchNote);
    const meter = el('div', { class: 'mm-meter' });
    this.readyFill = el('div', { class: 'mm-meter-fill' });
    meter.appendChild(this.readyFill);
    this.readyCount = el('div', { class: 'mm-ready-count' }, '0 ready');
    strip.append(pulse, stripText, meter, this.readyCount);
    left.appendChild(strip);

    this.slotGrid = el('div', { class: 'mm-slots' });
    left.appendChild(this.slotGrid);

    this.statusLine = el('div', { class: 'hint-text' }, '');
    this.statusLine.style.marginTop = '14px';
    left.appendChild(this.statusLine);

    /*
     * --- Right: the bestiary ---------------------------------------------
     *
     * Read-only. You are dealt an animal at random when the round starts and
     * there is no way to influence it — see assignRoles for why choosing would
     * wreck both the crowd and the deduction.
     *
     * The list stays, though, because the information is exactly what a player
     * needs while waiting: hover a species and learn how it eats, how fast it
     * starves and what it can do, so that when the card flips over and says
     * "sloth" you already have some idea what that means.
     */
    const right = el('div');
    right.appendChild(el('div', { class: 'section-title' }, 'The jungle'));
    right.appendChild(
      el(
        'div',
        { class: 'hint-text' },
        'You do not choose. When the round starts you are dealt one of these at random, and the world fills with AI animals of your kind to hide among. Read up while you wait.',
      ),
    );
    this.speciesGrid = el('div', { class: 'species-grid' });
    right.appendChild(this.speciesGrid);
    this.speciesDetail = el('div', { class: 'species-detail' });
    right.appendChild(this.speciesDetail);

    grid.append(left, right);
    body.appendChild(grid);

    /*
     * The drop countdown.
     *
     * Once everyone has pressed ready there is nothing left to decide, and
     * making the host find a button before anything happens is the slowest
     * part of a lobby. Three seconds is short enough that the ready click is
     * still the browser's live user gesture when the round starts, which is
     * what lets the game take the mouse without the player clicking again.
     */
    this.countdownBar = el('div', { class: 'mm-countdown hidden' });
    this.countdownNumber = el('div', { class: 'mm-countdown-number' }, '3');
    const countdownTrack = el('div', { class: 'mm-countdown-track' });
    this.countdownFill = el('div', { class: 'mm-countdown-fill' });
    countdownTrack.appendChild(this.countdownFill);
    this.countdownBar.append(
      el('div', { class: 'mm-countdown-label' }, 'Dropping into the jungle'),
      this.countdownNumber,
      countdownTrack,
    );

    const footer = el('div', { class: 'panel-footer lobby-footer' });
    this.readyButton = el('button', { class: 'btn btn-ready' }, 'Ready') as HTMLButtonElement;
    this.readyButton.addEventListener('click', () => {
      this.ready = !this.ready;
      audioSystem.playUiClick(this.ready ? 'confirm' : 'back');
      this.setReadyButton(this.ready);
      actions.onSetReady(this.ready);
    });
    this.startButton = el('button', { class: 'btn btn-small btn-primary' }, 'Start now') as HTMLButtonElement;
    this.startButton.addEventListener('click', () => {
      audioSystem.playUiClick('confirm');
      this.cancelCountdown();
      actions.onStartRound();
    });
    footer.append(this.countdownBar, this.readyButton, this.startButton);

    panel.append(header, body, footer);
    this.root.appendChild(panel);

    this.buildSpeciesGrid();
    this.showSpeciesDetail(null);
  }

  private buildSpeciesGrid(): void {
    clearChildren(this.speciesGrid);

    for (const species of PLAYABLE_SPECIES) {
      const def = ANIMALS[species];
      const card = el('div', { class: 'species-card readonly' });
      card.append(
        el('span', { class: 'emoji' }, def.emoji),
        el('div', { class: 'name' }, def.name),
        el('div', { class: 'diet' }, def.diet),
      );
      // Both events, because a card is a reference entry rather than a control:
      // hovering reads it on a mouse, tapping reads it on a touchscreen.
      const show = () => this.showSpeciesDetail(def);
      card.addEventListener('mouseenter', show);
      card.addEventListener('click', show);
      this.speciesGrid.appendChild(card);
    }
  }

  private showSpeciesDetail(def: AnimalDef | null): void {
    clearChildren(this.speciesDetail);
    if (!def) {
      this.speciesDetail.append(
        el('h4', {}, '🎲 You will be dealt one at random'),
        el(
          'div',
          { class: 'tagline' },
          'Nobody picks their animal, so nobody can read anything into what you are.',
        ),
        el(
          'div',
          { class: 'hint-text' },
          'One of you will be dealt the hunter role instead, on a species that could plausibly kill — but survivors get those species too, so being a caiman proves nothing either way.',
        ),
      );
      return;
    }

    this.speciesDetail.append(
      el('h4', {}, `${def.emoji} ${def.name}`),
      el('div', { class: 'tagline' }, def.tagline),
    );

    const proCon = el('div', { class: 'pro-con' });
    const pros = el('div');
    pros.append(el('div', { class: 'pro-title' }, 'Strengths'));
    const prosList = el('ul');
    for (const pro of def.pros) prosList.appendChild(el('li', {}, pro));
    pros.appendChild(prosList);

    const cons = el('div');
    cons.append(el('div', { class: 'con-title' }, 'Weaknesses'));
    const consList = el('ul');
    for (const con of def.cons) consList.appendChild(el('li', {}, con));
    cons.appendChild(consList);

    proCon.append(pros, cons);
    this.speciesDetail.appendChild(proCon);

    // Hunger rate is the stat players most need to plan around.
    const rate = def.hungerRate;
    const label = rate < 0.5 ? 'Very slow' : rate < 0.8 ? 'Slow' : rate < 1.2 ? 'Average' : 'Fast';
    this.speciesDetail.appendChild(
      el(
        'div',
        { class: 'hint-text' },
        `Hunger: ${label} (×${rate.toFixed(2)}) · ${def.canBeHunter ? 'Can be dealt the hunter role.' : 'Never the hunter.'}`,
      ),
    );
  }

  setClientId(id: string): void {
    this.myClientId = id;
  }

  /** Render the lobby from a server update. */
  update(lobby: LobbyState): void {
    this.roomCodeValue.textContent = lobby.code;
    clearChildren(this.slotGrid);

    const count = lobby.players.length;
    const slots = visibleSlots(count);
    this.isHost = false;

    for (let i = 0; i < slots; i++) {
      const player = lobby.players[i];
      if (!player) {
        /*
         * An open slot, drawn as a slot rather than as blank space.
         *
         * The staggered animation delay is what turns a row of identical
         * placeholders into something that looks like it is listening: the
         * scan runs across the empty seats instead of flashing them in unison.
         */
        const empty = el('div', { class: 'mm-slot empty' });
        empty.style.animationDelay = `${(i % 6) * 0.18}s`;
        empty.append(
          el('div', { class: 'mm-slot-avatar' }, '+'),
          el('div', { class: 'mm-slot-body' }, 'Open slot'),
          el('div', { class: 'mm-slot-dots' }, '•••'),
        );
        this.slotGrid.appendChild(empty);
        continue;
      }

      const slot = el('div', { class: 'mm-slot' });
      if (player.ready) slot.classList.add('ready');
      if (player.clientId === this.myClientId) {
        slot.classList.add('is-you');
        this.isHost = player.isHost;
      }

      const hue = playerHue(player.name);
      const avatar = el('div', { class: 'mm-slot-avatar' }, monogram(player.name));
      avatar.style.background = `linear-gradient(150deg, hsl(${hue} 62% 42%), hsl(${(hue + 40) % 360} 58% 24%))`;
      avatar.style.borderColor = `hsl(${hue} 70% 58%)`;

      const info = el('div', { class: 'mm-slot-body' });
      const nameRow = el('div', { class: 'mm-slot-name-row' });
      // Names come from other players, so they go in as text, never markup.
      nameRow.appendChild(el('div', { class: 'mm-slot-name' }, player.name));
      if (player.clientId === this.myClientId) {
        nameRow.appendChild(el('div', { class: 'mm-tag you' }, 'You'));
      }
      if (player.isHost) nameRow.appendChild(el('div', { class: 'mm-tag host' }, 'Host'));
      info.appendChild(nameRow);
      // No species line: nobody has one until the round is dealt, and the
      // moment it is dealt it becomes the most secret thing on the screen.
      info.appendChild(
        el('div', { class: 'mm-slot-state' }, player.ready ? 'Ready' : 'Waiting…'),
      );

      slot.append(avatar, info, el('div', { class: 'mm-slot-check' }, player.ready ? '✓' : ''));
      this.slotGrid.appendChild(slot);
    }

    const readyCount = lobby.players.filter((p) => p.ready).length;
    this.headCount.textContent = `${count} / ${lobby.maxPlayers}`;
    this.readyCount.textContent = `${readyCount} ready`;
    this.readyFill.style.width = `${count > 0 ? (readyCount / count) * 100 : 0}%`;
    this.searchNote.textContent =
      count >= lobby.maxPlayers
        ? 'Jungle full'
        : count > 1
          ? 'Searching for more players…'
          : 'Searching for players — AI animals will fill the rest';
    this.root.classList.toggle('is-full', count >= lobby.maxPlayers);

    this.statusLine.textContent = lobby.canStart
      ? 'One of you will be dealt the hunter — and only that player will know. Everyone else is prey, including the animals that are not people.'
      : 'Waiting for enough players to start.';

    // Only the host can start, so hide the button for everybody else rather
    // than showing them a control that does nothing.
    this.startButton.style.display = this.isHost ? '' : 'none';
    this.startButton.disabled = !lobby.canStart;

    const allReady = count > 0 && readyCount === count && lobby.canStart;
    if (allReady) this.beginCountdown();
    else this.cancelCountdown();
  }

  /** Everyone is ready: run the drop clock. */
  private beginCountdown(): void {
    if (this.countdownTimer) return;
    /*
     * Only while the lobby is the screen in front of the player.
     *
     * Starting a round broadcasts one last lobby state, in which everybody is
     * still ready — so without this check the clock would start ticking, and
     * beeping, over the top of the round that has just begun.
     */
    if (!this.root.classList.contains('active')) return;
    this.countdownLeft = AUTO_START_SECONDS;
    this.countdownBar.classList.remove('hidden');
    this.paintCountdown();
    audioSystem.playMatchReady();

    this.countdownTimer = window.setInterval(() => {
      this.countdownLeft -= 1;
      if (this.countdownLeft <= 0) {
        this.cancelCountdown();
        this.countdownBar.classList.remove('hidden');
        this.countdownNumber.textContent = 'GO';
        // Only the host actually starts the round; everybody else is watching
        // the same clock so the drop does not arrive unannounced.
        if (this.isHost) this.startRound();
        return;
      }
      this.paintCountdown();
      audioSystem.playCountdownTick(this.countdownLeft <= 1);
    }, 1000);
  }

  private paintCountdown(): void {
    this.countdownNumber.textContent = String(this.countdownLeft);
    this.countdownFill.style.width = `${(this.countdownLeft / AUTO_START_SECONDS) * 100}%`;
  }

  private cancelCountdown(): void {
    if (this.countdownTimer) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = 0;
    }
    this.countdownBar.classList.add('hidden');
  }

  private setReadyButton(ready: boolean): void {
    this.readyButton.textContent = ready ? '✓ Ready' : 'Ready';
    this.readyButton.classList.toggle('btn-primary', ready);
    this.readyButton.classList.toggle('is-ready', ready);
  }

  /**
   * Clear the ready flag — on both ends.
   *
   * The server keeps a client's ready flag across rounds, so returning to the
   * lobby with only the button reset would leave the room instantly all-ready
   * and the drop clock would fire before the player had looked at the screen.
   */
  resetReady(): void {
    this.ready = false;
    this.setReadyButton(false);
    this.cancelCountdown();
    this.setReady(false);
  }
}

// ---------------------------------------------------------------------------
// Role reveal
// ---------------------------------------------------------------------------

export class RoleScreen {
  readonly root: HTMLElement;
  private card: HTMLElement;
  private countdown: HTMLElement;

  constructor() {
    this.root = el('div', { id: 'screen-role', class: 'screen' });
    this.card = el('div', { class: 'role-card' });
    this.countdown = el('div', { class: 'role-countdown' }, '');
    this.root.appendChild(this.card);
  }

  /**
   * Show a player their own role card.
   *
   * This is the only place the hunter's identity is ever displayed, and it is
   * displayed only to the hunter. Nothing about anybody else's role reaches this
   * screen — the server never sent it.
   */
  show(card: RoleCard): void {
    clearChildren(this.card);
    const isHunter = card.role === Role.Hunter;
    this.card.classList.toggle('hunter', isHunter);

    const def = ANIMALS[card.species];
    this.card.append(
      el('div', { class: 'role-emoji' }, def.emoji),
      el('div', { class: 'role-title' }, card.title),
      el('div', { class: 'role-sub' }, card.subtitle),
    );

    const objective = el('div', { class: 'role-objective' }, card.objective);
    this.card.appendChild(objective);

    if (card.weakness) {
      const w = WEAKNESSES[card.weakness];
      const box = el('div', { class: 'role-weakness' });
      box.append(
        el('strong', {}, `${w.emoji} ${w.name}  ·  ${w.rarity}`),
        el('div', {}, w.description),
        el('em', {}, `How to play it: ${w.advice}`),
      );
      this.card.appendChild(box);
    } else if (isHunter) {
      const box = el('div', { class: 'role-weakness' });
      box.append(
        el('strong', {}, '🩸 No weakness'),
        el(
          'div',
          {},
          'You are the only animal out here without a handicap. You are also outnumbered, and you have no idea which of them are people.',
        ),
      );
      this.card.appendChild(box);
    }

    this.card.appendChild(this.countdown);
  }

  setCountdown(seconds: number): void {
    this.countdown.textContent =
      seconds > 0 ? `The jungle opens in ${Math.ceil(seconds)}…` : 'Go.';
  }
}

// ---------------------------------------------------------------------------
// Round over
// ---------------------------------------------------------------------------

export class ResultScreen {
  readonly root: HTMLElement;
  private inner: HTMLElement;

  constructor(private actions: ScreenActions) {
    this.root = el('div', { id: 'screen-result', class: 'screen' });
    this.inner = el('div', { class: 'result-inner' });
    this.root.appendChild(this.inner);
  }

  show(result: RoundResult, myClientId: string): void {
    clearChildren(this.inner);
    const headline = winnerHeadline(result.winner);
    const hunterWon = result.winner === Winner.Hunter;

    // --- Headline --------------------------------------------------------
    const head = el('div', { class: 'result-headline' });
    const title = el('div', { class: 'result-title' }, headline.title);
    if (hunterWon) title.classList.add('hunter-won');
    head.append(title, el('div', { class: 'result-sub' }, headline.subtitle));
    this.inner.appendChild(head);

    // --- The reveal ------------------------------------------------------
    const reveal = el('div', { class: 'hunter-reveal' });
    const hunterDef = ANIMALS[result.hunterSpecies];
    reveal.append(
      el('div', { class: 'label' }, '🔫 The hunter was'),
      el('div', { class: 'name' }, result.hunterName),
      el('div', { class: 'species' }, `${hunterDef.emoji} ${hunterDef.name}`),
    );
    this.inner.appendChild(reveal);

    // --- Stat columns ----------------------------------------------------
    const columns = el('div', { class: 'result-columns' });

    const hunterCard = el('div', { class: 'result-card' });
    hunterCard.append(el('h3', {}, 'Hunter'));
    hunterCard.append(
      statLine('Kills', String(result.hunterKills)),
      statLine('Missed lunges', String(result.hunterMissed)),
      statLine('Best hunt', describeKill(result.hunterBestKill)),
      statLine(
        'Accuracy',
        result.hunterKills + result.hunterMissed > 0
          ? `${Math.round((result.hunterKills / (result.hunterKills + result.hunterMissed)) * 100)}%`
          : '—',
      ),
    );

    const survivorCard = el('div', { class: 'result-card' });
    survivorCard.append(el('h3', {}, 'Survivors'));
    survivorCard.append(
      statLine('Survived', `${result.survivorsAlive}/${result.survivorsTotal}`),
      statLine('Round length', formatDuration(result.durationPlayed)),
      statLine(
        'Total whistles',
        String(result.reveals.reduce((sum, r) => sum + r.whistles, 0)),
      ),
      statLine('Meals eaten', String(result.reveals.reduce((sum, r) => sum + r.mealsEaten, 0))),
    );

    columns.append(hunterCard, survivorCard);
    this.inner.appendChild(columns);

    // --- Awards ----------------------------------------------------------
    if (result.awards.length > 0) {
      const awardsCard = el('div', { class: 'result-card' });
      awardsCard.append(el('h3', {}, '🏆 Highlights'));
      const grid = el('div', { class: 'awards-grid' });
      result.awards.forEach((award, i) => {
        const node = el('div', { class: 'award' });
        // Stagger the entrance so the list reads rather than appearing at once.
        node.style.animationDelay = `${0.5 + i * 0.07}s`;
        const text = el('div');
        text.append(
          el('div', { class: 'award-title' }, award.title),
          el('div', { class: 'award-player' }, award.playerName),
          el('div', { class: 'award-detail' }, award.detail),
        );
        node.append(el('div', { class: 'award-emoji' }, award.emoji), text);
        grid.appendChild(node);
      });
      awardsCard.appendChild(grid);
      this.inner.appendChild(awardsCard);
    }

    // --- Everyone's role, species and weakness --------------------------
    const revealCard = el('div', { class: 'result-card' });
    revealCard.style.marginTop = '20px';
    revealCard.append(el('h3', {}, 'Everybody'));
    const table = el('table', { class: 'reveal-table' });
    const thead = el('thead');
    const headRow = el('tr');
    for (const label of ['Player', 'Animal', 'Role', 'Secret weakness', 'Fate', 'Score']) {
      headRow.appendChild(el('th', {}, label));
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const r of result.reveals) {
      const row = el('tr');
      if (r.role === Role.Hunter) row.classList.add('was-hunter');
      if (!r.survived) row.classList.add('dead');

      const def = ANIMALS[r.species];
      const nameCell = el('td', {}, r.clientId === myClientId ? `${r.name} (you)` : r.name);
      const animalCell = el('td', {}, `${def.emoji} ${def.name}`);
      const roleCell = el('td', {}, r.role === Role.Hunter ? '🔫 Hunter' : '🦫 Survivor');
      const weaknessCell = el(
        'td',
        {},
        r.weakness ? `${WEAKNESSES[r.weakness].emoji} ${WEAKNESSES[r.weakness].name}` : '—',
      );
      const fateCell = el(
        'td',
        {},
        r.survived
          ? `Survived ${formatDuration(r.survivedSeconds)}`
          : r.killedBy
            ? `Killed by ${r.killedBy}`
            : 'Died',
      );
      // Sorted rows would be a leaderboard; these are in seating order and the
      // score is the last column, so the table still reads as a reveal.
      const scoreCell = el('td', { class: 'reveal-score' }, String(r.score));
      row.append(nameCell, animalCell, roleCell, weaknessCell, fateCell, scoreCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    revealCard.appendChild(table);
    this.inner.appendChild(revealCard);

    // --- Actions ---------------------------------------------------------
    const actions = el('div', { class: 'result-actions' });
    const again = el('button', { class: 'btn btn-primary' }, '↻  One more round');
    again.addEventListener('click', () => {
      audioSystem.playUiClick('confirm');
      this.actions.onPlayAgain();
    });
    const menu = el('button', { class: 'btn' }, 'Main menu');
    menu.addEventListener('click', () => {
      audioSystem.playUiClick('back');
      this.actions.onBackToMenu();
    });
    actions.append(again, menu);
    this.inner.appendChild(actions);

    // A little sting: rising if you lived, falling if you did not.
    const me = result.reveals.find((r) => r.clientId === myClientId);
    audioSystem.playRoundOver(me ? me.survived : result.winner === Winner.Survivors);
  }
}

function statLine(label: string, value: string): HTMLElement {
  const row = el('div', { class: 'stat-line' });
  row.append(el('div', {}, label), el('div', { class: 'value' }, value));
  return row;
}
