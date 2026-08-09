import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { FoodIcon } from '@/ui/components/FoodIcon';
import { Text } from '@/ui/components/primitives';
import { EASE, useLoop, useReducedMotion } from '@/ui/motion';
import { palette, radius } from '@/ui/theme';

/**
 * A JÁTÉKOS — a narancssárga szakács macska
 *
 * Ő áll a pult mögött, és ő készíti el a rendeléseket. Három állapota van:
 *
 *  · `idle`    – álldogál, lélegzik, néha megbillen a füle
 *  · `cooking` – a wok fölé hajol, kavar, gőz száll, a fej ütemre bólint
 *  · `serve`   – felemeli az elkészült adagot, és átnyújtja
 *
 * A rajz szándékosan ugyanabból az elemkészletből épül, mint a vendégmacskák
 * (`CatSprite`), csak nagyobb, szakácssapkás és kötényes — így egy világ
 * lakói, nem két külön stílus.
 */

export type CookState = 'idle' | 'cooking' | 'serve';

const ORANGE = {
  fur: '#F2994A',
  patch: '#D97E32',
  ear: '#F7B2A0',
  dark: '#B4651F',
} as const;

type Props = {
  state: CookState;
  /** 0..1 – mennyire készült el a rendelés (a főzés sávjához). */
  progress?: number;
  /** Mit főz épp (ikonkulcs). */
  cookingIcon?: string;
  cityColors: readonly [string, string];
  size?: number;
};

