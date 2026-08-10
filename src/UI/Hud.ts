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
} from '../Systems/Config';
import type { KillFeedEntry } from '../Networking/Protocol';
import { clamp01 } from '../Systems/Noise';
import { el, formatTime } from './UiUtils';

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
  /** Set when a food source or carcass is in reach. */
  interactPrompt: string | null;
  /** False when the mouse is not captured, so the HUD can explain how to look. */
  pointerLocked: boolean;
}

export class Hud {
  readonly root: HTMLElement;

  private healthFill: HTMLElement;
  private healthText: HTMLElement;
  private hungerFill: HTMLElement;
  private hungerText: HTMLElement;
  private staminaFill: HTMLElement;
  private staminaText: HTMLElement;

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
  private eyeVignette: HTMLElement;
  private waterOverlay: HTMLElement;
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

    // --- Bottom left: health, hunger, stamina ---------------------------
    const bottomLeft = el('div', { class: 'hud-corner hud-bottom-left' });

    const health = this.buildBar('❤️', 'health');
    this.healthFill = health.fill;
    this.healthText = health.text;
    bottomLeft.appendChild(health.row);

    const hunger = this.buildBar('🍖', 'hunger');
    this.hungerFill = hunger.fill;
    this.hungerText = hunger.text;
    bottomLeft.appendChild(hunger.row);

    const stamina = this.buildBar('⚡', 'stamina');
    this.staminaFill = stamina.fill;
    this.staminaText = stamina.text;
    bottomLeft.appendChild(stamina.row);

    this.root.appendChild(bottomLeft);

    // --- Top left: timer and weather ------------------------------------
    const topLeft = el('div', { class: 'hud-corner hud-top-left' });
    this.timerEl = el('div', { class: 'round-timer' }, '10:00');
    this.roundMeta = el('div', { class: 'round-meta' }, 'Survivors 0/0');
    this.weatherEl = el('div', { class: 'weather-strip' }, '☀️ Sunny · Afternoon');
    topLeft.append(this.timerEl, this.roundMeta, this.weatherEl);
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
    this.damageVignette = el('div', { class: 'damage-vignette' });
    this.eyeVignette = el('div', { class: 'eye-vignette' });
    this.waterOverlay = el('div', { class: 'water-overlay' });
    this.debugOverlay = el('div', { class: 'debug-overlay' });
    this.toastStack = el('div', { class: 'toast-stack' });

    // Shown only while the mouse is not captured — see the look fallback in
    // InputManager. Without this the player has no way to discover that they can
    // still turn the camera by dragging.
    this.pointerHint = el('div', { class: 'pointer-hint' });
    this.pointerHint.innerHTML =
      'Move the mouse to look around · click for full mouse capture';

    this.deathOverlay = el('div', { class: 'death-overlay' });
    const deathTitle = el('div', { class: 'death-title' }, 'YOU DIED');
    this.deathSub = el('div', { class: 'death-sub' }, '');
    this.deathOverlay.append(deathTitle, this.deathSub);

    this.root.append(
      this.killFeed,
      this.eventBanner,
      this.interactPrompt,
      this.damageVignette,
      this.eyeVignette,
      this.waterOverlay,
      this.deathOverlay,
      this.debugOverlay,
      this.toastStack,
      this.pointerHint,
    );
  }

  private buildBar(icon: string, kind: string): {
    row: HTMLElement;
    fill: HTMLElement;
    text: HTMLElement;
  } {
    const row = el('div', { class: 'stat-bar' });
    const iconEl = el('div', { class: 'stat-icon' }, icon);
    const track = el('div', { class: 'stat-track' });
    const fill = el('div', { class: `stat-fill ${kind}` });
    track.appendChild(fill);
    const text = el('div', { class: 'stat-text' }, '100%');
    row.append(iconEl, track, text);
    return { row, fill, text };
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
    // --- Bars ------------------------------------------------------------
    const healthPct = clamp01(state.health / Math.max(1, state.maxHealth));
    this.healthFill.style.transform = `scaleX(${healthPct})`;
    this.healthText.textContent = `${Math.ceil(state.health)}`;
    this.healthFill.classList.toggle('low', healthPct < 0.3);

    const hungerPct = clamp01(state.hunger / 100);
    this.hungerFill.style.transform = `scaleX(${hungerPct})`;
    this.hungerText.textContent = `${Math.round(state.hunger)}%`;
    this.hungerFill.classList.toggle('low', hungerPct < 0.25);

    const staminaPct = clamp01(state.stamina / Math.max(1, state.maxStamina));
    this.staminaFill.style.transform = `scaleX(${staminaPct})`;
    this.staminaText.textContent = `${Math.round(staminaPct * 100)}%`;

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

    // --- Overlays --------------------------------------------------------
    this.waterOverlay.style.opacity = state.underwater ? '1' : '0';

    if (state.interactPrompt) {
      this.interactPrompt.classList.add('visible');
      this.interactPrompt.innerHTML = state.interactPrompt;
    } else {
      this.interactPrompt.classList.remove('visible');
    }

    this.deathOverlay.classList.toggle('visible', state.dead);
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
