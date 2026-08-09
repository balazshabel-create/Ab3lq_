import React, { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGameStore } from '@/game/store';
import { Icon } from '@/ui/components/Icon';
import { Text } from '@/ui/components/primitives';
import { palette, radius, shadow, spacing } from '@/ui/theme';

/**
 * ÁTFEDŐ RÉTEGEK: toast és modális keret.
 *
 * A toast animációja `useNativeDriver: true`-val fut, tehát a JS szál
 * blokkolása (pl. egy nagy „Max” vásárlás) sem akasztja meg — ez gyenge
 * készüléken jól látható különbség.
 */

const TOAST_DURATION_MS = 2600;

export function ToastHost() {
  const toast = useGameStore((s) => s.toast);
  const dismiss = useGameStore((s) => s.dismissToast);
  const insets = useSafeAreaInsets();

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (!toast) return undefined;

    opacity.setValue(0);
    translateY.setValue(20);

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 16 }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) dismiss();
        },
      );
    }, TOAST_DURATION_MS);

    return () => clearTimeout(timer);
  }, [toast, opacity, translateY, dismiss]);

  if (!toast) return null;

  const toneColor =
    toast.tone === 'success'
      ? palette.success
      : toast.tone === 'error'
        ? palette.danger
        : palette.info;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.toastWrap,
        { bottom: insets.bottom + 84, opacity, transform: [{ translateY }] },
      ]}
    >
      <Pressable onPress={dismiss} style={[styles.toast, { borderColor: toneColor }]}>
        <View style={[styles.toastDot, { backgroundColor: toneColor }]} />
        <Text variant="label" color={palette.text} style={{ flex: 1 }}>
          {toast.text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** Egységes modális keret: sötétített háttér, lekerekített lap, bezáró gomb. */
export function ModalShell({
  visible,
  onClose,
  title,
  children,
  dismissable = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  dismissable?: boolean;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissable ? onClose : undefined}
    >
      <Pressable
        style={styles.backdrop}
        onPress={dismissable ? onClose : undefined}
        accessibilityLabel={dismissable ? 'Bezárás' : undefined}
      >
        {/* A belső Pressable elnyeli a koppintást, hogy a lapra kattintva
            ne záródjon be az ablak. */}
        <Pressable style={[styles.sheet, shadow(3)]} onPress={() => undefined}>
          {title ? (
            <View style={styles.sheetHeader}>
              <Text variant="title" color={palette.text} style={{ flex: 1 }}>
                {title}
              </Text>
              {dismissable ? (
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Bezárás"
                >
                  <Icon name="close" size={22} color={palette.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  toastWrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  toastDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.md,
  },
  backdrop: {
    flex: 1,
    backgroundColor: palette.overlay,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: palette.border,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
});
