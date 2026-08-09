import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { formatDuration, formatMoney, formatNumber } from '@/core/format';
import { useGameStore } from '@/game/store';
import { adService } from '@/services/ads';
import { iapService } from '@/services/iap';
import { ModalShell } from '@/ui/components/Overlays';
import { Button, Card, Divider, SectionTitle, Text } from '@/ui/components/primitives';
import { palette, spacing } from '@/ui/theme';

/**
 * BEÁLLÍTÁSOK
 *
 * Tartalmazza a store-ok által megkövetelt elemeket is:
 *  - személyre szabott reklám ki/be (GDPR, ATT),
 *  - vásárlások visszaállítása (App Store követelmény),
 *  - és egy egyértelmű, kétlépcsős adattörlést.
 */
export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const state = useGameStore((s) => s.state);
  const toggleSetting = useGameStore((s) => s.toggleSetting);
  const hardReset = useGameStore((s) => s.hardReset);
  const restore = useGameStore((s) => s.restorePurchases);
  const busy = useGameStore((s) => s.busy);

  const [resetOpen, setResetOpen] = useState(false);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SectionTitle title="Settings" />

      <Card>
        <SettingRow
          label="Sound"
          hint="Sound effects when serving and buying"
          value={state.settings.sound}
          onChange={() => toggleSetting('sound')}
        />
        <Divider />
        <SettingRow
          label="Haptics"
          hint="Feedback on every tap"
          value={state.settings.haptics}
          onChange={() => toggleSetting('haptics')}
        />
        <Divider />
        <SettingRow
          label="Reduced motion"
          hint="Smoother on weaker devices"
          value={state.settings.reducedMotion}
          onChange={() => toggleSetting('reducedMotion')}
        />
        <Divider />
        <SettingRow
          label="Personalised ads"
          hint="Rewards stay the same when this is off"
          value={state.settings.personalizedAds}
          onChange={() => toggleSetting('personalizedAds')}
        />
      </Card>

      <SectionTitle title="Statistics" />
      <Card>
        <StatRow label="Total earnings" value={formatMoney(state.stats.lifetimeEarnings)} />
        <StatRow label="This run" value={formatMoney(state.runEarnings)} />
        <StatRow label="Hand-served orders" value={formatNumber(state.stats.totalTaps)} />
        <StatRow label="Levels bought" value={formatNumber(state.stats.totalLevelsBought)} />
        <StatRow label="Managers" value={formatNumber(state.stats.managersHired)} />
        <StatRow label="Franchise" value={formatNumber(state.franchiseCount)} />
        <StatRow label="Quests completed" value={formatNumber(state.stats.questsCompleted)} />
        <StatRow
          label="Offline cap"
          value={formatDuration(useGameStore.getState().multipliers.offlineCapHours * 3600)}
        />
      </Card>

      <SectionTitle title="Purchases" />
      <Card>
        <Text variant="caption" color={palette.textDim} style={{ marginBottom: spacing.md }}>
          If you play on a new device or reinstalled the game, you can bring
          back your earlier purchases here.
        </Text>
        <Button
          label="Restore purchases"
          tone="secondary"
          disabled={busy}
          onPress={() => void restore()}
        />
      </Card>

      <SectionTitle title="Danger zone" />
      <Card>
        <Text variant="caption" color={palette.textDim} style={{ marginBottom: spacing.md }}>
          Deleting wipes all progress: cash, cities, stars, achievements. The
          packs you purchased are kept.
        </Text>
        <Button label="Delete game" tone="danger" onPress={() => setResetOpen(true)} />
      </Card>

      <Card style={styles.debugCard}>
        <Text variant="caption" color={palette.textDim}>
          Ad provider: {adService.name}
          {adService.isMock ? ' (teszt)' : ''}
        </Text>
        <Text variant="caption" color={palette.textDim}>
          Store: {iapService.isMock ? 'test' : 'live'} · {iapService.currentState}
        </Text>
      </Card>

      <Button label="Back to the game" tone="ghost" onPress={onClose} style={{ marginTop: spacing.lg }} />

      <ModalShell
        visible={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Delete everything?"
      >
        <Text variant="body" color={palette.textMuted}>
          This cannot be undone. All your progress is lost and the game starts
          from the very beginning.
        </Text>
        <View style={{ flexDirection: 'row', marginTop: spacing.xl }}>
          <Button
            label="Cancel"
            tone="ghost"
            onPress={() => setResetOpen(false)}
            style={{ flex: 1 }}
          />
          <Button
            label="Delete"
            tone="danger"
            onPress={() => {
              setResetOpen(false);
              void hardReset();
              onClose();
            }}
            style={{ flex: 1, marginLeft: spacing.sm }}
          />
        </View>
      </ModalShell>
    </ScrollView>
  );
}

function SettingRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text variant="label" color={palette.text}>
          {label}
        </Text>
        <Text variant="caption" color={palette.textDim}>
          {hint}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: palette.surfaceSunken, true: palette.primary }}
        thumbColor={palette.text}
        accessibilityLabel={label}
      />
    </View>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text variant="caption" color={palette.textMuted}>
        {label}
      </Text>
      <Text variant="label" color={palette.text}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  debugCard: { marginTop: spacing.lg, backgroundColor: palette.surfaceSunken },
});
