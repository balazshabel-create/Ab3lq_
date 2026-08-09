import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { formatNumber } from '@/core/format';
import { COIN_SPENDS, COSMETICS, IAP_PRODUCTS } from '@/game/content/shop';
import { useGameStore } from '@/game/store';
import { iapService } from '@/services/iap';
import { Icon, type IconName } from '@/ui/components/Icon';
import {
  Badge,
  Button,
  Card,
  SectionTitle,
  Text,
  Touchable,
} from '@/ui/components/primitives';
import { palette, radius, spacing } from '@/ui/theme';

/**
 * BOLT KÉPERNYŐ
 *
 * Sorrend tudatos: **először a Food Coinért kapható dolgok** (amit ingyen is
 * meg lehet szerezni), és csak utána a valódi pénzes csomagok. Ez nem csak
 * etikus, hanem jobban is konvertál: a játékos előbb megtanulja, mire jó a
 * prémium valuta, mielőtt vásárolna.
 *
 * Az App Store megköveteli a „Vásárlások visszaállítása” gombot minden olyan
 * appban, ami nem fogyó terméket árul — ez a képernyő alján van.
 */
export function ShopScreen() {
  const tick = useGameStore((s) => s.tick);
  const state = useGameStore((s) => s.state);
  const busy = useGameStore((s) => s.busy);
  const spendCoins = useGameStore((s) => s.spendCoins);
  const purchase = useGameStore((s) => s.purchase);
  const restore = useGameStore((s) => s.restorePurchases);
  const buyCosmetic = useGameStore((s) => s.buyCosmetic);
  const equipCosmetic = useGameStore((s) => s.equipCosmetic);

  // A store-ból érkező lokalizált árak aszinkron töltődnek be.
  const [prices, setPrices] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void iapService.initialize().then(() => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const product of IAP_PRODUCTS) next[product.sku] = iapService.priceFor(product.sku);
      setPrices(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} removeClippedSubviews>
      {/* --- Food Coin költés --- */}
      <SectionTitle title="Food Coin ajánlatok" hint={`${formatNumber(state.coins)} érme`} />

      {COIN_SPENDS.map((spend) => {
        const affordable = state.coins >= spend.coinCost;
        return (
          <Card key={`${spend.id}-${tick % 2}`} style={styles.row}>
            <View style={styles.iconBox}>
              <Icon
                name={spend.icon as IconName}
                size={20}
                color={palette.coin}
                tint={palette.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label" color={palette.text}>
                {spend.name}
              </Text>
              <Text variant="caption" color={palette.textDim}>
                {spend.description}
              </Text>
            </View>
            <Button
              label={`${spend.coinCost}`}
              compact
              icon={<Icon name="coin" size={14} color={affordable ? '#241304' : palette.textDim} />}
              tone={affordable ? 'primary' : 'ghost'}
              disabled={!affordable || busy}
              onPress={() => spendCoins(spend.id)}
              style={{ marginLeft: spacing.md, minWidth: 84 }}
            />
          </Card>
        );
      })}

      {/* --- Kinézetek --- */}
      <SectionTitle title="Kinézet" hint="csak vizuális" />
      <View style={styles.cosmeticRow}>
        {COSMETICS.map((cosmetic) => {
          const owned = state.ownedCosmeticIds.includes(cosmetic.id);
          const active = state.settings.activeCosmetic === cosmetic.id;
          const goldLocked =
            cosmetic.id === 'cosmetic.gold' && !state.entitlements.includes('goldenCounter');

          return (
            <Touchable
              key={cosmetic.id}
              accessibilityRole="button"
              accessibilityLabel={cosmetic.name}
              disabled={goldLocked || busy}
              onPress={() => (owned ? equipCosmetic(cosmetic.id) : buyCosmetic(cosmetic.id))}
              style={[
                styles.cosmeticTile,
                active && { borderColor: cosmetic.palette.primary, borderWidth: 2 },
                goldLocked && { opacity: 0.4 },
              ]}
            >
              <View style={styles.swatchRow}>
                <View style={[styles.swatch, { backgroundColor: cosmetic.palette.primary }]} />
                <View style={[styles.swatch, { backgroundColor: cosmetic.palette.secondary }]} />
                <View style={[styles.swatch, { backgroundColor: cosmetic.palette.accent }]} />
              </View>
              <Text variant="caption" color={palette.text} numberOfLines={1}>
                {cosmetic.name}
              </Text>
              <Text variant="caption" color={palette.textDim}>
                {active ? 'Aktív' : owned ? 'Beállít' : goldLocked ? 'Zárt' : `${cosmetic.coinCost} érme`}
              </Text>
            </Touchable>
          );
        })}
      </View>

      {/* --- IAP --- */}
      <SectionTitle title="Támogatás" hint="valódi vásárlás" />

      {IAP_PRODUCTS.map((product) => {
        const owned = product.entitlement
          ? state.entitlements.includes(product.entitlement)
          : false;

        return (
          <Card key={`${product.sku}-${tick % 2}`} style={styles.iapCard}>
            <View style={styles.iapHeader}>
              <Text variant="heading" color={palette.text} style={{ flex: 1 }}>
                {product.name}
              </Text>
              {product.badge ? (
                <Badge label={product.badge} color={palette.premium} textColor="#1B0B22" />
              ) : null}
            </View>

            <Text variant="caption" color={palette.textMuted} style={{ marginVertical: spacing.sm }}>
              {product.description}
            </Text>

            <Button
              label={owned ? 'Megvásárolva' : (prices[product.sku] ?? product.fallbackPrice)}
              tone={owned ? 'ghost' : product.type === 'nonConsumable' ? 'premium' : 'primary'}
              disabled={owned || busy}
              onPress={() => void purchase(product.sku)}
            />
          </Card>
        );
      })}

      <Button
        label="Vásárlások visszaállítása"
        tone="ghost"
        disabled={busy}
        onPress={() => void restore()}
        style={{ marginTop: spacing.md }}
      />

      <Text variant="caption" color={palette.textDim} align="center" style={styles.disclaimer}>
        A játék teljes egészében végigjátszható vásárlás nélkül. A Food Coin
        küldetésekből, eredményekből és ládákból is gyűjthető.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: palette.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  cosmeticRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cosmeticTile: {
    width: '48%',
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
  },
  swatchRow: { flexDirection: 'row', marginBottom: spacing.sm },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginRight: 4,
  },
  iapCard: { marginBottom: spacing.md, padding: spacing.md },
  iapHeader: { flexDirection: 'row', alignItems: 'center' },
  disclaimer: { marginTop: spacing.lg, paddingHorizontal: spacing.md },
});
