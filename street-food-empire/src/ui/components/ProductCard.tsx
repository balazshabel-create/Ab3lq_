import React from 'react';
import { StyleSheet, View } from 'react-native';

import { formatMoney, formatNumber, formatRate } from '@/core/format';
import { getCity } from '@/game/content/cities';
import type { ProductView } from '@/game/types';
import { FoodIcon } from '@/ui/components/FoodIcon';
import { Icon } from '@/ui/components/Icon';
import { Badge, Button, Card, ProgressBar, Text, Touchable } from '@/ui/components/primitives';
import { palette, radius, spacing } from '@/ui/theme';

/**
 * TERMÉKKÁRTYA – a játék legfontosabb, legtöbbször látott eleme.
 *
 * Egy kártyán három interakció van, világosan elkülönítve:
 *   1. **Bal oldali ikon** = kézi kiszolgálás (koppintás)
 *   2. **Jobb oldali gomb** = szintvásárlás
 *   3. **Menedzser gomb**   = automatizálás (csak amíg nincs menedzser)
 *
 * A kártya `React.memo`-val van becsomagolva, és a szülő ticknként egyszer
 * számolja újra a `ProductView`-t. Így 6 kártya × 5 Hz = 30 könnyű újrarajzolás
 * másodpercenként, ami belépőszintű Android készüléken is bőven fér a
 * képkockaidőbe.
 */

type Props = {
  view: ProductView;
  onTap: (productId: string) => void;
  onBuy: (productId: string) => void;
  onHireManager: (productId: string) => void;
};

export const ProductCard = React.memo(function ProductCard({
  view,
  onTap,
  onBuy,
  onHireManager,
}: Props) {
  const { def, state } = view;
  const city = getCity(def.cityId);
  const owned = state.level > 0;

  if (!view.unlocked) {
    return (
      <Card style={styles.lockedCard}>
        <View style={styles.lockedIcon}>
          <Icon name="lock" size={20} color={palette.textDim} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="heading" color={palette.textMuted}>
            Locked product
          </Text>
          <Text variant="caption" color={palette.textDim}>
            Earn {formatMoney(def.unlockAtCityEarnings)} in this city to unlock it
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <Card style={styles.card} raised>
      <View style={styles.row}>
        {/* --- Hand service --- */}
        <Touchable
          onPress={() => onTap(def.id)}
          disabled={!view.canServe}
          accessibilityRole="button"
          accessibilityLabel={`Serve ${def.name}`}
          accessibilityHint={
            state.hasManager
              ? 'This product earns automatically'
              : 'Tap to sell one batch'
          }
          style={[styles.tapZone, !view.canServe && styles.tapZoneOff]}
        >
          <FoodIcon name={def.icon} size={44} colors={city.colors} />
          {state.hasManager ? (
            <View style={styles.autoBadge}>
              <Icon name="check" size={10} color={palette.bg} />
            </View>
          ) : null}
        </Touchable>

        {/* --- Adatok --- */}
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text variant="heading" color={palette.text} numberOfLines={1} style={{ flex: 1 }}>
              {def.name}
            </Text>
            <Badge label={`lv. ${formatNumber(state.level)}`} color={palette.surfaceSunken} textColor={palette.textMuted} />
          </View>

          <Text
            variant="label"
            color={state.hasManager ? palette.success : owned ? palette.primary : palette.textDim}
          >
            {!owned
              ? 'Not bought yet'
              : state.hasManager
                ? formatRate(view.incomePerSecond)
                : `${formatMoney(view.revenuePerCycle)} / batch`}
          </Text>

          {/* Cycle progress when automated, time until the next batch when
              manual - both in the same bar. */}
          <View style={styles.progressRow}>
            <View style={{ flex: 1 }}>
              <ProgressBar
                progress={view.displayProgress}
                color={state.hasManager ? palette.success : palette.primary}
                height={6}
              />
            </View>
            <Text variant="caption" color={palette.textDim} style={styles.cycleLabel}>
              {state.hasManager
                ? view.continuous
                  ? 'folyamatos'
                  : `${view.cycleSeconds.toFixed(1)} mp`
                : view.canServe
                  ? 'ready!'
                  : `${view.cycleSeconds.toFixed(1)} mp`}
            </Text>
          </View>

          {view.nextMilestone ? (
            <Text variant="caption" color={palette.textDim}>
              At level {formatNumber(view.nextMilestone.level)}: {view.nextMilestone.label}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          label={owned ? `Upgrade ×${formatNumber(view.buyAmount)}` : 'Buy'}
          sublabel={view.buyAmount > 0 ? formatMoney(view.buyCost) : 'Not enough cash'}
          onPress={() => onBuy(def.id)}
          disabled={!view.affordable}
          tone="primary"
          style={{ flex: 1 }}
        />

        {owned && !state.hasManager ? (
          <Button
            label="Manager"
            sublabel={formatMoney(def.managerCost)}
            onPress={() => onHireManager(def.id)}
            tone="secondary"
            style={{ flex: 1, marginLeft: spacing.sm }}
            accessibilityHint="A manager earns automatically, even offline"
          />
        ) : null}
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  lockedCard: {
    marginBottom: spacing.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    opacity: 0.65,
    borderStyle: 'dashed',
  },
  lockedIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tapZone: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: palette.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  tapZoneOff: {
    opacity: 0.4,
  },
  autoBadge: {
    position: 'absolute',
    right: -4,
    top: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: palette.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: palette.surfaceRaised,
  },
  info: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  cycleLabel: {
    marginLeft: spacing.sm,
    minWidth: 62,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
});
