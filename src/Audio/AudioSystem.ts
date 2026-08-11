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

/** The distant one-shot calls the ambience director can fire. */
type DistantCall =
  | 'macaw'
  | 'howler'
  | 'toucan'
  | 'whoop'
  | 'nightbird'
  | 'frog'
  | 'owl'
  | 'insect'
  | 'chirp';

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
  /** Input to the shared reverb. */
  private reverbSend: GainNode | null = null;
  /** Timer that scatters distant animal calls through the jungle. */
  private directorTimer: ReturnType<typeof setTimeout> | null = null;
  /** 0..1 night factor, kept so the director can pick the right call pool. */
  private nightFactor = 0;
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
    this.buildReverb();
    this.buildAmbience();
    this.startAmbienceDirector();

    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get isRunning(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  // -------------------------------------------------------------------------
  // Buffers and helpers
  // -------------------------------------------------------------------------

  /**
   * A small algorithmic reverb.
   *
   * This is the single biggest improvement to how the game sounds. Dry
   * synthesised one-shots read as beeps in a vacuum; the same whistle through a
   * few hundred milliseconds of diffuse tail reads as a whistle *in a forest*.
   * Built from three prime-length delay lines with a damping lowpass in the
   * feedback path — a Schroeder-style tail. No impulse response file needed,
   * which keeps the project asset-free.
   */
  private buildReverb(): void {
    const ctx = this.ctx!;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;

    const wet = ctx.createGain();
    wet.gain.value = 0.34;
    wet.connect(this.master!);

    // Pre-delay: nothing in a forest reflects instantly.
    const preDelay = ctx.createDelay(0.2);
    preDelay.delayTime.value = 0.022;
    this.reverbSend.connect(preDelay);

    // Prime-ish delay times avoid the comb resonances that make short reverbs
    // sound metallic.
    for (const time of [0.0371, 0.0537, 0.0731]) {
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = time;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.72;
      const damping = ctx.createBiquadFilter();
      damping.type = 'lowpass';
      // Foliage absorbs high frequencies, so the tail darkens as it decays.
      damping.frequency.value = 2600;

      preDelay.connect(delay);
      delay.connect(damping);
      damping.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
    }
  }

  /** Route a node into the reverb at the given wet amount. */
  private sendToReverb(node: AudioNode, amount: number): void {
    if (!this.reverbSend || amount <= 0) return;
    const send = this.ctx!.createGain();
    send.gain.value = amount;
    node.connect(send);
    send.connect(this.reverbSend);
  }

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

    /*
     * --- Insects: a soft night-time bed -----------------------------------
     *
     * Filtered noise, not oscillators. The first version used three sawtooth
     * oscillators around 3.1–3.9 kHz through bandpass filters at Q 12, which is a
     * recipe for a *tone*, not for insects: a resonant filter that narrow rings at
     * its centre frequency, so what came out was a steady electronic whine sitting
     * right in the ear's most sensitive band. It was also never off — the daytime
     * floor was 0.1 — so it whined continuously for the whole round, which is
     * exactly the "annoying little whistling" a player would ask to have removed.
     *
     * Real cicadas are broadband: a rasp, not a pitch. Two wide bandpasses on the
     * shared noise buffer, gently wobbled by a slow LFO, give the rasp with no
     * ringing, and the level is a third of what it was. Combined with removing the
     * daytime floor (see updateAmbience), daylight is now genuinely quiet and the
     * insects arrive at dusk, which is also when they should.
     */
    {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(bus);
      for (let i = 0; i < 2; i++) {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 2400 + i * 1500;
        // Q around 1 is a broad band. This is the number that mattered most: at
        // 12 it is a resonator, at 1 it is a texture.
        filter.Q.value = 1.1;

        // A gentle, slow swell rather than an 11 Hz tremolo. Fast amplitude
        // modulation on a narrow band is what made the old version buzz.
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.16 + i * 0.09;
        const lfoDepth = ctx.createGain();
        lfoDepth.gain.value = 0.3;
        const voiceGain = ctx.createGain();
        voiceGain.gain.value = 0.5;
        lfo.connect(lfoDepth).connect(voiceGain.gain);

        source.connect(filter).connect(voiceGain).connect(gain);
        source.start();
        lfo.start();
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
    /**
     * 0..1 exposure to the storm wall: 0 well inside the circle, 1 out in it.
     *
     * Folded into rain, wind and the tension drone rather than given a layer of
     * its own. A squall a hundred metres away genuinely *is* more rain and more
     * wind, so reusing those layers is both correct and free — and it means the
     * storm crossfades with the weather instead of stacking a second downpour on
     * top of an existing one.
     */
    storm: number;
    dt: number;
  }): void {
    if (!this.ctx) return;
    const set = (name: string, target: number) => {
      const layer = this.layers.get(name);
      if (layer) layer.target = target;
    };

    const storm = clamp01(params.storm);
    set('rain', Math.max(clamp01(params.rain), storm * 1.15) * 0.5);
    set('wind', 0.06 + Math.max(clamp01(params.wind), storm) * 0.34);
    set('river', clamp01(params.nearWater) * 0.4 * (1 - storm * 0.6));
    /*
     * Insects arrive at dusk and stay up all night — and stop dead in the storm,
     * which is the cue that tells you you have crossed the line even if you are
     * looking the wrong way.
     *
     * The daytime end of this ramp is now zero, not 0.1. A floor of 0.1 meant the
     * layer was audible every second of every round, and a continuous background
     * layer nobody can turn off has to be *much* better than merely acceptable.
     * Silence in the afternoon also gives the dusk arrival somewhere to arrive
     * from, which the ambience director's distant calls now carry on their own.
     */
    set('insects', lerp(0, 0.34, clamp01(params.nightFactor)) * (1 - params.rain * 0.5) * (1 - storm));
    set('frogs', clamp01(params.nightFactor) * 0.32 * (0.4 + params.nearWater * 0.6) * (1 - storm));
    set('tension', Math.max(Math.pow(clamp01(params.whistleTension), 2), storm * 0.8) * 0.4);

    // The director needs to know the time of day to pick its call pool.
    this.nightFactor = clamp01(params.nightFactor);

    // Smooth every layer towards its target so nothing ever clicks.
    const t = this.ctx.currentTime;
    for (const layer of this.layers.values()) {
      layer.gain.gain.setTargetAtTime(layer.target, t, 0.35);
    }
  }

  // -------------------------------------------------------------------------
  // The ambience director
  // -------------------------------------------------------------------------

  /**
   * Scatter distant animal calls through the jungle.
   *
   * The continuous layers (rain, insects, river) give the jungle a *floor*, but
   * they are static, and a static bed stops registering after a minute. What
   * makes a rainforest recording unmistakable is the irregular punctuation: a
   * macaw screech somewhere off to the left, a howler troop starting up half a
   * kilometre away, a single frog, then nothing for eight seconds.
   *
   * So a self-rescheduling timer fires one-shot calls at random intervals, from
   * random directions and distances, with the pool changing between day and
   * night. The calls are pushed hard into the reverb and low-passed, which is
   * what places them far away rather than next to your head.
   */
  private startAmbienceDirector(): void {
    const schedule = () => {
      // Irregular gaps: a metronome would be worse than silence.
      const delay = 1600 + Math.random() * 5200;
      this.directorTimer = setTimeout(() => {
        this.playDistantCall();
        schedule();
      }, delay);
    };
    schedule();
  }

  /** One distant, reverberant call from somewhere out in the trees. */
  private playDistantCall(): void {
    const ctx = this.ctx;
    if (!ctx || !this.ambienceBus) return;
    if (ctx.state !== 'running') return;

    const night = clamp01(this.nightFactor);
    // Day is birds and monkeys; night is frogs, insects and the odd owl-like
    // whoop. Crossfading the pools by the night factor means dusk has both.
    const dayCalls: DistantCall[] = ['macaw', 'howler', 'whoop', 'chirp', 'toucan'];
    const nightCalls: DistantCall[] = ['frog', 'owl', 'insect', 'whoop', 'nightbird'];
    const pool = Math.random() < night ? nightCalls : dayCalls;
    const kind = pool[Math.floor(Math.random() * pool.length)];

    // Place it somewhere in the middle distance around the listener.
    const angle = Math.random() * Math.PI * 2;
    const distance = 28 + Math.random() * 70;
    const x = this.listenerPos.x + Math.cos(angle) * distance;
    const z = this.listenerPos.z + Math.sin(angle) * distance;
    const y = this.listenerPos.y + Math.random() * 12;

    const t = ctx.currentTime;
    const out = ctx.createGain();
    // Distance rolloff, applied on top of the panner's own.
    out.gain.value = 0.5 * (1 - (distance - 28) / 110);

    // Air and foliage swallow the top end over distance.
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 5200 - distance * 34;

    const voice = ctx.createGain();
    voice.connect(air).connect(out);

    switch (kind) {
      case 'macaw': {
        // Harsh descending double squawk.
        for (let i = 0; i < 2; i++) {
          const start = t + i * 0.19;
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(1250, start);
          osc.frequency.exponentialRampToValueAtTime(760, start + 0.16);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(0.3, start + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, start + 0.17);
          osc.connect(g).connect(voice);
          osc.start(start);
          osc.stop(start + 0.2);
        }
        break;
      }
      case 'howler': {
        // The signature roar: a long, low, resonant swell.
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(78, t);
        osc.frequency.linearRampToValueAtTime(124, t + 0.7);
        osc.frequency.linearRampToValueAtTime(64, t + 2.2);
        const formant = ctx.createBiquadFilter();
        formant.type = 'bandpass';
        formant.frequency.value = 360;
        formant.Q.value = 4.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.4, t + 0.35);
        g.gain.setValueAtTime(0.4, t + 1.5);
        g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
        osc.connect(formant).connect(g).connect(voice);
        osc.start(t);
        osc.stop(t + 2.5);
        break;
      }
      case 'toucan': {
        // A dry, repeated croak-yelp.
        for (let i = 0; i < 4; i++) {
          const start = t + i * 0.14;
          const osc = ctx.createOscillator();
          osc.type = 'square';
          osc.frequency.value = 520 + i * 18;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.16, start);
          g.gain.exponentialRampToValueAtTime(0.001, start + 0.09);
          osc.connect(g).connect(voice);
          osc.start(start);
          osc.stop(start + 0.1);
        }
        break;
      }
      case 'whoop': {
        // A rising hoot, the most "deep jungle" sound there is.
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(520, t + 0.22);
        osc.frequency.exponentialRampToValueAtTime(430, t + 0.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.3, t + 0.06);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        osc.connect(g).connect(voice);
        osc.start(t);
        osc.stop(t + 0.6);
        break;
      }
      case 'nightbird': {
        // Two plaintive descending notes.
        for (let i = 0; i < 2; i++) {
          const start = t + i * 0.42;
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(880 - i * 90, start);
          osc.frequency.exponentialRampToValueAtTime(690 - i * 90, start + 0.3);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(0.2, start + 0.05);
          g.gain.exponentialRampToValueAtTime(0.001, start + 0.34);
          osc.connect(g).connect(voice);
          osc.start(start);
          osc.stop(start + 0.36);
        }
        break;
      }
      case 'frog': {
        // A pulsed croak.
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 165;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 620;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        for (let i = 0; i < 5; i++) {
          g.gain.setValueAtTime(0.22, t + i * 0.075);
          g.gain.setValueAtTime(0.01, t + i * 0.075 + 0.042);
        }
        g.gain.linearRampToValueAtTime(0, t + 0.42);
        osc.connect(lp).connect(g).connect(voice);
        osc.start(t);
        osc.stop(t + 0.45);
        break;
      }
      case 'owl':
      case 'insect':
      default: {
        // A short high trill — cicada or tree frog, depending on your ear.
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = kind === 'owl' ? 420 : 2700;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = kind === 'owl' ? 480 : 3000;
        bp.Q.value = 8;
        const trem = ctx.createOscillator();
        trem.frequency.value = kind === 'owl' ? 5 : 24;
        const tremGain = ctx.createGain();
        tremGain.gain.value = 0.1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(kind === 'owl' ? 0.22 : 0.12, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'owl' ? 0.7 : 1.1));
        trem.connect(tremGain).connect(g.gain);
        trem.start(t);
        trem.stop(t + 1.2);
        osc.connect(bp).connect(g).connect(voice);
        osc.start(t);
        osc.stop(t + 1.2);
        break;
      }
    }

    // Heavy reverb is what sells "far away in the trees".
    this.sendToReverb(out, 0.85);
    out.connect(this.createPanner(x, y, z, 260)).connect(this.ambienceBus);
  }

  // -------------------------------------------------------------------------
  // One-shot sounds
  // -------------------------------------------------------------------------

  /**
   * The whistle — the signature sound of the game, so it gets real attention.
   *
   * The shape is the two-finger "come here" whistle: a fast upward swoop, a held
   * note with vibrato, then a clean drop. Four things make it read as a whistle
   * rather than a beep:
   *
   *   • a *sine* fundamental, because a whistle is nearly a pure tone;
   *   • a quiet second harmonic, for the edge a real whistle has;
   *   • vibrato on the sustain — a held human note is never perfectly steady;
   *   • a breath transient at the attack, and a reverb tail so it sounds like it
   *     is carrying across a valley.
   *
   * The base pitch is derived from the whistler's id, so players are
   * distinguishable by ear. "That whistle was not mine, and it came from over
   * there" is a genuine deduction, so it has to be audible in the sound itself.
   */
  playWhistle(x: number, y: number, z: number, sourceId: number, isSelf: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;

    const t = ctx.currentTime;
    // Deterministic per-player variation.
    const variation = ((sourceId * 2654435761) % 1000) / 1000;
    const base = lerp(900, 1500, variation);

    // --- Envelope timings --------------------------------------------------
    const swoopEnd = t + 0.075;
    const holdEnd = swoopEnd + 0.26;
    const dropEnd = holdEnd + 0.13;

    const out = ctx.createGain();
    out.gain.value = 1;

    // --- Fundamental -------------------------------------------------------
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // Swoop up from a fifth below, hold, then drop away.
    osc.frequency.setValueAtTime(base * 0.62, t);
    osc.frequency.exponentialRampToValueAtTime(base, swoopEnd);
    osc.frequency.setValueAtTime(base, holdEnd);
    osc.frequency.exponentialRampToValueAtTime(base * 0.72, dropEnd);

    // Vibrato, fading in over the sustain so the attack stays crisp.
    const vibrato = ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 5.6;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.setValueAtTime(0, t);
    vibratoDepth.gain.linearRampToValueAtTime(base * 0.022, swoopEnd + 0.08);
    vibratoDepth.gain.linearRampToValueAtTime(0, dropEnd);
    vibrato.connect(vibratoDepth).connect(osc.frequency);
    vibrato.start(t);
    vibrato.stop(dropEnd + 0.1);

    const oscGain = ctx.createGain();
    const peak = isSelf ? 0.26 : 0.34;
    oscGain.gain.setValueAtTime(0, t);
    oscGain.gain.linearRampToValueAtTime(peak, t + 0.022);
    oscGain.gain.setValueAtTime(peak, holdEnd);
    oscGain.gain.exponentialRampToValueAtTime(0.0008, dropEnd + 0.08);
    osc.connect(oscGain).connect(out);
    osc.start(t);
    osc.stop(dropEnd + 0.12);

    // --- Second harmonic, for brightness ----------------------------------
    const harmonic = ctx.createOscillator();
    harmonic.type = 'sine';
    harmonic.frequency.setValueAtTime(base * 1.24, t);
    harmonic.frequency.exponentialRampToValueAtTime(base * 2, swoopEnd);
    harmonic.frequency.setValueAtTime(base * 2, holdEnd);
    harmonic.frequency.exponentialRampToValueAtTime(base * 1.44, dropEnd);
    const harmonicGain = ctx.createGain();
    harmonicGain.gain.setValueAtTime(0, t);
    harmonicGain.gain.linearRampToValueAtTime(peak * 0.16, t + 0.03);
    harmonicGain.gain.exponentialRampToValueAtTime(0.0005, dropEnd);
    harmonic.connect(harmonicGain).connect(out);
    harmonic.start(t);
    harmonic.stop(dropEnd + 0.05);

    // --- Breath transient --------------------------------------------------
    if (this.noiseBuffer) {
      const breath = ctx.createBufferSource();
      breath.buffer = this.noiseBuffer;
      const breathFilter = ctx.createBiquadFilter();
      breathFilter.type = 'bandpass';
      breathFilter.frequency.value = base * 1.4;
      breathFilter.Q.value = 1.4;
      const breathGain = ctx.createGain();
      breathGain.gain.setValueAtTime(peak * 0.5, t);
      breathGain.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
      breath.connect(breathFilter).connect(breathGain).connect(out);
      breath.start(t, Math.random(), 0.12);
    }

    // --- Routing -----------------------------------------------------------
    // A whistle is meant to carry, so it gets the most reverb of anything.
    this.sendToReverb(out, isSelf ? 0.45 : 0.6);
    if (isSelf) {
      // Your own whistle is not positioned — it comes from you.
      out.connect(this.sfxBus);
    } else {
      out.connect(this.createPanner(x, y, z, 150)).connect(this.sfxBus);
    }
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

    source.connect(filter).connect(gain);
    // A touch of reverb, so footsteps sit in the forest rather than on top of it.
    this.sendToReverb(gain, 0.18);
    gain.connect(this.createPanner(x, y, z, 45)).connect(this.sfxBus);
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

    this.sendToReverb(gain, 0.5);
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
    if (this.directorTimer !== null) {
      clearTimeout(this.directorTimer);
      this.directorTimer = null;
    }
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
