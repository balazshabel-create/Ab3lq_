import { Platform, type TextStyle } from 'react-native';

/**
 * DESIGN RENDSZER
 *
 * Egyetlen forrás a színekre, térközökre és tipográfiára. Az egész UI innen
 * dolgozik, így egy kozmetikai csomag (Bolt > Kinézet) az `accentFor()`
 * függvényen keresztül az egész alkalmazást átszínezi.
 *
 * Sötét alap tudatos döntés: az idle játékot sokan este, ágyban nyitják meg,
 * és a sötét háttér OLED kijelzőn kevesebb akkumulátort is fogyaszt — ami egy
 * olyan játéknál, amit naponta többször nyitnak meg, valóban számít.
 */

export const palette = {
  // Háttérrétegek (a legsötétebbtől a legvilágosabbig)
  bg: '#12101A',
  surface: '#1C1A29',
  surfaceRaised: '#262338',
  surfaceSunken: '#15131F',
  border: '#332F47',

  // Szöveg
  text: '#F5F3FF',
  textMuted: '#A29DBD',
  textDim: '#6E6889',

  // Márkaszínek
  primary: '#F2994A',
  primaryDark: '#C97A34',
  secondary: '#EB5757',
  accent: '#F2C94C',

  // Állapotszínek
  success: '#6FCF97',
  info: '#56CCF2',
  danger: '#EB5757',
  premium: '#BB6BD9',

  // Valuták
  cash: '#6FCF97',
  coin: '#F2C94C',
  star: '#FFD76E',

  overlay: 'rgba(8, 6, 14, 0.78)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

/**
 * A minimális érintési célterület. Az Apple HIG 44pt-ot, a Material 48dp-t
 * ajánl — 48-cal mindkettőt teljesítjük.
 */
export const HIT_SIZE = 48;

const fontFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif-medium',
  default: 'System',
});

export const typography = {
  display: {
    fontFamily,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  } satisfies TextStyle,
  title: {
    fontFamily,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  } satisfies TextStyle,
  heading: {
    fontFamily,
    fontSize: 17,
    fontWeight: '700',
  } satisfies TextStyle,
  body: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
  } satisfies TextStyle,
  label: {
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  } satisfies TextStyle,
  caption: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  } satisfies TextStyle,
  /** Számokhoz: fix szélességű számjegyek, hogy a kijelző ne ugráljon. */
  numeric: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 15,
    fontWeight: '700',
  } satisfies TextStyle,
} as const;

/**
 * Árnyék. Androidon az `elevation`, iOS-en a shadow* tulajdonságok élnek.
 * Gyenge készüléken az árnyék drága, ezért csak kiemelt elemeken használjuk.
 */
export function shadow(level: 1 | 2 | 3) {
  const config = { 1: 4, 2: 8, 3: 16 }[level];
  return Platform.select({
    android: { elevation: config / 2 },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: config,
      shadowOffset: { width: 0, height: config / 3 },
    },
  });
}

/** A kozmetikai csomag által felülírt kiemelőszínek. */
export type AccentPalette = {
  primary: string;
  secondary: string;
  accent: string;
};

export const defaultAccent: AccentPalette = {
  primary: palette.primary,
  secondary: palette.secondary,
  accent: palette.accent,
};
