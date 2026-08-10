/**
 * AudioSystem.ts — the jungle soundscape, synthesised from nothing.
 *
 * Every sound in this game is generated with the Web Audio API at runtime.
 * There are no audio files. That is partly to keep the repository asset-free,
 * but mostly because the sound design here is *gameplay*, and synthesis makes it
 * parameterisable:
 *
 *   • The whistle is the mechanic the game is named after, so it needs to be
 *     distinctive, locatable, and different enough per player to be recognised.
 *   • Footsteps have to be attenuated by real distance so that "did you hear
 *     that?" is a fair question with a physical answer.
 *   • Rain has to actually mask other sounds, because that is a tactical
 *     property the simulation already models.
 *
 * Positional sounds use PannerNodes so a player can genuinely tell which
 * direction a whistle came from.
 */

import { NoiseKind } from '../Core/Types';
import { Species, ANIMALS } from '../Animals/AnimalTypes';
import { clamp01, lerp } from '../Systems/Noise';

export interface AudioSettings {
  master: number;
  sfx: number;
  ambience: number;
  music: number;
  muted: boolean;
}

const STORAGE_KEY = 'jungle-jukebox.audio.v1';

/** Voices that persist and are modulated rather than triggered. */
interface AmbienceLayer {
  gain: GainNode;
  /** Target gain, approached smoothly. */
  target: number;
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private listenerPos = { x: 0, y: 0, z: 0 };

  private settings: AudioSettings = {
    master: 0.8,
    sfx: 1,
    ambience: 0.75,
    music: 0.55,
    muted: false,
  };

  /** Shared noise buffer, reused by rain, footsteps and water. */
  private noiseBuffer: AudioBuffer | null = null;

  private layers = new Map<string, AmbienceLayer>();
  private started = false;
  /** Sounds triggered this frame, to avoid a hundred simultaneous footsteps. */
  private budget = 0;
  private lastFrame = 0;

  constructor() {
    this.settings = loadAudioSettings(this.settings);
  }

  /**
   * Create the AudioContext.
   *
   * Must be called from a user gesture — browsers refuse to start audio
   * otherwise, which is why the main menu's PLAY button is what boots this.
   */
  async start(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    this.started = true;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.muted ? 0 : this.settings.master;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.settings.sfx;
    this.sfxBus.connect(this.master);

    this.ambienceBus = this.ctx.createGain();
    this.ambienceBus.gain.value = this.settings.ambience;
    this.ambienceBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.settings.music;
    this.musicBus.connect(this.master);

    this.noiseBuffer = this.createNoiseBuffer(2);
    this.buildAmbience();

    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get isRunning(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  // -------------------------------------------------------------------------
  // Buffers and helpers
  // -------------------------------------------------------------------------

  /** White noise, the raw material for rain, wind, footsteps and splashes. */
  private createNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Slightly brown-ish noise: less harsh than pure white, more like water.
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  /** A panner positioned in the world, for a one-shot sound. */
  private createPanner(x: number, y: number, z: number, maxDistance: number): PannerNode {
    const ctx = this.ctx!;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2.5;
    panner.maxDistance = maxDistance;
    panner.rolloffFactor = 1.15;
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
    return panner;
  }

  /** Update the listener from the camera each frame. */
  setListener(
    x: number,
    y: number,
    z: number,
    forwardX: number,
    forwardZ: number,
  ): void {
    this.listenerPos = { x, y, z };
    if (!this.ctx) return;
    const listener = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(x, t, 0.02);
      listener.positionY.setTargetAtTime(y, t, 0.02);
      listener.positionZ.setTargetAtTime(z, t, 0.02);
      listener.forwardX.setTargetAtTime(forwardX, t, 0.05);
      listener.forwardY.setTargetAtTime(0, t, 0.05);
      listener.forwardZ.setTargetAtTime(forwardZ, t, 0.05);
      listener.upX.setTargetAtTime(0, t, 0.05);
      listener.upY.setTargetAtTime(1, t, 0.05);
      listener.upZ.setTargetAtTime(0, t, 0.05);
    } else {
      // Older Safari.
      const legacy = listener as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition?.(x, y, z);
      legacy.setOrientation?.(forwardX, 0, forwardZ, 0, 1, 0);
    }
  }

  /** Reset the per-frame sound budget. */
  beginFrame(time: number): void {
    if (time - this.lastFrame > 0.05) {
      this.budget = 6;
      this.lastFrame = time;
    }
  }

  private takeBudget(): boolean {
    if (this.budget <= 0) return false;
    this.budget--;
    return true;
  }

  // -------------------------------------------------------------------------
  // Ambience
  // -------------------------------------------------------------------------

  /**
   * Build the persistent layers: rain, wind, river, insects, birds, frogs.
   * Each is a filtered noise or oscillator bank whose gain is modulated by the
   * weather and the time of day.
   */
  private buildAmbience(): void {
    const ctx = this.ctx!;
    const bus = this.ambienceBus!;

    // --- Rain: band-passed noise, brighter as it gets heavier -------------
    {
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2400;
      filter.Q.value = 0.55;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(bus);
      source.start();
      this.layers.set('rain', { gain, target: 0 });
    }

    // --- Wind: low-passed noise with a slow sweep -------------------------
    {
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.09;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 180;
      lfo.connect(lfoGain).connect(filter.frequency);
      lfo.start();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(bus);
      source.start();
      this.layers.set('wind', { gain, target: 0 });
    }

    // --- River: steady mid-band water -------------------------------------
    {
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 0.4;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(bus);
      source.start();
      this.layers.set('river', { gain, target: 0 });
    }

    // --- Insects: a high shimmer that comes alive at dusk -----------------
    {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(bus);
      // Three detuned oscillators through a resonant filter reads convincingly
      // as cicadas without any samples.
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 3100 + i * 420;
        const trem = ctx.createOscillator();
        trem.frequency.value = 11 + i * 3.5;
        const tremGain = ctx.createGain();
        tremGain.gain.value = 0.35;
        const voiceGain = ctx.createGain();
        voiceGain.gain.value = 0.012;
        trem.connect(tremGain).connect(voiceGain.gain);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 3600 + i * 500;
        filter.Q.value = 12;
        osc.connect(filter).connect(voiceGain).connect(gain);
        osc.start();
        trem.start();
      }
      this.layers.set('insects', { gain, target: 0 });
    }

    // --- Frogs: pulsing low croaks at night -------------------------------
    {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(bus);
      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 118 + i * 46;
        const pulse = ctx.createOscillator();
        pulse.type = 'square';
        pulse.frequency.value = 2.4 + i * 1.1;
        const pulseGain = ctx.createGain();
        pulseGain.gain.value = 0.5;
        const voiceGain = ctx.createGain();
        voiceGain.gain.value = 0.0;
        pulse.connect(pulseGain).connect(voiceGain.gain);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        osc.connect(filter).connect(voiceGain).connect(gain);
        osc.start();
        pulse.start();
      }
      this.layers.set('frogs', { gain, target: 0 });
    }

