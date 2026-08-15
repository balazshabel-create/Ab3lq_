/**
 * Hud.ts — the in-round interface.
 *
 * Kept minimal because during a round the player needs to be reading the
 * *jungle*, not the UI. The one exception is the whistle widget, which is
 * deliberately loud and gets louder: missing your whistle is the single worst
 * thing that can happen to you, so the HUD escalates from a quiet countdown to
 * an amber warning to a shaking red alarm.
 *
 * All DOM, no canvas overlay — text stays crisp at any resolution scale, and
 * the whole HUD costs nothing per frame beyond a few style writes.
 */

import { ANIMALS, Species } from '../Animals/AnimalTypes';
import { Role } from '../Core/Types';
import { WEAKNESSES, type WeaknessId } from '../Gameplay/Weaknesses';
import {
  FLY_OBVIOUS_THRESHOLD,
  WHISTLE_INTERVAL,
  WHISTLE_WARN_TIME,
  ZONE_WARNING_TIME,
} from '../Systems/Config';
import type { KillFeedEntry } from '../Networking/Protocol';
import { clamp01 } from '../Systems/Noise';
import { el, formatTime } from './UiUtils';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * How much of each vitals ring is drawn, as a fraction of the full circle.
 *
 * Three quarters, leaving a quarter-circle gap at the bottom. The gap is not
 * decoration — a closed ring has no beginning, so "nearly full" and "nearly
 * empty" look alike at a glance, and the two ends of an open arc give the eye
 * the reference points it needs. The numbers sit in the gap.
 */
const VITAL_SWEEP = 0.75;

export interface HudState {
  health: number;
  maxHealth: number;
  hunger: number;
  stamina: number;
  maxStamina: number;
  /** Seconds since the last whistle. */
  sinceWhistle: number;
  flies: number;
  role: Role;
  species: Species;
  weakness: WeaknessId | null;
  /** Round time remaining, seconds. */
  timeLeft: number;
  survivorsAlive: number;
  survivorsTotal: number;
  weatherLabel: string;
  weatherEmoji: string;
  timeOfDay: string;
  abilityReady: boolean;
  listenReady: boolean;
  eating: boolean;
  dead: boolean;
  underwater: boolean;
  /**
   * The storm circle's state, or null when a round has no circle.
   *
   * `distanceOutside` is negative inside and positive in the storm, so one number
   * covers both "how much room have I got" and "how far back to safety".
   */
  zone: {
    stage: number;
    totalStages: number;
    shrinking: boolean;
    /** Seconds until the next shrink, or -1 when it is done closing. */
    untilShrink: number;
    /** Metres outside the circle. Negative means safe. */
    distanceOutside: number;
  } | null;
  /** Set when a food source or carcass is in reach. */
  interactPrompt: string | null;
  /** False when the mouse is not captured, so the HUD can explain how to look. */
  pointerLocked: boolean;
  /** True when the browser refused pointer lock outright, so the hint is honest. */
  pointerLockUnavailable: boolean;
}

export class Hud {
  readonly root: HTMLElement;

  // Assigned by buildVitalsDial(), which the constructor calls — TypeScript
  // cannot see through the helper, hence the definite-assignment marks.
  private healthText!: HTMLElement;
  private hungerText!: HTMLElement;
  private staminaText!: HTMLElement;
  private vitalGlyph!: HTMLElement;
  /** The three arc elements, with the dash length that means "full". */
  private vitalArcs = new Map<string, { node: SVGCircleElement; arc: number }>();

  private timerEl: HTMLElement;
  private roundMeta: HTMLElement;
  private weatherEl: HTMLElement;

  private whistleWidget: HTMLElement;
  private whistleTime: HTMLElement;
  private whistleLabel: HTMLElement;

  private flyWarning: HTMLElement;
  private roleBadge: HTMLElement;
  private weaknessChip: HTMLElement;

  private abilityEl: HTMLElement;
  private listenEl: HTMLElement;
  private abilityRow: HTMLElement;

  private killFeed: HTMLElement;
  private eventBanner: HTMLElement;
  private interactPrompt: HTMLElement;
  private damageVignette: HTMLElement;
  private gradeOverlay: HTMLElement;
  private eyeVignette: HTMLElement;
  private waterOverlay: HTMLElement;
  private zoneStrip: HTMLElement;
  private stormOverlay: HTMLElement;
  private deathOverlay: HTMLElement;
  private deathSub: HTMLElement;
  private debugOverlay: HTMLElement;
  private toastStack: HTMLElement;
  private pointerHint: HTMLElement;

