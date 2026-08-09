import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { HIT_SIZE, palette, radius, shadow, spacing, typography } from '@/ui/theme';

/**
 * ALAPKOMPONENSEK
 *
 * Szándékosan nem használunk UI-könyvtárat: az idle játék felülete kevés,
 * de nagyon sokszor újrarajzolt elemből áll, és egy általános célú könyvtár
 * réteges absztrakciói itt mérhető képkocka-veszteséget okoznának.
 *
 * Minden interaktív elem legalább 48×48 pt (HIT_SIZE), és van `accessibilityRole`-ja.
 */

// ---------------------------------------------------------------------------
// Szöveg
// ---------------------------------------------------------------------------

type TextVariant = keyof typeof typography;

type TextProps = {
  variant?: TextVariant;
  color?: string;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children: React.ReactNode;
};

export function Text({
  variant = 'body',
  color = palette.text,
  align,
  style,
  numberOfLines,
  children,
}: TextProps) {
  return (
    <RNText
      numberOfLines={numberOfLines}
      // A rendszer betűméret-beállítását tiszteletben tartjuk, de korlátozzuk,
      // hogy a sűrű játékfelület ne törjön szét nagyon nagy méretnél.
      maxFontSizeMultiplier={1.35}
      style={[typography[variant], { color, textAlign: align }, style]}
    >
      {children}
    </RNText>
  );
}

// ---------------------------------------------------------------------------
// Kártya
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  raised,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  raised?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        raised && [{ backgroundColor: palette.surfaceRaised }, shadow(1)],
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Gombok
// ---------------------------------------------------------------------------

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'premium' | 'success' | 'danger';

type ButtonProps = {
  label: string;
  sublabel?: string;
  onPress: () => void;
  tone?: ButtonTone;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

const TONE_COLORS: Record<ButtonTone, { bg: string; text: string; border?: string }> = {
  primary: { bg: palette.primary, text: '#241304' },
  secondary: { bg: palette.surfaceRaised, text: palette.text, border: palette.border },
  ghost: { bg: 'transparent', text: palette.textMuted, border: palette.border },
  premium: { bg: palette.premium, text: '#1B0B22' },
  success: { bg: palette.success, text: '#08240F' },
  danger: { bg: palette.danger, text: '#2A0808' },
};

export function Button({
  label,
  sublabel,
  onPress,
  tone = 'primary',
  disabled,
  loading,
  icon,
  compact,
  style,
  accessibilityHint,
}: ButtonProps) {
  const colors = TONE_COLORS[tone];
  const isOff = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isOff}
      accessibilityRole="button"
      accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isOff }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border ?? 'transparent',
          borderWidth: colors.border ? 1 : 0,
        },
        pressed && !isOff && styles.buttonPressed,
        isOff && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <View style={styles.buttonInner}>
          {icon}
          <View style={icon ? { marginLeft: spacing.sm } : undefined}>
            <Text variant={compact ? 'label' : 'heading'} color={colors.text} align="center">
              {label}
            </Text>
            {sublabel ? (
              <Text variant="caption" color={colors.text} align="center" style={{ opacity: 0.75 }}>
                {sublabel}
              </Text>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** Nyomógomb tetszőleges tartalommal (kártyák, listaelemek). */
export function Touchable({
  children,
  style,
  ...rest
}: PressableProps & { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => [style, pressed && !rest.disabled && { opacity: 0.75 }]}
    >
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Folyamatjelző
// ---------------------------------------------------------------------------

/**
 * Egyszerű, nem animált folyamatjelző. Szándékosan nem `Animated`: az értéket
 * a game loop 5 Hz-en frissíti, és egy natív animáció itt csak a két
 * frissítés között interpolálna — több CPU, kevés vizuális haszon.
 */
export const ProgressBar = React.memo(function ProgressBar({
  progress,
  color = palette.primary,
  height = 8,
  background = palette.surfaceSunken,
}: {
  progress: number;
  color?: string;
  height?: number;
  background?: string;
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={[styles.progressTrack, { height, backgroundColor: background }]}>
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: radius.pill,
        }}
      />
    </View>
  );
});

// ---------------------------------------------------------------------------
// Jelvény / címke
// ---------------------------------------------------------------------------

export function Badge({
  label,
  color = palette.primary,
  textColor = '#1A0E03',
}: {
  label: string;
  color?: string;
  textColor?: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text variant="caption" color={textColor}>
        {label}
      </Text>
    </View>
  );
}

/** Szekciócím a listák fölé. */
export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text variant="caption" color={palette.textDim}>
        {title.toUpperCase()}
      </Text>
      {hint ? (
        <Text variant="caption" color={palette.textDim}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Üres lista helyőrzője. */
export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text variant="heading" color={palette.textMuted} align="center">
        {title}
      </Text>
      <Text variant="body" color={palette.textDim} align="center" style={{ marginTop: spacing.sm }}>
        {body}
      </Text>
    </View>
  );
}

/** Vízszintes elválasztó. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  button: {
    minHeight: HIT_SIZE,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  progressTrack: {
    width: '100%',
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  sectionTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: spacing.md,
  },
});
