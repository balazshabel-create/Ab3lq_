import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatCountdown } from '@/core/format';
import { useGameStore } from '@/game/store';
import { canOpenFreeCrate, canShowRewarded, rewardIsFree } from '@/services/ads';
import { Icon, type IconName } from '@/ui/components/Icon';
import { Text } from '@/ui/components/primitives';
import { DURATION, EASE, useJitter, useLoop, useReducedMotion } from '@/ui/motion';
import { HIT_SIZE, palette, radius, shadow, spacing } from '@/ui/theme';

/**
 * ALSÓ DOKK
 *
 * Nem fülsor: a játék nem vált képernyőt, hanem panelt úsztat a kávézó fölé.
 * Ezek a gombok tehát „fiókok”, nem navigáció — ezért kerek ikonok, és ezért
 * marad a jelenet mögöttük mindig látható.
 *
 * A pötty jelzi, ha valahol felvehető jutalom vagy megfizethető lépés vár;
 * ez a legerősebb visszatérés-ösztönző, amit egy idle játék használhat.
 */

export type PanelKey =
  | 'products'
  | 'upgrades'
  | 'staff'
  | 'cities'
  | 'missions'
  | 'shop';

export const DOCK_ITEMS: readonly { key: PanelKey; label: string; icon: IconName }[] = [
  { key: 'products', label: 'Kínálat', icon: 'stand' },
  { key: 'upgrades', label: 'Gépek', icon: 'upgrade' },
  { key: 'staff', label: 'Csapat', icon: 'chef' },
  { key: 'cities', label: 'Helyek', icon: 'city' },
  { key: 'missions', label: 'Küldetés', icon: 'quest' },
  { key: 'shop', label: 'Bolt', icon: 'shop' },
];

export const Dock = React.memo(function Dock({
  active,
  onOpen,
  badges,
}: {
  active: PanelKey | null;
  onOpen: (key: PanelKey) => void;
  badges?: Partial<Record<PanelKey, boolean>>;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.dock, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}
      pointerEvents="box-none"
    >
      {DOCK_ITEMS.map((item, index) => (
        <DockButton
          key={item.key}
          item={item}
          index={index}
          selected={active === item.key}
          badge={badges?.[item.key] ?? false}
          onPress={() => onOpen(item.key)}
        />
      ))}
    </View>
  );
});