  private damageTimer = 0;
  private eventTimer = 0;
  private killEntries: { node: HTMLElement; ttl: number }[] = [];
  private toasts: { node: HTMLElement; ttl: number }[] = [];

  constructor() {
    this.root = el('div', { id: 'screen-hud', class: 'screen' });

    /*
     * --- Bottom left: the vitals dial -------------------------------------
     *
     * Three concentric arcs around the animal you are wearing, rather than
     * three horizontal bars stacked in a corner.
     *
     * The bars were not wrong, they were *mute*. Three identical rectangles
     * differing only in colour make you read a label to know which is which,
     * and reading a label is exactly what nobody does while something with a
     * rifle is walking towards them. A ring has three properties a bar does
     * not: the arcs are different lengths so they are told apart by shape as
     * well as by hue, the whole cluster occupies one glance instead of three,
     * and there is a hole in the middle — which is where the species glyph
     * goes, so the one question a player asks most often ("what am I?") is
     * answered by the same object that answers "how am I doing?".
     */
    const bottomLeft = el('div', { class: 'hud-corner hud-bottom-left' });
    const dial = this.buildVitalsDial();
    bottomLeft.appendChild(dial);
    this.root.appendChild(bottomLeft);

    // --- Top left: timer and weather ------------------------------------
    const topLeft = el('div', { class: 'hud-corner hud-top-left' });
    this.timerEl = el('div', { class: 'round-timer' }, '15:00');
    this.roundMeta = el('div', { class: 'round-meta' }, 'Survivors 0/0');
    this.weatherEl = el('div', { class: 'weather-strip' }, '☀️ Sunny · Afternoon');
    topLeft.append(this.timerEl, this.roundMeta, this.weatherEl);

    /*
     * --- The storm circle ------------------------------------------------
     *
     * Sits under the round timer rather than in its own corner, because it is
     * the same kind of information — a clock the player has no control over —
     * and because a player checking how long is left should see both at once.
     *
     * Three states, and only three: how far the wall is while you are safe, a
     * countdown while a shrink is coming, and an unmissable warning while you
     * are actually taking damage.
     */
    this.zoneStrip = el('div', { class: 'zone-strip' });
    this.zoneStrip.style.display = 'none';
    topLeft.appendChild(this.zoneStrip);
    this.root.appendChild(topLeft);


    // --- Top right: role and weakness -----------------------------------
    const topRight = el('div', { class: 'hud-corner hud-top-right' });
    this.roleBadge = el('div', { class: 'role-badge' }, '🦫 Survivor');
    this.weaknessChip = el('div', { class: 'weakness-chip' }, '');
    this.weaknessChip.style.display = 'none';
    topRight.append(this.roleBadge, this.weaknessChip);
    this.root.appendChild(topRight);

    // --- The whistle widget ---------------------------------------------
    this.whistleWidget = el('div', { class: 'whistle-widget' });
    this.whistleLabel = el('div', { class: 'whistle-label' }, 'Whistle required in');
    this.whistleTime = el('div', { class: 'whistle-time' }, '1:00');
    const whistleKey = el('div', { class: 'whistle-key' });
    whistleKey.innerHTML = 'press <span class="key-cap">Q</span> to whistle';
    this.whistleWidget.append(this.whistleLabel, this.whistleTime, whistleKey);
    this.root.appendChild(this.whistleWidget);

    // --- Fly warning -----------------------------------------------------
    this.flyWarning = el('div', { class: 'fly-warning' });
    this.flyWarning.innerHTML =
      '🪰🪰🪰 FLIES ARE GATHERING<small>Everything can see you are not a real animal. WHISTLE.</small>';
    this.root.appendChild(this.flyWarning);

    // --- Bottom right: abilities ----------------------------------------
    const bottomRight = el('div', { class: 'hud-corner hud-bottom-right' });
    this.abilityRow = el('div', { class: 'ability-row' });
    this.abilityEl = this.buildAbility('✨', 'X');
    this.listenEl = this.buildAbility('👂', 'G');
    this.abilityRow.append(this.abilityEl, this.listenEl);
    bottomRight.appendChild(this.abilityRow);
    this.root.appendChild(bottomRight);

    // --- Overlays --------------------------------------------------------
    this.killFeed = el('div', { class: 'kill-feed' });
    this.eventBanner = el('div', { class: 'event-banner' });
    this.interactPrompt = el('div', { class: 'interact-prompt' });
    // A permanent, subtle colour grade. Sits under every other overlay.
    this.gradeOverlay = el('div', { class: 'grade-overlay' });
    this.damageVignette = el('div', { class: 'damage-vignette' });
    this.eyeVignette = el('div', { class: 'eye-vignette' });
    this.waterOverlay = el('div', { class: 'water-overlay' });
    this.stormOverlay = el('div', { class: 'storm-overlay' });
    this.debugOverlay = el('div', { class: 'debug-overlay' });
    this.toastStack = el('div', { class: 'toast-stack' });

    // Shown only while the mouse is not captured — see the look fallback in
    // InputManager. Without this the player has no way to discover that they can
    // still turn the camera by dragging.
    this.pointerHint = el('div', { class: 'pointer-hint' });

    this.deathOverlay = el('div', { class: 'death-overlay' });
    const deathTitle = el('div', { class: 'death-title' }, 'YOU DIED');
    this.deathSub = el('div', { class: 'death-sub' }, '');
    this.deathOverlay.append(deathTitle, this.deathSub);

    this.root.append(
      this.gradeOverlay,
      this.killFeed,
      this.eventBanner,
      this.interactPrompt,
      this.damageVignette,
      this.eyeVignette,
      this.waterOverlay,
      this.stormOverlay,
      this.deathOverlay,
      this.debugOverlay,
      this.toastStack,
      this.pointerHint,
    );
  }

