import React from 'react';
import { StyleSheet, View } from 'react-native';

import { formatCountdown, formatMoney, formatNumber, formatRate } from '@/core/format';
import { useGameStore, useWallet } from '@/game/store';
import { Icon } from '@/ui/components/Icon';
import { Text } from '@/ui/components/primitives';
import { palette, radius, spacing } from '@/ui/theme';

/**
 * FEJLÉC
 *
 * A játékos három legfontosabb száma mindig látszik: pénz, bevétel/mp és a
 * prémium valuta. Ez a mobil idle játékok legfontosabb UI-szabálya — ha a
 * bevétel/mp nem látszik, a játékos nem érzi a fejlődést, és kilép.
 *
 * A `useWallet` sekély összehasonlítással iratkozik fel, így másodpercenként
 * 5× rajzol újra, de csak ez a néhány szöveg — a lista nem.
 */
export const TopBar = React.memo(function TopBar() {
  const { cash, coins, stars, incomePerSecond } = useWallet();

  return (
    <View style={styles.container}>
      <View style={styles.cashBlock}>
        <Text variant="title" color={palette.text} numberOfLines={1}>
          {formatMoney(cash)}
        </Text>
        <Text variant="label" color={palette.success} numberOfLines={1}>
          {formatRate(incomePerSecond)}
        </Text>
      </View>

      <View style={styles.pills}>
        {stars > 0 ? (
          <Pill icon="star" color={palette.star} value={formatNumber(stars)} label="csillag" />
        ) : null}
        <Pill icon="coin" color={palette.coin} value={formatNumber(coins)} label="Food Coin" />
      </View>
    </View>
  );
});

function Pill({
  icon,
  color,
  value,
  label,
}: {
  icon: 'coin' | 'star';
  color: string;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.pill} accessibilityLabel={`${value} ${label}`}>
      <Icon name={icon} size={16} color={color} tint={palette.bg} />
      <Text variant="label" color={palette.text} style={{ marginLeft: spacing.xs }}>
        {value}
      </Text>
    </View>
  );
}

/** Aktív booster-sáv a fejléc alatt. Csak akkor jelenik meg, ha van mit mutatni. */
export const BoosterBar = React.memo(function BoosterBar() {
  // A `tick`-re iratkozunk fel, hogy a visszaszámláló másodpercenként frissüljön.
  const tick = useGameStore((s) => s.tick);
  const boosters = useGameStore((s) => s.state.boosters);
  const now = Date.now();

  const active = Object.entries(boosters).filter(
    ([, booster]) => booster && booster.expiresAt > now,
  );

  if (active.length === 0) return null;

  return (
    <View style={styles.boosterRow} key={tick % 2}>
      {active.map(([key, booster]) => {
        if (!booster) return null;
        const remaining = (booster.expiresAt - now) / 1000;
        const isSpeed = booster.cycleMultiplier < 1;
        return (
          <View key={key} style={styles.boosterChip}>
            <Icon
              name={isSpeed ? 'clock' : 'flame'}
              size={14}
              color={isSpeed ? palette.info : palette.primary}
            />
            <Text variant="caption" color={palette.text} style={{ marginLeft: 4 }}>
              {isSpeed ? 'Turbó' : `×${booster.incomeMultiplier}`} · {formatCountdown(remaining)}
            </Text>
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  cashBlock: {
    flex: 1,
    marginRight: spacing.md,
  },
  pills: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceSunken,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginLeft: spacing.sm,
    borderWidth: 1,
    borderColor: palette.border,
  },
  boosterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  boosterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
});