const DockButton = React.memo(function DockButton({
  item,
  index,
  selected,
  badge,
  onPress,
}: {
  item: { key: PanelKey; label: string; icon: IconName };
  index: number;
  selected: boolean;
  badge: boolean;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const enter = useRef(new Animated.Value(0)).current;

  // Induláskor a gombok egymás után úsznak be – ez az egyetlen „bemutatkozó”
  // animáció, ami után a dokk nyugton marad.
  useEffect(() => {
    if (reduced) {
      enter.setValue(1);
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: DURATION.panel,
      delay: 120 + index * 55,
      easing: EASE.out,
      useNativeDriver: true,
    }).start();
  }, [enter, index, reduced]);

  const press = (toValue: number) => {
    if (reduced) return;
    Animated.timing(scale, {
      toValue,
      duration: DURATION.instant,
      easing: EASE.out,
      useNativeDriver: true,
    }).start();
  };

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [26, 0] });

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY }, { scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => press(0.9)}
        onPressOut={() => press(1)}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        accessibilityState={{ selected }}
        style={styles.button}
      >
        <View style={[styles.circle, selected && styles.circleActive]}>
          <Icon
            name={item.icon}
            size={22}
            color={selected ? palette.bg : palette.text}
            tint={selected ? palette.bg : palette.accent}
          />
          {badge ? <NotificationDot /> : null}
        </View>
        <Text variant="caption" color={selected ? palette.primary : palette.textDim}>
          {item.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

/** Lüktető pötty – csak akkor jelenik meg, ha tényleg van tennivaló. */
const NotificationDot = React.memo(function NotificationDot() {
  const pulse = useLoop(760);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  return <Animated.View style={[styles.dot, { transform: [{ scale }] }]} />;
});

// ---------------------------------------------------------------------------
// Jutalomgombok a jelenet oldalán
// ---------------------------------------------------------------------------

/**
 * A reklámért járó bónuszok mindig kéznél vannak, a jelenet jobb szélén.
 *
 * Szándékosan **oldalt** és nem felugró ablakban: a játék folyamatosan
 * felkínálja őket, de soha nem szakítja félbe velük a játékmenetet. Amelyik
 * épp elérhető, az lassan lüktet; amelyik töltődik, az halvány és
 * visszaszámlál.
 */
export const RewardRail = React.memo(function RewardRail() {
  useGameStore((s) => s.tick);
  const state = useGameStore((s) => s.state);
  const busy = useGameStore((s) => s.busy);
  const watchRewarded = useGameStore((s) => s.watchRewarded);
  const openFreeCrate = useGameStore((s) => s.openFreeCrate);

  const now = Date.now();
  const free = rewardIsFree(state);

  const doubleGate = canShowRewarded(state, 'doubleIncome', now);
  const turboGate = canShowRewarded(state, 'turbo', now);
  const crateGate = canOpenFreeCrate(state, now);

  const crateWait =
    !crateGate.allowed && state.ads.nextFreeCrateAt > now
      ? formatCountdown((state.ads.nextFreeCrateAt - now) / 1000)
      : null;

  return (
    <View style={styles.rail} pointerEvents="box-none">
      <RewardButton
        icon="flame"
        color={palette.primary}
        label="×2"
        caption={doubleGate.allowed ? (free ? 'ingyen' : 'videó') : '—'}
        ready={doubleGate.allowed && !busy}
        onPress={() => void watchRewarded('doubleIncome')}
        seed={1}
      />
      <RewardButton
        icon="clock"
        color={palette.info}
        label="Turbó"
        caption={turboGate.allowed ? (free ? 'ingyen' : 'videó') : '—'}
        ready={turboGate.allowed && !busy}
        onPress={() => void watchRewarded('turbo')}
        seed={2}
      />
      <RewardButton
        icon="crate"
        color={palette.premium}
        label="Láda"
        caption={crateGate.allowed ? 'nyitható' : (crateWait ?? '—')}
        ready={crateGate.allowed && !busy}
        onPress={() => void openFreeCrate()}
        seed={3}
      />
    </View>
  );
});

const RewardButton = React.memo(function RewardButton({
  icon,
  color,
  label,
  caption,
  ready,
  onPress,
  seed,
}: {
  icon: IconName;
  color: string;
  label: string;
  caption: string;
  ready: boolean;
  onPress: () => void;
  seed: number;
}) {
  const reduced = useReducedMotion();
  const jitter = useJitter(seed);
  const pulse = useLoop(1250 + jitter * 400, jitter * 500);

  // Csak az elérhető gomb mozog – így a szem oda kerül, ahol van tennivaló.
  const scale = ready && !reduced
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] })
    : 1;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${caption}`}
        style={[styles.reward, !ready && styles.rewardOff]}
      >
        <Icon name={icon} size={20} color={color} tint={palette.bg} />
        <Text variant="caption" color={palette.text} numberOfLines={1}>
          {label}
        </Text>
        <Text variant="caption" color={palette.textDim} numberOfLines={1}>
          {caption}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    backgroundColor: 'rgba(12,10,20,0.86)',
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  button: {
    minWidth: HIT_SIZE,
    alignItems: 'center',
    paddingVertical: 2,
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  circleActive: {
    backgroundColor: palette.primary,
    borderColor: palette.accent,
  },
  dot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.danger,
    borderWidth: 2,
    borderColor: palette.bg,
  },
  rail: {
    position: 'absolute',
    right: spacing.md,
    // A dokk fölött ül, a járda jobb szélén: mindig kéznél van, de nem
    // takarja sem a pultot, sem a sorban álló macskákat.
    bottom: 118,
    gap: spacing.sm,
  },
  reward: {
    width: 62,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(20,17,30,0.88)',
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    ...shadow(1),
  },
  rewardOff: {
    opacity: 0.42,
  },
});