export const PlayerCat = React.memo(function PlayerCat({
  state,
  progress = 0,
  cookingIcon,
  cityColors,
  size = 96,
}: Props) {
  const reduced = useReducedMotion();

  // Álldogálva lassú lélegzés, főzés közben gyors kavarás.
  const idle = useLoop(state === 'cooking' ? 240 : 2000);
  const bob = idle.interpolate({
    inputRange: [0, 1],
    outputRange: state === 'cooking' ? [0, -4] : [0, -2.5],
  });
  const tilt = idle.interpolate({
    inputRange: [0, 1],
    outputRange: state === 'cooking' ? ['-5deg', '5deg'] : ['-1deg', '1deg'],
  });

  // Kiszolgáláskor egy határozott felemelés.
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state !== 'serve' || reduced) return;
    Animated.sequence([
      Animated.timing(lift, {
        toValue: -12,
        duration: 180,
        easing: EASE.out,
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: 0,
        duration: 320,
        easing: Easing.bounce,
        useNativeDriver: true,
      }),
    ]).start();
  }, [state, lift, reduced]);

  return (
    <View style={styles.wrap} pointerEvents="none">
      {/* --- Amit épp készít: a feje fölött, töltődő karikában --- */}
      {state === 'cooking' && cookingIcon ? (
        <View style={styles.cookBadge}>
          <View style={styles.cookIcon}>
            <FoodIcon name={cookingIcon} size={22} colors={cityColors} />
          </View>
          <View style={styles.cookTrack}>
            <View
              style={[
                styles.cookFill,
                { width: `${Math.max(0, Math.min(1, progress)) * 100}%` },
              ]}
            />
          </View>
          <Text variant="caption" color={palette.accent}>
            készül…
          </Text>
        </View>
      ) : null}

      <Animated.View
        style={{ transform: [{ translateY: Animated.add(bob, lift) }, { rotate: tilt }] }}
      >
        <Svg width={size} height={size} viewBox="0 0 96 96" fill="none">
          {/* Farok */}
          <Path
            d="M70 72c11 1 15-5 13-13"
            stroke={ORANGE.fur}
            strokeWidth={7}
            strokeLinecap="round"
            fill="none"
          />

          {/* Test + kötény */}
          <Path d="M30 92c0-14 8-23 18-23s18 9 18 23H30Z" fill={ORANGE.fur} />
          <Path d="M36 92c0-11 5.4-18 12-18s12 7 12 18H36Z" fill="#F3EFE6" />
          <Path d="M42 74h12v5H42z" fill="#E4DED0" />

          {/* Mancsok – főzésnél előrenyújtva */}
          {state === 'cooking' ? (
            <G fill={ORANGE.fur}>
              <Ellipse cx={30} cy={74} rx={6} ry={5} />
              <Ellipse cx={66} cy={74} rx={6} ry={5} />
            </G>
          ) : (
            <G fill={ORANGE.fur}>
              <Ellipse cx={32} cy={82} rx={5.5} ry={5} />
              <Ellipse cx={64} cy={82} rx={5.5} ry={5} />
            </G>
          )}

          {/* Fül */}
          <Path d="M28 40 25 20l18 9-15 11Z" fill={ORANGE.fur} />
          <Path d="M68 40 71 20l-18 9 15 11Z" fill={ORANGE.fur} />
          <Path d="M31.5 36 30 26l9 4.5-7.5 5.5Z" fill={ORANGE.ear} />
          <Path d="M64.5 36 66 26l-9 4.5 7.5 5.5Z" fill={ORANGE.ear} />

          {/* Fej */}
          <Ellipse cx={48} cy={46} rx={23} ry={20} fill={ORANGE.fur} />
          {/* Cirmos csíkok */}
          <G stroke={ORANGE.patch} strokeWidth={2.6} strokeLinecap="round" opacity={0.85}>
            <Path d="M41 29v5M48 28v5.5M55 29v5" />
          </G>

          {/* Szem */}
          {state === 'cooking' ? (
            // Főzés közben koncentrál – csukott, ívelt szem.
            <G stroke="#2B2632" strokeWidth={3} strokeLinecap="round" fill="none">
              <Path d="M37 46c2-2.6 6-2.6 8 0" />
              <Path d="M51 46c2-2.6 6-2.6 8 0" />
            </G>
          ) : (
            <G fill="#2B2632">
              <Ellipse cx={41} cy={45} rx={3.2} ry={4} />
              <Ellipse cx={55} cy={45} rx={3.2} ry={4} />
              <Circle cx={42.2} cy={43.5} r={1.2} fill="#FFF" />
              <Circle cx={56.2} cy={43.5} r={1.2} fill="#FFF" />
            </G>
          )}

          {/* Orr, száj, bajusz */}
          <Path d="M48 51.5l-2.6 2.2h5.2L48 51.5Z" fill={ORANGE.ear} />
          <Path
            d={state === 'serve' ? 'M43 57c3 3.4 7 3.4 10 0' : 'M45 56h6'}
            stroke="#2B2632"
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
          />
          <G stroke={ORANGE.patch} strokeWidth={1.5} strokeLinecap="round" opacity={0.7}>
            <Path d="M24 48h9M24 53h9M63 48h9M63 53h9" />
          </G>

          {/* Szakácssapka */}
          <G>
            <Path
              d="M28 28c-1-9 8-15 20-15s21 6 20 15H28Z"
              fill="#FFFFFF"
            />
            <Circle cx={34} cy={16} r={7.5} fill="#FFFFFF" />
            <Circle cx={48} cy={12} r={8.5} fill="#FFFFFF" />
            <Circle cx={62} cy={16} r={7.5} fill="#FFFFFF" />
            <Rect x={27} y={26} width={42} height={6} rx={3} fill="#E8E3D8" />
          </G>

          {/* Nyakkendő-szerű sál a márkaszínben */}
          <Path d="M40 66h16l-8 9-8-9Z" fill={cityColors[1]} />
        </Svg>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  cookBadge: {
    position: 'absolute',
    top: -46,
    alignItems: 'center',
    backgroundColor: 'rgba(15,13,24,0.9)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.accent,
    paddingHorizontal: 8,
    paddingVertical: 5,
    minWidth: 62,
  },
  cookIcon: {
    marginBottom: 3,
  },
  cookTrack: {
    width: 46,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
    overflow: 'hidden',
    marginBottom: 2,
  },
  cookFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: palette.accent,
  },
});
