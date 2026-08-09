import React, { useCallback, useMemo } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatMoney } from '@/core/format';
import { getCity } from '@/game/content/cities';
import { buildCityProductViews } from '@/game/selectors';
import { useGameStore } from '@/game/store';
import type { BuyQuantity } from '@/game/types';
import { ProductCard } from '@/ui/components/ProductCard';
import { Card, SectionTitle, Text } from '@/ui/components/primitives';
import { DURATION, EASE, useReducedMotion } from '@/ui/motion';
import { palette, radius, spacing } from '@/ui/theme';

/**
 * KÍNÁLAT PANEL
 *
 * Ez a régi „főképernyő” listája — de már nem képernyő, hanem a kávézóra
 * felcsúszó panel. A jelenet mögötte tovább fut, ezért itt kizárólag a
 * vásárlási döntések vannak: mit veszek, mennyit, és mit automatizálok.
 *
 * A jutalomgombok szándékosan NEM itt vannak, hanem a jeleneten (RewardRail):
 * ott a játékos akkor is látja őket, amikor épp nem nyit meg semmit.
 */

const QUANTITIES: readonly BuyQuantity[] = [1, 10, 100, 'max'];

export function ProductsPanel() {
  const tick = useGameStore((s) => s.tick);
  const state = useGameStore((s) => s.state);
  const multipliers = useGameStore((s) => s.multipliers);

  const tapProduct = useGameStore((s) => s.tapProduct);
  const buyProduct = useGameStore((s) => s.buyProduct);
  const hireManager = useGameStore((s) => s.hireManager);
  const setBuyQuantity = useGameStore((s) => s.setBuyQuantity);

  const city = getCity(state.activeCityId);

  const views = useMemo(
    () => buildCityProductViews(state, multipliers, state.activeCityId, Date.now()),
    // A `tick` szándékosan függőség: ez a „frissítsd újra” jelzés.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, state.activeCityId, state.settings.buyQuantity],
  );

  const handleTap = useCallback((id: string) => tapProduct(id), [tapProduct]);
  const handleBuy = useCallback((id: string) => buyProduct(id), [buyProduct]);
  const handleManager = useCallback((id: string) => hireManager(id), [hireManager]);

  const ownedCount = views.filter((view) => view.state.level > 0).length;
  const automated = views.filter((view) => view.state.hasManager).length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* --- Location + buy quantity --- */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="caption" color={palette.textDim}>
            {city.name.toUpperCase()}
          </Text>
          <Text variant="label" color={palette.textMuted}>
            {ownedCount}/{views.length} products · {automated} automated
          </Text>
        </View>

        <View style={styles.quantityRow}>
          {QUANTITIES.map((quantity) => (
            <QuantityChip
              key={String(quantity)}
              quantity={quantity}
              active={state.settings.buyQuantity === quantity}
              onPress={() => setBuyQuantity(quantity)}
            />
          ))}
        </View>
      </View>

      {views.map((view) => (
        <ProductCard
          key={view.def.id}
          view={view}
          onTap={handleTap}
          onBuy={handleBuy}
          onHireManager={handleManager}
        />
      ))}

      <Card style={styles.tipCard}>
        <Text variant="label" color={palette.textMuted}>
          Tipp
        </Text>
        <Text variant="caption" color={palette.textDim} style={{ marginTop: 4 }}>
          Without a manager a product earns nothing offline, and you have to
          hand every order to the cats yourself. If you can only afford one
          thing, the manager is almost always the better pick.
        </Text>
      </Card>

      <SectionTitle title="Next step" />
      <NextStepHint />
    </ScrollView>
  );
}

/** Vásárlási mennyiség kapcsoló – nyomásra összehúzódik. */
const QuantityChip = React.memo(function QuantityChip({
  quantity,
  active,
  onPress,
}: {
  quantity: BuyQuantity;
  active: boolean;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const scale = React.useRef(new Animated.Value(1)).current;

  const press = (toValue: number) => {
    if (reduced) return;
    Animated.timing(scale, {
      toValue,
      duration: DURATION.instant,
      easing: EASE.out,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => press(0.92)}
        onPressOut={() => press(1)}
        accessibilityRole="button"
        accessibilityLabel={`Buy ${quantity === 'max' ? 'maximum' : quantity} at a time`}
        accessibilityState={{ selected: active }}
        style={[styles.quantityChip, active && styles.quantityChipActive]}
      >
        <Text variant="caption" color={active ? palette.bg : palette.textMuted}>
          {quantity === 'max' ? 'MAX' : `×${quantity}`}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

/**
 * Egyetlen, konkrét javaslat arra, mit érdemes most csinálni.
 *
 * Idle játékban a legnagyobb lemorzsolódási ok a „mit kellene most tennem?”
 * pillanat. Ez a doboz mindig ad egy választ.
 */
const NextStepHint = React.memo(function NextStepHint() {
  const state = useGameStore((s) => s.state);
  const multipliers = useGameStore((s) => s.multipliers);
  useGameStore((s) => s.tick);

  const views = buildCityProductViews(state, multipliers, state.activeCityId, Date.now());

  const manager = views.find((view) => view.state.level > 0 && !view.state.hasManager);
  const affordableManager =
    manager && state.cash >= manager.def.managerCost ? manager : null;
  const locked = views.find((view) => !view.unlocked);

  const message = affordableManager
    ? `Hire the manager for ${affordableManager.def.name} — from then on it earns on its own, even offline.`
    : manager
      ? `Save up ${formatMoney(manager.def.managerCost)} for the ${manager.def.name} manager.`
      : locked
        ? `Earn ${formatMoney(locked.def.unlockAtCityEarnings)} here to unlock a new product.`
        : 'Every product is automated. Check the Machines and Locations panels!';

  return (
    <Card style={styles.hintCard}>
      <Text variant="body" color={palette.text}>
        {message}
      </Text>
    </Card>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  quantityRow: {
    flexDirection: 'row',
    backgroundColor: palette.surfaceSunken,
    borderRadius: radius.pill,
    padding: 3,
  },
  quantityChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  quantityChipActive: {
    backgroundColor: palette.primary,
  },
  tipCard: {
    marginTop: spacing.sm,
    backgroundColor: palette.surfaceSunken,
  },
  hintCard: {
    backgroundColor: palette.surfaceRaised,
    borderColor: palette.primary,
  },
});
