import React from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { formatCountdown, formatMoney, formatNumber, formatRate } from '@/core/format';
import { useGameStore, useWallet } from '@/game/store';
import { Icon } from '@/ui/components/Icon';
import { Text } from '@/ui/components/primitives';
import { useLoop, usePop } from '@/ui/motion';
import { palette, radius, shadow, spacing } from '@/ui/theme';

/**
 * LEBEGŐ FEJLÉC
 *
 * A jelenet FÖLÖTT úszik, nem foglal el külön sávot — így a kávézó marad a
 * képernyő, és a számok csak rárétegződnek. Sötét, áttetsző alap, hogy a
 * háttér átüssön, de a szöveg olvasható maradjon.
 */
export const Hud = React.memo(function Hud({ onSettings }: { onSettings: () => void }) {
  const { cash, coins, stars, incomePerSecond } = useWallet();

  // Az érme ritkán változik, ezért ott jólesik egy apró felugrás.
  const coinPop = usePop(coins);

  return (
    <View style={styles.hud} pointerEvents="box-none">
      {/*
        A képernyőolvasónak a "1,2 M Ft" formátum félreérthető, ezért a
        pontos értéket külön címkén adjuk meg. Ez egyben stabil fogódzót ad a
        böngészős füstteszt számára is.
      */}
      <View
        style={styles.wallet}
        accessible
        accessibilityLabel={`Készpénz ${Math.floor(cash)} dollár, bevétel ${Math.floor(incomePerSecond)} dollár másodpercenként`}
      >
        <Text variant="title" color={palette.text} numberOfLines={1}>
          {formatMoney(cash)}
        </Text>
        <View style={styles.rateRow}>
          <View style={styles.rateDot} />
          <Text variant="label" color={palette.success} numberOfLines={1}>
            {formatRate(incomePerSecond)}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        {stars > 0 ? (
          <Pill icon="star" color={palette.star} value={formatNumber(stars)} />
        ) : null}

        <Animated.View style={{ transform: [{ scale: coinPop }] }}>
          <Pill icon="coin" color={palette.coin} value={formatNumber(coins)} />
        </Animated.View>

        <Pressable
          onPress={onSettings}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Beállítások"
          style={styles.settings}
        >
          <Icon name="settings" size={18} color={palette.textMuted} />
        </Pressable>
      </View>
    </View>
  );
});

function Pill({ icon, color, value }: { icon: 'coin' | 'star'; color: string; value: string }) {
  return (
    <View style={styles.pill}>
      <Icon name={icon} size={14} color={color} tint={palette.bg} />
      <Text variant="label" color={palette.text} style={{ marginLeft: 5 }}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Aktív bónuszok sávja. Csak akkor jelenik meg, ha van mit mutatni, és
 * finoman lüktet, hogy a játékos érezze: most jobb a termelés.
 */
export const BoosterStrip = React.memo(function BoosterStrip() {
  useGameStore((s) => s.tick); // a visszaszámláló frissítéséhez
  const boosters = useGameStore((s) => s.state.boosters);
  const pulse = useLoop(1100);

  const now = Date.now();
  const active = Object.entries(boosters).filter(
    ([, booster]) => booster && booster.expiresAt > now,
  );

  if (active.length === 0) return null;

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });

  return (
    <View style={styles.boosterRow} pointerEvents="none">
      {active.map(([key, booster]) => {
        if (!booster) return null;
        const isSpeed = booster.cycleMultiplier < 1;
        return (
          <Animated.View key={key} style={[styles.boosterChip, { opacity }]}>
            <Icon
              name={isSpeed ? 'clock' : 'flame'}
              size={12}
              color={isSpeed ? palette.info : palette.primary}
            />
            <Text variant="caption" color={palette.text} style={{ marginLeft: 4 }}>
              {isSpeed ? 'Turbó' : `×${booster.incomeMultiplier}`} ·{' '}
              {formatCountdown((booster.expiresAt - now) / 1000)}
            </Text>
          </Animated.View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  hud: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  wallet: {
    flex: 1,
    backgroundColor: 'rgba(15,13,24,0.62)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    alignSelf: 'flex-start',
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rateDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.success,
    marginRight: 6,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: spacing.md,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15,13,24,0.72)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  settings: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(15,13,24,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boosterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  boosterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(38,35,56,0.9)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    ...shadow(1),
  },
});
