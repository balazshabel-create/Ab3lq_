/**
 * QualitySettings.ts — the graphics options, and the three presets.
 *
 * Every renderer reads from one settings object, so a preset change propagates
 * everywhere without any system needing to know about the others. Settings
 * persist to localStorage, since nobody wants to re-pick "LOW" every launch on
 * a laptop.
 */

export type QualityPreset = 'low' | 'medium' | 'high' | 'custom';

export type LevelSetting = 'off' | 'low' | 'medium' | 'high';

export interface GraphicsSettings {
  preset: QualityPreset;

  // --- Individually exposed options, as requested -------------------------
  shadowQuality: LevelSetting;
  textureQuality: LevelSetting;
  /** Metres. Also drives fog distance. */
  viewDistance: number;
  effectsQuality: LevelSetting;
  foliageQuality: LevelSetting;
  waterQuality: LevelSetting;
  antiAliasing: boolean;
  ambientOcclusion: boolean;
  volumetricFog: boolean;
  motionBlur: boolean;
  vsync: boolean;

  // --- Derived / advanced -----------------------------------------------
  /** Device pixel ratio cap. 1 = never supersample. */
  resolutionScale: number;
  /** Maximum animals drawn with fully articulated, animated models. */
  maxArticulatedAnimals: number;
  /** Maximum total animals drawn at all. */
  maxVisibleAnimals: number;
  /** Terrain mesh segments per side. */
  terrainSegments: number;
  /** Foliage instance budget multiplier, 0..1. */
  foliageDensity: number;
  /** Grass render distance in metres. */
  grassDistance: number;
  /** Rain particle count. */
  rainParticles: number;
  /** Render the sky dome's star field. */
  stars: boolean;
}

const PRESETS: Record<'low' | 'medium' | 'high', Omit<GraphicsSettings, 'preset'>> = {
  low: {
    shadowQuality: 'off',
    textureQuality: 'low',
    viewDistance: 130,
    effectsQuality: 'low',
    foliageQuality: 'low',
    waterQuality: 'low',
    antiAliasing: false,
    ambientOcclusion: false,
    volumetricFog: false,
    motionBlur: false,
    vsync: true,
    resolutionScale: 0.8,
    maxArticulatedAnimals: 10,
    maxVisibleAnimals: 45,
    terrainSegments: 96,
    foliageDensity: 0.3,
    grassDistance: 28,
    rainParticles: 2400,
    stars: false,
  },
  medium: {
    shadowQuality: 'medium',
    textureQuality: 'medium',
    viewDistance: 200,
    effectsQuality: 'medium',
    foliageQuality: 'medium',
    waterQuality: 'medium',
    antiAliasing: true,
    ambientOcclusion: false,
    volumetricFog: true,
    motionBlur: false,
    vsync: true,
    resolutionScale: 1,
    maxArticulatedAnimals: 22,
    maxVisibleAnimals: 90,
    terrainSegments: 160,
    foliageDensity: 0.65,
    grassDistance: 46,
    rainParticles: 6000,
    stars: true,
  },
  high: {
    shadowQuality: 'high',
    textureQuality: 'high',
    viewDistance: 290,
    effectsQuality: 'high',
    foliageQuality: 'high',
    waterQuality: 'high',
    antiAliasing: true,
    ambientOcclusion: true,
    volumetricFog: true,
    motionBlur: true,
    vsync: true,
    resolutionScale: 1,
    maxArticulatedAnimals: 40,
    maxVisibleAnimals: 150,
    terrainSegments: 224,
    foliageDensity: 1,
    grassDistance: 70,
    rainParticles: 11000,
    stars: true,
  },
};

const STORAGE_KEY = 'jungle-jukebox.graphics.v1';

/** Shadow map resolution for each shadow quality level. */
export function shadowMapSize(level: LevelSetting): number {
  switch (level) {
    case 'high':
      // 3072 rather than 4096: the jump to 4k costs 67 MB of depth buffer for a
      // difference the fog hides, and tightening the shadow frustum (see
      // configureShadows) buys far more sharpness per byte than resolution does.
      return 3072;
    case 'medium':
      return 1024;
    case 'low':
      return 512;
    default:
      return 0;
  }
}

/** Numeric weight for a level setting, for scaling effect counts. */
export function levelScale(level: LevelSetting): number {
  switch (level) {
    case 'high':
      return 1;
    case 'medium':
      return 0.6;
    case 'low':
      return 0.3;
    default:
      return 0;
  }
}

export function presetSettings(preset: 'low' | 'medium' | 'high'): GraphicsSettings {
  return { preset, ...PRESETS[preset] };
}

/**
 * The live settings object.
 *
 * Systems subscribe rather than polling, so applying a preset mid-game rebuilds
 * only what actually needs rebuilding.
 */
export class GraphicsConfig {
  private settings: GraphicsSettings;
  private listeners = new Set<(s: GraphicsSettings) => void>();

  constructor() {
    this.settings = loadSettings();
  }

  get(): GraphicsSettings {
    return this.settings;
  }

  /** Apply a whole preset. */
  applyPreset(preset: 'low' | 'medium' | 'high'): void {
    this.settings = presetSettings(preset);
    this.commit();
  }

  /**
   * Change one option. This switches the preset label to "custom", which is
   * what players expect after touching an individual slider.
   */
  set<K extends keyof GraphicsSettings>(key: K, value: GraphicsSettings[K]): void {
    if (this.settings[key] === value) return;
    this.settings = { ...this.settings, [key]: value, preset: 'custom' };
    // Keep the derived values consistent with the option the player just moved,
    // otherwise "foliage: low" would still render the high-preset instance count.
    this.syncDerived(key);
    this.commit();
  }

  /** Keep derived budgets in step with the exposed option that drives them. */
  private syncDerived<K extends keyof GraphicsSettings>(key: K): void {
    const s = { ...this.settings };
    switch (key) {
      case 'foliageQuality':
        s.foliageDensity = Math.max(0.15, levelScale(s.foliageQuality));
        s.grassDistance = 20 + levelScale(s.foliageQuality) * 50;
        break;
      case 'effectsQuality':
        s.rainParticles = Math.round(600 + levelScale(s.effectsQuality) * 3600);
        break;
      case 'viewDistance':
        // Drawing animals further than we can see is wasted work.
        s.maxVisibleAnimals = Math.round(30 + (s.viewDistance / 290) * 120);
        break;
      default:
        break;
    }
    this.settings = s;
  }

  onChange(fn: (s: GraphicsSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private commit(): void {
    saveSettings(this.settings);
    for (const fn of this.listeners) fn(this.settings);
  }

  /**
   * Guess a sensible preset from what the device tells us about itself.
   * Deliberately conservative: a first impression at 12 fps is unrecoverable.
   */
  static detectPreset(): 'low' | 'medium' | 'high' {
    if (typeof navigator === 'undefined') return 'medium';
    const cores = navigator.hardwareConcurrency ?? 4;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent ?? '');
    if (mobile || cores <= 2) return 'low';
    if (cores >= 8 && memory >= 8) return 'high';
    return 'medium';
  }
}

function loadSettings(): GraphicsSettings {
  const fallback = presetSettings(GraphicsConfig.detectPreset());
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<GraphicsSettings>;
    // Merge over the fallback so a settings file from an older build, missing
    // newly added fields, still loads instead of breaking the renderer.
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function saveSettings(settings: GraphicsSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a full quota: settings simply will not persist.
  }
}

/** Shared instance used by the whole client. */
export const graphicsConfig = new GraphicsConfig();
