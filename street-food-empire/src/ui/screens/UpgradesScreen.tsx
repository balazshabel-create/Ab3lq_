import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { formatMoney } from '@/core/format';
import { EQUIPMENT, nextTier, tierAt } from '@/game/content/equipment';
import { useGameStore } from '@/game/store';
import { Icon, type IconName } from '@/ui/components/Icon';
import { Badge, Button, Card, SectionTitle, Text } from '@/ui/components/primitives';
import { palette, radius, spacing } from '@/ui/theme';

/**
 * MACHINES SCREEN
 *
 * One machine = one card. Always visible:
 *   - mit ad a JELENLEGI szint (ha van),
 *   - and what the next tier would give, and for how much.
 *
 * That pairing matters: without it the player cannot judge whether an upgrade
 * is worth it, and ends up buying nothing.
 */
export function UpgradesScreen() {
  const tick = useGameStore((s) => s.tick);
  const state = useGameStore((s) => s.state);
  const buyEquipment = useGameStore((s) => s.buyEquipment);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} removeClippedSubviews>
      <SectionTitle title="Machines and equipment" hint={`${EQUIPMENT.length} total`} />

      {EQUIPMENT.map((equipment) => {
        const owned = state.equipment[equipment.id] ?? 0;
        const current = tierAt(equipment, owned);
        const next = nextTier(equipment, owned);
        const affordable = next ? state.cash >= next.cost : false;

        return (
          <Card key={`${equipment.id}-${tick % 2}`} style={styles.card}>
            <View style={styles.header}>
              <View style={styles.iconBox}>
                <Icon
                  name={equipment.icon as IconName}
                  size={22}
                  color={palette.primary}
                  tint={palette.accent}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="heading" color={palette.text}>
                  {equipment.name}
                </Text>
                <Text variant="caption" color={palette.textDim}>
                  {owned > 0 ? `Tier ${owned} / ${equipment.tiers.length}` : 'Not owned yet'}
                </Text>
              </View>
              {owned >= equipment.tiers.length ? (
                <Badge label="MAX" color={palette.success} textColor="#08240F" />
              ) : null}
            </View>

            {current ? (
              <View style={styles.currentRow}>
                <Icon name="check" size={14} color={palette.success} />
                <Text variant="caption" color={palette.success} style={{ marginLeft: 6, flex: 1 }}>
                  {current.name} — {current.description}
                </Text>
              </View>
            ) : null}

            {next ? (
              <>
                <View style={styles.nextRow}>
                  <Text variant="label" color={palette.text}>
                    {next.name}
                  </Text>
                  <Text variant="caption" color={palette.textMuted}>
                    {next.description}
                  </Text>
                </View>
                <Button
                  label="Upgrade"
                  sublabel={formatMoney(next.cost)}
                  tone="primary"
                  disabled={!affordable}
                  onPress={() => buyEquipment(equipment.id)}
                />
              </>
            ) : (
              <Text variant="caption" color={palette.textDim}>
                This machine is fully upgraded.
              </Text>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
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
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceSunken,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  nextRow: { marginBottom: spacing.md },
});