  /**
   * Build the vitals dial: three concentric SVG arcs and a glyph in the hole.
   *
   * Each arc is a full circle whose dash pattern draws only three quarters of
   * it, leaving a gap at the bottom, and the *filled* portion is then set by
   * moving the dash offset. That is the whole mechanism — one number per arc
   * per frame, no path rebuilding, and the browser interpolates the change for
   * free through a CSS transition on stroke-dashoffset.
   */
  private buildVitalsDial(): HTMLElement {
    const wrap = el('div', { class: 'vitals' });
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'vitals-svg');

    // Outer to inner: health, food, breath. Health is outermost because it is
    // the one you must never have to look for.
    const rings: { kind: string; radius: number; width: number }[] = [
      { kind: 'health', radius: 43, width: 7.5 },
      { kind: 'hunger', radius: 33, width: 6.5 },
      { kind: 'stamina', radius: 24, width: 5.5 },
    ];

    for (const ring of rings) {
      const circumference = 2 * Math.PI * ring.radius;
      const arc = circumference * VITAL_SWEEP;
      for (const role of ['track', 'fill'] as const) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', '50');
        circle.setAttribute('cy', '50');
        circle.setAttribute('r', String(ring.radius));
        circle.setAttribute('stroke-width', String(ring.width));
        circle.setAttribute('stroke-linecap', 'round');
        /*
         * The gap sits at the bottom, so the two ends frame the readout below.
         *
         * 45°, not 135°. An SVG <circle> is traced anticlockwise on screen from
         * three o'clock, so the undrawn quarter starts out centred on half past
         * four; a quarter turn brings it to six. (135° is the answer for a path
         * traced the other way, and it put the gap out on the left.)
         */
        circle.setAttribute('transform', 'rotate(45 50 50)');
        circle.setAttribute('stroke-dasharray', `${arc} ${circumference - arc}`);
        circle.setAttribute(
          'class',
          role === 'track' ? 'vital-track' : `vital-fill ${ring.kind}`,
        );
        svg.appendChild(circle);
        if (role === 'fill') {
          this.vitalArcs.set(ring.kind, { node: circle, arc });
        }
      }
    }

    wrap.appendChild(svg);

    const core = el('div', { class: 'vitals-core' });
    this.vitalGlyph = el('div', { class: 'vitals-glyph' }, '🐾');
    this.healthText = el('div', { class: 'vitals-health' }, '100');
    core.append(this.vitalGlyph, this.healthText);
    wrap.appendChild(core);

    // The two secondary numbers live under the gap in the arcs, which is what
    // the gap is for.
    const readout = el('div', { class: 'vitals-readout' });
    this.hungerText = el('div', { class: 'vitals-stat hunger' }, '100');
    this.staminaText = el('div', { class: 'vitals-stat stamina' }, '100');
    // A dot in each arc's own colour, so the two numbers are attributable
    // without a legend and without reading a word.
    readout.append(
      el('span', { class: 'vitals-dot hunger' }),
      this.hungerText,
      el('span', { class: 'vitals-dot stamina' }),
      this.staminaText,
    );
    wrap.appendChild(readout);

    return wrap;
  }

  /** Drive one arc from a 0..1 fraction. */
  private setArc(kind: string, fraction: number, low: boolean): void {
    const ring = this.vitalArcs.get(kind);
    if (!ring) return;
    ring.node.style.strokeDashoffset = String(ring.arc * (1 - clamp01(fraction)));
    ring.node.classList.toggle('low', low);
  }

  private buildAbility(icon: string, key: string): HTMLElement {
    const node = el('div', { class: 'ability' });
    node.append(
      el('div', { class: 'ability-icon' }, icon),
      el('div', { class: 'ability-key' }, key),
    );
    return node;
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  update(state: HudState, dt: number): void {
    // --- Vitals ----------------------------------------------------------
    const healthPct = clamp01(state.health / Math.max(1, state.maxHealth));
    this.setArc('health', healthPct, healthPct < 0.3);
    this.healthText.textContent = `${Math.ceil(state.health)}`;
    this.healthText.classList.toggle('low', healthPct < 0.3);

    const hungerPct = clamp01(state.hunger / 100);
    this.setArc('hunger', hungerPct, hungerPct < 0.25);
    this.hungerText.textContent = `${Math.round(state.hunger)}`;

    const staminaPct = clamp01(state.stamina / Math.max(1, state.maxStamina));
    this.setArc('stamina', staminaPct, staminaPct < 0.2);
    this.staminaText.textContent = `${Math.round(staminaPct * 100)}`;

    // --- Timer -----------------------------------------------------------
    this.timerEl.textContent = formatTime(state.timeLeft);
    this.timerEl.classList.toggle('urgent', state.timeLeft <= 30);
    this.roundMeta.textContent = `Survivors ${state.survivorsAlive}/${state.survivorsTotal}`;
    this.weatherEl.textContent = `${state.weatherEmoji} ${state.weatherLabel} · ${state.timeOfDay}`;

    // --- Whistle ---------------------------------------------------------
    this.updateWhistle(state);

    // --- Role ------------------------------------------------------------
    const def = ANIMALS[state.species];
    const isHunter = state.role === Role.Hunter;
    this.roleBadge.textContent = isHunter
      ? `${def.emoji} HUNTER · ${def.name}`
      : `${def.emoji} ${def.name}`;
    // The hole in the middle of the dial answers "what am I?".
    if (this.vitalGlyph.textContent !== def.emoji) this.vitalGlyph.textContent = def.emoji;
    this.vitalGlyph.classList.toggle('hunter', isHunter);
    this.roleBadge.classList.toggle('hunter', isHunter);

    if (state.weakness) {
      const w = WEAKNESSES[state.weakness];
      this.weaknessChip.style.display = '';
      this.weaknessChip.textContent = `${w.emoji} ${w.name} — ${w.description}`;
    } else {
      this.weaknessChip.style.display = 'none';
    }

    // --- Abilities -------------------------------------------------------
    this.abilityEl.style.display = def.ability ? '' : 'none';
    this.abilityEl.classList.toggle('ready', state.abilityReady);
    this.abilityEl.classList.toggle('cooling', !state.abilityReady);
    // "Listen" is a hunter tool; showing it to survivors would leak the role.
    this.listenEl.style.display = isHunter ? '' : 'none';
    this.listenEl.classList.toggle('ready', state.listenReady);
    this.listenEl.classList.toggle('cooling', !state.listenReady);

    // --- The storm circle ------------------------------------------------
    this.updateZone(state);

    // --- Overlays --------------------------------------------------------
    this.waterOverlay.style.opacity = state.underwater ? '1' : '0';

    if (state.interactPrompt) {
      this.interactPrompt.classList.add('visible');
      this.interactPrompt.innerHTML = state.interactPrompt;
    } else {
      this.interactPrompt.classList.remove('visible');
    }

    this.deathOverlay.classList.toggle('visible', state.dead);
    /*
     * Only claim the click will help if it actually can. Inside an iframe that
     * was not granted the pointer-lock permission it never will, and telling the
     * player to click repeatedly would be a lie.
     */
    const hint = state.pointerLockUnavailable
      ? 'Mouse capture is blocked here, so the cursor can leave the window — open the game in its own tab to lock it'
      : 'Click to capture the mouse — that also keeps the cursor on this monitor';
    if (this.pointerHint.textContent !== hint) this.pointerHint.textContent = hint;
    this.pointerHint.classList.toggle('visible', !state.pointerLocked && !state.dead);

    // --- Timers ----------------------------------------------------------
    if (this.damageTimer > 0) {
      this.damageTimer -= dt;
      this.damageVignette.style.opacity = String(clamp01(this.damageTimer / 0.8) * 0.9);
    } else {
      this.damageVignette.style.opacity = '0';
    }

    if (this.eventTimer > 0) {
      this.eventTimer -= dt;
      if (this.eventTimer <= 0) this.eventBanner.classList.remove('visible');
    }

    this.tickKillFeed(dt);
    this.tickToasts(dt);
  }

  /**
   * The whistle widget's escalation.
   *
   * Three states, and the transition between them is what teaches the mechanic
   * without a tutorial: a calm countdown, an amber nudge, then a red alarm with
   * the fly warning behind it.
   */
  /**
   * The storm strip, and the red screen edge when you are out in it.
   *
   * Three states in priority order, because they answer different questions and
   * only one of them is ever urgent:
   *
   *  1. **In the storm.** Nothing else matters. Show which way is out and how
   *     far, in metres, updated live. A player taking 12 %/s does not need to
   *     know which shrink they are on.
   *  2. **A shrink is coming.** A countdown, going amber inside the warning
   *     window, so the decision to move happens before the wall does.
   *  3. **Safe and holding.** The quietest line: which ring, and how much room.
   */
  private updateZone(state: HudState): void {
    const zone = state.zone;
    if (!zone) {
      this.zoneStrip.style.display = 'none';
      this.stormOverlay.style.opacity = '0';
      return;
    }
    this.zoneStrip.style.display = '';

    const outside = zone.distanceOutside > 0;
    // Ramp the screen edge over the first forty metres, so walking into the
    // storm looks progressively worse rather than switching on at the boundary.
    this.stormOverlay.style.opacity = outside
      ? String(Math.min(1, 0.35 + zone.distanceOutside / 40))
      : '0';

    this.zoneStrip.classList.toggle('danger', outside);
    this.zoneStrip.classList.toggle(
      'warning',
      !outside && !zone.shrinking && zone.untilShrink >= 0 && zone.untilShrink <= ZONE_WARNING_TIME,
    );

    if (outside) {
      this.zoneStrip.textContent = `🌪 IN THE STORM · ${Math.round(zone.distanceOutside)} m to safety`;
      return;
    }
    if (zone.shrinking) {
      this.zoneStrip.textContent = '🌪 THE STORM IS CLOSING IN';
      return;
    }
    if (zone.untilShrink < 0) {
      this.zoneStrip.textContent = '🌪 Final circle · nowhere left to run';
      return;
    }
    const room = Math.round(-zone.distanceOutside);
    this.zoneStrip.textContent =
      `🌪 Circle ${zone.stage + 1}/${zone.totalStages + 1} closes in ${formatTime(zone.untilShrink)} · ${room} m of room`;
  }

  private updateWhistle(state: HudState): void {
    const required = state.role === Role.Survivor && !state.dead;
    this.whistleWidget.style.display = required ? '' : 'none';
    if (!required) {
      this.flyWarning.classList.remove('visible');
      return;
    }

    const remaining = WHISTLE_INTERVAL - state.sinceWhistle;
    this.whistleWidget.classList.toggle('warn', remaining <= WHISTLE_WARN_TIME && remaining > 0);
    this.whistleWidget.classList.toggle('overdue', remaining <= 0);

    if (remaining > 0) {
      this.whistleLabel.textContent =
        remaining <= WHISTLE_WARN_TIME ? '⚠️ Whistle soon' : 'Whistle required in';
      this.whistleTime.textContent = formatTime(remaining);
    } else {
      this.whistleLabel.textContent = '🪰 Flies are coming';
      // Count *up* once overdue, so the player can see how deep the hole is.
      this.whistleTime.textContent = `+${formatTime(-remaining)}`;
    }

    // The full-screen warning only appears once the swarm is genuinely visible
    // to other players — before that, the player still has time to fix it
    // quietly, and screaming at them would remove that decision.
    this.flyWarning.classList.toggle('visible', state.flies >= FLY_OBVIOUS_THRESHOLD);
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /** Flash the damage vignette. */
  showDamage(): void {
    this.damageTimer = 0.8;
  }

  /** Announce a random event. */
  showEvent(emoji: string, title: string, detail: string): void {
    this.eventBanner.innerHTML = '';
    this.eventBanner.append(
      el('div', { class: 'event-title' }, `${emoji} ${title}`),
      el('div', { class: 'event-detail' }, detail),
    );
    this.eventBanner.classList.add('visible');
    this.eventTimer = 6;
  }

  /**
   * Add a kill-feed entry.
   *
   * Phrased by species, never by name: "A capybara has been killed" tells
   * everyone that one of the players was a capybara and is now dead, which is
   * information the whole lobby should share. Naming the victim or the killer
   * would collapse the deduction.
   */
  addKill(entry: KillFeedEntry): void {
    const def = ANIMALS[entry.victimSpecies];
    let text: string;
    switch (entry.cause) {
      case 'hunter':
        text = `${def.emoji} A ${def.name.toLowerCase()} was taken by something.`;
        break;
      case 'predator':
        text = `${def.emoji} A ${def.name.toLowerCase()} was killed by a predator.`;
        break;
      case 'starvation':
        text = `${def.emoji} A ${def.name.toLowerCase()} starved.`;
        break;
      default:
        text = `${def.emoji} A ${def.name.toLowerCase()} is gone.`;
        break;
    }
    // Proximity framing: if it happened right next to you, you know it.
    if (entry.distance < 45) text += ' It was close.';

    const node = el('div', { class: 'kill-entry' }, text);
    this.killFeed.appendChild(node);
    this.killEntries.push({ node, ttl: 8 });
    // Keep the feed short.
    while (this.killEntries.length > 5) {
      const oldest = this.killEntries.shift();
      oldest?.node.remove();
    }
  }

  private tickKillFeed(dt: number): void {
    for (let i = this.killEntries.length - 1; i >= 0; i--) {
      const entry = this.killEntries[i];
      entry.ttl -= dt;
      if (entry.ttl <= 0.5) entry.node.classList.add('fading');
      if (entry.ttl <= 0) {
        entry.node.remove();
        this.killEntries.splice(i, 1);
      }
    }
  }

  /** A transient message (connection status, hints, errors). */
  toast(message: string, isError = false, seconds = 4): void {
    const node = el('div', { class: isError ? 'toast error' : 'toast' }, message);
    this.toastStack.appendChild(node);
    this.toasts.push({ node, ttl: seconds });
    while (this.toasts.length > 4) {
      const oldest = this.toasts.shift();
      oldest?.node.remove();
    }
  }

  private tickToasts(dt: number): void {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const toast = this.toasts[i];
      toast.ttl -= dt;
      if (toast.ttl <= 0) {
        toast.node.remove();
        this.toasts.splice(i, 1);
      }
    }
  }

  /** Show the death overlay with a cause. */
  setDeathReason(reason: string): void {
    this.deathSub.textContent = reason;
  }

  /** Strength of the Bad Eye vignette, 0..1. */
  setEyeImpairment(amount: number): void {
    this.eyeVignette.style.opacity = String(clamp01(amount));
  }

  setDebug(visible: boolean, text: string): void {
    this.debugOverlay.classList.toggle('visible', visible);
    if (visible) this.debugOverlay.textContent = text;
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('active', visible);
  }

  /** Clear round-scoped UI when a new round begins. */
  reset(): void {
    for (const entry of this.killEntries) entry.node.remove();
    this.killEntries.length = 0;
    this.eventBanner.classList.remove('visible');
    this.flyWarning.classList.remove('visible');
    this.deathOverlay.classList.remove('visible');
    this.damageTimer = 0;
    this.eventTimer = 0;
  }
}
