import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { formatMoney, formatPercent } from '@/core/format';
import { productsOfCity } from '@/game/content/products';
import { STAFF, staffLevelCost } from '@/game/content/staff';
import { useGameStore } from '@/game/store';
import { Icon, type IconName } from '@/ui/components/Icon';
import {
  Badge,
  Button,
  Card,
  ProgressBar,
  SectionTitle,
  Text,
} from '@/ui/components/primitives';
import { palette, radius, spacing } from '@/ui/theme';

/**
 * CSAPAT KÉPERNYŐ
 *
 * Két blokk:
 *  1. **Menedzserek** – az automatizálás állapota városonként. Ez a
 *     legfontosabb információ a képernyőn, mert az offline bevétel ettől függ.
 *  2. **Szerepkörök** – szintezhető alkalmazottak globális bónuszokkal.
 */
export function StaffScreen() {
  const tick = useGameStore((s) => s.tick);
  const state = useGameStore((s) => s.state);
  const hireStaff = useGameStore((s) => s.hireStaff);
  const hireManager = useGameStore((s) => s.hireManager);

  const managerRows = state.unlockedCityIds.flatMap((cityId) =>
    productsOfCity(cityId)
      .filter((def) => (state.products[def.id]?.level ?? 0) > 0)
      .map((def) => ({ def, productState: state.products[def.id]! })),
  );

  const automated = managerRows.filter((row) => row.productState.hasManager).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} removeClippedSubviews>
      {/* --- Automatizálás --- */}
      <SectionTitle
        title="Automatizálás"
        hint={`${automated}/${managerRows.length} termék`}
      />
      <Card style={styles.summaryCard}>
        <ProgressBar
          progress={managerRows.length > 0 ? automated / managerRows.length : 0}
          color={palette.success}
          height={10}
        />
        <Text variant="caption" color={palette.textDim} style={{ marginTop: spacing.sm }}>
          Csak a menedzserrel ellátott termékek termelnek, amíg zárva vagy.
        </Text>
      </Card>

      {managerRows
        .filter((row) => !row.productState.hasManager)
        .map((row) => (
          <Card key={`${row.def.id}-${tick % 2}`} style={styles.managerCard}>
            <View style={{ flex: 1 }}>
              <Text variant="label" color={palette.text} numberOfLines={1}>
                {row.def.name}
              </Text>
              <Text variant="caption" color={palette.textDim}>
                Kézi kiszolgálás — nincs offline bevétel
              </Text>
            </View>
            <Button
              label="Felvesz"
              sublabel={formatMoney(row.def.managerCost)}
              compact
              tone={state.cash >= row.def.managerCost ? 'success' : 'secondary'}
              disabled={state.cash < row.def.managerCost}
              onPress={() => hireManager(row.def.id)}
            />
          </Card>
        ))}

      {/* --- Szerepkörök --- */}
      <SectionTitle title="Alkalmazottak" hint="globális bónuszok" />

      {STAFF.map((def) => {
        const level = state.staff[def.id] ?? 0;
        const cost = staffLevelCost(def, level);
        const maxed = level >= def.maxLevel;
        const affordable = !maxed && state.cash >= cost;
        const totalEffect = def.effectPerLevel.value * level;

        return (
          <Card key={`${def.id}-${tick % 2}`} style={styles.card}>
            <View style={styles.header}>
              <View style={styles.iconBox}>
                <Icon
                  name={def.icon as IconName}
                  size={22}
                  color={palette.primary}
                  tint={palette.accent}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="heading" color={palette.text}>
                  {def.name}
                </Text>
                <Text variant="caption" color={palette.textDim}>
                  {def.description}
                </Text>
              </View>
              <Badge
                label={maxed ? 'MAX' : `${level}/${def.maxLevel}`}
                color={maxed ? palette.success : palette.surfaceSunken}
                textColor={maxed ? '#08240F' : palette.textMuted}
              />
            </View>

            <View style={styles.effectRow}>
              <Text variant="caption" color={palette.textMuted}>
                Jelenleg: {level > 0 ? formatPercent(totalEffect) : '—'}
              </Text>
              <Text variant="caption" color={palette.success}>
                Következő szint: {formatPercent(def.effectPerLevel.value)}
              </Text>
            </View>

            <Button
              label={maxed ? 'Kimaxolva' : 'Szintlépés'}
              sublabel={maxed ? undefined : formatMoney(cost)}
              tone={maxed ? 'ghost' : 'primary'}
              disabled={maxed || !affordable}
              onPress={() => hireStaff(def.id)}
            />
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  summaryCard: { marginBottom: spacing.md },
  managerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  card: { marginBottom: spacing.md, padding: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  effectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
});
