import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/ui/components/Icon';
import { Text } from '@/ui/components/primitives';
import { DURATION, EASE, useReducedMotion } from '@/ui/motion';
import { palette, radius, shadow, spacing } from '@/ui/theme';

/**
 * FELCSÚSZÓ PANEL
 *
 * A játékban nincs külön „menüképernyő”: a kávézó mindig ott van a háttérben,
 * és tovább fut. Amikor a játékos megnyit egy részt (Bolt, Gépek, Városok), az
 * **ráúszik** a jelenetre — a macskák közben is jönnek-mennek mögötte.
 *
 * Ez nem csak látvány: egy idle játékban a folyamatosan látható termelés
 * érezhetően erősebb visszacsatolás, mint egy statikus menü, ahol „megáll az
 * élet”.
 *
 * A panel a képernyő tetejéig sosem ér fel — a fejléc (pénz, bevétel) és a
 * jelenet egy sávja mindig látszik.
 */

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
};

export function Sheet({ visible, title, subtitle, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();

  // A panel a képernyő ~74%-át foglalja el, hogy a jelenet fölötte maradjon.
  const sheetHeight = Math.min(height * 0.74, height - 132);

  const translateY = useRef(new Animated.Value(sheetHeight)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  /**
   * Külön „mountolt” állapot: a bezáró animációt végig kell játszani, mielőtt
   * a panel eltűnik a fából. E nélkül a tartalom egy képkocka alatt kivágódna.
   */
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: reduced ? 0 : DURATION.panel,
          easing: EASE.out,
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, {
          toValue: 1,
          duration: reduced ? 0 : DURATION.quick,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: sheetHeight,
        duration: reduced ? 0 : DURATION.quick,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: reduced ? 0 : DURATION.quick,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, translateY, backdrop, sheetHeight, reduced]);

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* The backdrop dims, but the scene shows through - you can see it keeps running. */}
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]} pointerEvents="auto">
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close panel"
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          shadow(3),
          {
            height: sheetHeight,
            paddingBottom: insets.bottom,
            transform: [{ translateY }],
          },
        ]}
      >
        <View style={styles.grabber} />

        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="title" color={palette.text}>
              {title}
            </Text>
            {subtitle ? (
              <Text variant="caption" color={palette.textDim}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          <Pressable
            onPress={onClose}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.close}
          >
            <Icon name="close" size={20} color={palette.textMuted} />
          </Pressable>
        </View>

        <View style={styles.body}>{children}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(8, 6, 14, 0.62)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
});
