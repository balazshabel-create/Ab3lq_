import React, { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatCountdown } from '@/core/format';
import { getCity } from '@/game/content/cities';
import { useGameStore } from '@/game/store';
import { buildCityProductViews } from '@/game/selectors';
import type { BuyQuantity } from '@/game/types';
import { Icon } from '@/ui/components/Icon';
import { ProductCard } from '@/ui/components/ProductCard';
import { Card, SectionTitle, Text, Touchable } from '@/ui/components/primitives';
import { canOpenFreeCrate, canShowRewarded, rewardIsFree } from '@/services/ads';
import { palette, radius, spacing } from '@/ui/theme';

/**
 * FŐKÉPERNYŐ – „A stand”
 *
 * Elrendezés fentről lefelé, a fontosság sorrendjében:
 *   1. Város neve + vásárlási mennyiség kapcsoló
 *   2. Jutalomgombok (reklámért járó bónuszok) – opcionális, sosem tolakodó
 *   3. Termékkártyák
 *
 * A jutalomgombok szándékosan a lista FÖLÖTT vannak, de vizuálisan
 * halkabbak, mint a termékkártyák: elérhetők, de nem vonják el a figyelmet a
 * tényleges játékmenettől.
 */

const QUANTITIES: readonly BuyQuantity[] = [1, 10, 100, 'max'];

export function StandScreen() {
  // A `tick`-re iratkozunk fel: ez frissül 5 Hz-en, és ettől számolódnak
  // újra a terméknézetek.
  const tick = useGameStore((s) => s.tick);
  const state = useGameStore((s) => s.state);
  const multipliers = useGameStore((s) => s.multipliers);
  const busy = useGameStore((s) => s.busy);

  const tapProduct = useGameStore((s) => s.tapProduct);
  const buyProduct = useGameStore((s) => s.buyProduct);
  const hireManager = useGameStore((s) => s.hireManager);
  const setBuyQuantity = useGameStore((s) => s.setBuyQuantity);
  const watchRewarded = useGameStore((s) => s.watchRewarded);
  const openFreeCrate = useGameStore((s) => s.openFreeCrate);

  const city = getCity(state.activeCityId);

  const views = useMemo(
    () => buildCityProductViews(state, multipliers, state.activeCityId, Date.now()),
    // A `tick` szándékosan függőség: ez a "frissítsd újra" jelzés.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, state.activeCityId, state.settings.buyQuantity],
  );

  const handleTap = useCallback((id: string) => tapProduct(id), [tapProduct]);
  const handleBuy = useCallback((id: string) => buyProduct(id), [buyProduct]);
  const handleManager = useCallback((id: string) => hireManager(id), [hireManager]);

  const now = Date.now();
  const crateGate = canOpenFreeCrate(state, now);
  const doubleGate = canShowRewarded(state, 'doubleIncome', now);
  const turboGate = canShowRewarded(state, 'turbo', now);
  const adsFree = rewardIsFree(state);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      // Teljesítmény: a felület rövid, nem kell virtualizálás, de a
      // görgetés alatti újrarajzolást csökkentjük.
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
    >
      {/* --- Város + vásárlási mennyiség --- */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="caption" color={palette.textDim}>
            AKTUÁLIS HELYSZÍN
          </Text>
          <Text variant="title" color={palette.text}>
            {city.name}
          </Text>
        </View>

        <View style={styles.quantityRow}>
          {QUANTITIES.map((quantity) => {
            const active = state.settings.buyQuantity === quantity;
            return (
              <Pressable
                key={String(quantity)}
                onPress={() => setBuyQuantity(quantity)}
                accessibilityRole="button"
                accessibilityLabel={`Vásárlás ${quantity === 'max' ? 'maximum' : quantity} egységenként`}
                accessibilityState={{ selected: active }}
                style={[styles.quantityChip, active && styles.quantityChipActive]}
              >
                <Text
                  variant="caption"
                  color={active ? palette.bg : palette.textMuted}
                >
                  {quantity === 'max' ? 'MAX' : `×${quantity}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* --- Jutalomgombok --- */}
      <SectionTitle
        title="Ingyen bónuszok"
        hint={adsFree ? 'reklám nélkül' : 'videóért'}
      />
      <View style={styles.rewardRow}>
        <RewardTile
          icon="flame"
          color={palette.primary}
          title="Dupla bevétel"
          subtitle={doubleGate.allowed ? '15 perc' : (doubleGate.reason ?? '')}
          disabled={!doubleGate.allowed || busy}
          onPress={() => void watchRewarded('doubleIncome')}
        />
        <RewardTile
          icon="clock"
          color={palette.info}
          title="Turbó"
          subtitle={turboGate.allowed ? '10 perc' : (turboGate.reason ?? '')}
          disabled={!turboGate.allowed || busy}
          onPress={() => void watchRewarded('turbo')}
        />
        <RewardTile
          icon="crate"
          color={palette.premium}
          title="Láda"
          subtitle={
            crateGate.allowed
              ? 'Nyitható'
              : state.ads.nextFreeCrateAt > now
                ? formatCountdown((state.ads.nextFreeCrateAt - now) / 1000)
                : (crateGate.reason ?? '')
          }
          disabled={!crateGate.allowed || busy}
          onPress={() => void openFreeCrate()}
        />
      </View>

      {/* --- Termékek --- */}
      <SectionTitle title="Kínálat" hint={`${views.filter((v) => v.state.level > 0).length}/${views.length}`} />
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
          Menedzser nélkül a termék offline nem termel. Ha csak egy dologra van
          pénzed, szinte mindig a menedzser a jobb választás.
        </Text>
      </Card>
    </ScrollView>
  );
}

function RewardTile({
  icon,
  color,
  title,
  subtitle,
  disabled,
  onPress,
}: {
  icon: 'flame' | 'clock' | 'crate';
  color: string;
  title: string;
  subtitle: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={[styles.rewardTile, disabled && styles.rewardTileOff]}
    >
      <Icon name={icon} size={22} color={color} tint={palette.surfaceSunken} />
      <Text variant="caption" color={palette.text} style={{ marginTop: 6 }} numberOfLines={1}>
        {title}
      </Text>
      <Text variant="caption" color={palette.textDim} numberOfLines={1}>
        {subtitle}
      </Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.sm,
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
  rewardRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rewardTile: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    minHeight: 84,
    justifyContent: 'center',
  },
  rewardTileOff: {
    opacity: 0.45,
  },
  tipCard: {
    marginTop: spacing.md,
    backgroundColor: palette.surfaceSunken,
  },
});