    // --- Tension drone: rises as the whistle deadline approaches ----------
    {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.musicBus!);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 55;
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      // A slightly detuned fifth: unsettling without being musical.
      osc2.frequency.value = 82.7;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      osc.start();
      osc2.start();
      this.layers.set('tension', { gain, target: 0 });
    }
  }

  /**
   * Modulate the ambience.
   *
   * `nearWater` and `nightFactor` come from the game state, so the soundscape
   * genuinely tracks where the player is and what time it is.
   */
  updateAmbience(params: {
    rain: number;
    wind: number;
    nearWater: number;
    nightFactor: number;
    underCanopy: number;
    /** 0..1, how overdue the player's whistle is. */
    whistleTension: number;
    dt: number;
  }): void {
    if (!this.ctx) return;
    const set = (name: string, target: number) => {
      const layer = this.layers.get(name);
      if (layer) layer.target = target;
    };

    set('rain', clamp01(params.rain) * 0.5);
    set('wind', 0.06 + clamp01(params.wind) * 0.28);
    set('river', clamp01(params.nearWater) * 0.4);
    // Insects peak at dusk and stay up all night.
    set('insects', lerp(0.1, 0.5, clamp01(params.nightFactor)) * (1 - params.rain * 0.5));
    set('frogs', clamp01(params.nightFactor) * 0.32 * (0.4 + params.nearWater * 0.6));
    set('tension', Math.pow(clamp01(params.whistleTension), 2) * 0.4);

    // Smooth every layer towards its target so nothing ever clicks.
    const t = this.ctx.currentTime;
    for (const layer of this.layers.values()) {
      layer.gain.gain.setTargetAtTime(layer.target, t, 0.35);
    }
  }

  // -------------------------------------------------------------------------
  // One-shot sounds
  // -------------------------------------------------------------------------

  /**
   * The whistle.
   *
   * A two-note rising figure on a filtered triangle wave, with the pitch keyed
   * off the whistler's id so different players sound slightly different — which
   * makes "that was a whistle over there, and it wasn't mine" a real deduction.
   */
  playWhistle(x: number, y: number, z: number, sourceId: number, isSelf: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;

    const t = ctx.currentTime;
    // Deterministic per-player variation.
    const variation = ((sourceId * 2654435761) % 1000) / 1000;
    const base = lerp(760, 1180, variation);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;

    // Rising two-tone whistle: a "phee-oo" that carries.
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 1.42, t + 0.11);
    osc.frequency.setValueAtTime(base * 1.42, t + 0.2);
    osc.frequency.linearRampToValueAtTime(base * 1.16, t + 0.42);

    const peak = isSelf ? 0.2 : 0.32;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.03);
    gain.gain.setValueAtTime(peak, t + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

    osc.connect(filter).connect(gain);
    if (isSelf) {
      // Your own whistle is not positioned — it comes from you.
      gain.connect(this.sfxBus);
    } else {
      gain.connect(this.createPanner(x, y, z, 120)).connect(this.sfxBus);
    }
    osc.start(t);
    osc.stop(t + 0.6);
  }

  /** A footstep or a splash. Short, quiet, and heavily distance-attenuated. */
  playFootstep(x: number, y: number, z: number, inWater: boolean, weight: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return;
    if (!this.takeBudget()) return;

    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    // Start at a random offset so repeated steps do not sound identical.
    const offset = Math.random() * 1.5;

    const filter = ctx.createBiquadFilter();
    if (inWater) {
      filter.type = 'bandpass';
      filter.frequency.value = 1400;
      filter.Q.value = 0.7;
    } else {
      // Heavier animals thud lower.
      filter.type = 'lowpass';
      filter.frequency.value = lerp(900, 320, clamp01(weight));
    }

    const gain = ctx.createGain();
    const peak = lerp(0.07, 0.2, clamp01(weight)) * (inWater ? 1.4 : 1);
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (inWater ? 0.22 : 0.11));

    source.connect(filter).connect(gain).connect(this.createPanner(x, y, z, 45)).connect(this.sfxBus);
    source.start(t, offset, 0.3);
  }

  /** An animal call: howler monkey, macaw, frog. */
  playAnimalCall(x: number, y: number, z: number, species: Species): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    if (!this.takeBudget()) return;

    const def = ANIMALS[species];
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    // Bigger animals call lower. One formula, every species.
    const pitch = lerp(1400, 130, clamp01(def.size / 4));

    if (species === Species.HowlerMonkey) {
      // The famous roar: a low sawtooth with heavy resonance.
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, t);
      osc.frequency.linearRampToValueAtTime(150, t + 0.5);
      osc.frequency.linearRampToValueAtTime(70, t + 1.5);
      filter.type = 'bandpass';
      filter.frequency.value = 420;
      filter.Q.value = 5;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.15);
      gain.gain.setValueAtTime(0.3, t + 1.1);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      osc.connect(filter).connect(gain);
      osc.start(t);
      osc.stop(t + 1.9);
    } else if (species === Species.Parrot) {
      // A harsh double squawk.
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(900, t);
      osc.frequency.linearRampToValueAtTime(1500, t + 0.08);
      osc.frequency.setValueAtTime(1100, t + 0.16);
      osc.frequency.linearRampToValueAtTime(1700, t + 0.26);
      filter.type = 'highpass';
      filter.frequency.value = 700;
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.setValueAtTime(0.02, t + 0.12);
      gain.gain.setValueAtTime(0.22, t + 0.16);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
      osc.connect(filter).connect(gain);
      osc.start(t);
      osc.stop(t + 0.4);
    } else if (species === Species.Frog) {
      // A short croak: pulsed square wave.
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 190;
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      gain.gain.setValueAtTime(0, t);
      for (let i = 0; i < 4; i++) {
        gain.gain.setValueAtTime(0.16, t + i * 0.07);
        gain.gain.setValueAtTime(0.01, t + i * 0.07 + 0.04);
      }
      gain.gain.linearRampToValueAtTime(0, t + 0.32);
      osc.connect(filter).connect(gain);
      osc.start(t);
      osc.stop(t + 0.35);
    } else {
      // Generic chirp/grunt, pitched by size.
      const osc = ctx.createOscillator();
      osc.type = def.size >= 3 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(pitch, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(60, pitch * 0.7), t + 0.25);
      filter.type = 'lowpass';
      filter.frequency.value = pitch * 2.4;
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(filter).connect(gain);
      osc.start(t);
      osc.stop(t + 0.35);
    }

    gain.connect(this.createPanner(x, y, z, 150)).connect(this.sfxBus);
  }

  /**
   * The flies.
   *
   * A buzzing drone that gets louder and more insistent as the swarm grows.
   * Non-positional for your own swarm — you should be able to *hear* that you
   * are in trouble even when the camera is pointed away.
   */
  private flyOsc: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

  updateFlyBuzz(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;

    if (intensity <= 0.01) {
      if (this.flyOsc) {
        this.flyOsc.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      }
      return;
    }

    if (!this.flyOsc) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 148;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 420;
      filter.Q.value = 3.5;
      // Amplitude wobble, so it sounds like insects rather than a synth.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7.5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 26;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.sfxBus);
      osc.start();
      this.flyOsc = { osc, gain, filter };
    }

    const t = ctx.currentTime;
    this.flyOsc.gain.gain.setTargetAtTime(clamp01(intensity) * 0.17, t, 0.25);
    this.flyOsc.filter.frequency.setTargetAtTime(380 + intensity * 260, t, 0.3);
  }

  /** A bite landing. Meaty, short, and unmistakable. */
  playAttack(x: number, y: number, z: number, hit: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return;
    const t = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(hit ? 1600 : 900, t);
    filter.frequency.exponentialRampToValueAtTime(160, t + 0.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(hit ? 0.42 : 0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (hit ? 0.35 : 0.16));
    source.connect(filter).connect(gain).connect(this.createPanner(x, y, z, 90)).connect(this.sfxBus);
    source.start(t, Math.random(), 0.4);

    if (hit) {
      // A low thump underneath, which is what makes a kill feel like a kill.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.28);
      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.4, t);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(oscGain).connect(this.createPanner(x, y, z, 90)).connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + 0.32);
    }
  }

  /** Eating: a soft rhythmic crunch. */
  playEat(x: number, y: number, z: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return;
    if (!this.takeBudget()) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2200;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    source.connect(filter).connect(gain).connect(this.createPanner(x, y, z, 25)).connect(this.sfxBus);
    source.start(t, Math.random(), 0.2);
  }

  /** Thunder, for storms. Distant and long. */
  playThunder(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(260, t);
    filter.frequency.exponentialRampToValueAtTime(70, t + 2.4);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.32 * intensity, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    source.connect(filter).connect(gain).connect(this.sfxBus);
    source.start(t);
    source.stop(t + 2.7);
  }

  /** UI click. */
  playUiClick(kind: 'click' | 'confirm' | 'back' = 'click'): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const gain = ctx.createGain();
    const base = kind === 'confirm' ? 620 : kind === 'back' ? 320 : 480;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(kind === 'back' ? base * 0.7 : base * 1.5, t + 0.09);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  /** A stinger for the round-over reveal. */
  playRoundOver(survived: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const t = ctx.currentTime;
    // Survivors get a rising major figure; a wipe gets a falling minor one.
    const notes = survived ? [220, 277, 330, 440] : [330, 277, 233, 165];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const gain = ctx.createGain();
      const start = t + i * 0.16;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.9);
      osc.connect(gain).connect(this.musicBus!);
      osc.start(start);
      osc.stop(start + 1);
    });
  }

  /** Dispatch a snapshot noise event to the right synth voice. */
  playNoiseEvent(kind: NoiseKind, x: number, y: number, z: number, sourceId: number): void {
    switch (kind) {
      case NoiseKind.Whistle:
        this.playWhistle(x, y, z, sourceId, false);
        break;
      case NoiseKind.Attack:
        this.playAttack(x, y, z, false);
        break;
      case NoiseKind.Death:
        this.playAttack(x, y, z, true);
        break;
      case NoiseKind.Splash:
        this.playFootstep(x, y, z, true, 0.6);
        break;
      case NoiseKind.Eat:
        this.playEat(x, y, z);
        break;
      case NoiseKind.Footstep:
        this.playFootstep(x, y, z, false, 0.5);
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  getSettings(): AudioSettings {
    return this.settings;
  }

  setVolume(bus: keyof Omit<AudioSettings, 'muted'>, value: number): void {
    this.settings = { ...this.settings, [bus]: clamp01(value) };
    this.applyVolumes();
    saveAudioSettings(this.settings);
  }

  setMuted(muted: boolean): void {
    this.settings = { ...this.settings, muted };
    this.applyVolumes();
    saveAudioSettings(this.settings);
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master?.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, t, 0.05);
    this.sfxBus?.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
    this.ambienceBus?.gain.setTargetAtTime(this.settings.ambience, t, 0.05);
    this.musicBus?.gain.setTargetAtTime(this.settings.music, t, 0.05);
  }

  /** Suspend audio when the tab is hidden, so we do not buzz in the background. */
  async setSuspended(suspended: boolean): Promise<void> {
    if (!this.ctx) return;
    if (suspended && this.ctx.state === 'running') await this.ctx.suspend();
    if (!suspended && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Listener position, for callers that need to attenuate on their own. */
  get listenerPosition(): { x: number; y: number; z: number } {
    return this.listenerPos;
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
    this.layers.clear();
    this.flyOsc = null;
  }
}

function loadAudioSettings(fallback: AudioSettings): AudioSettings {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<AudioSettings>) };
  } catch {
    return fallback;
  }
}

function saveAudioSettings(settings: AudioSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable; settings just will not persist.
  }
}

/** Shared instance. */
export const audioSystem = new AudioSystem();
