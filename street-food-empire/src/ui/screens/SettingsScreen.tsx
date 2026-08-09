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
      <SectionTitle title="Beállítások" />

      <Card>
        <SettingRow
          label="Hang"
          hint="Effektek a kiszolgálásnál és vásárlásnál"
          value={state.settings.sound}
          onChange={() => toggleSetting('sound')}
        />
        <Divider />
        <SettingRow
          label="Rezgés"
          hint="Visszajelzés koppintásnál"
          value={state.settings.haptics}
          onChange={() => toggleSetting('haptics')}
        />
        <Divider />
        <SettingRow
          label="Csökkentett animáció"
          hint="Gyengébb készüléken simább futás"
          value={state.settings.reducedMotion}
          onChange={() => toggleSetting('reducedMotion')}
        />
        <Divider />
        <SettingRow
          label="Személyre szabott reklám"
          hint="Kikapcsolva is ugyanannyi jutalom jár"
          value={state.settings.personalizedAds}
          onChange={() => toggleSetting('personalizedAds')}
        />
      </Card>

      <SectionTitle title="Statisztika" />
      <Card>
        <StatRow label="Összes bevétel" value={formatMoney(state.stats.lifetimeEarnings)} />
        <StatRow label="Ebben a futásban" value={formatMoney(state.runEarnings)} />
        <StatRow label="Kézi kiszolgálás" value={formatNumber(state.stats.totalTaps)} />
        <StatRow label="Megvett szintek" value={formatNumber(state.stats.totalLevelsBought)} />
        <StatRow label="Menedzserek" value={formatNumber(state.stats.managersHired)} />
        <StatRow label="Franchise" value={formatNumber(state.franchiseCount)} />
        <StatRow label="Teljesített küldetés" value={formatNumber(state.stats.questsCompleted)} />
        <StatRow
          label="Offline sapka"
          value={formatDuration(useGameStore.getState().multipliers.offlineCapHours * 3600)}
        />
      </Card>

      <SectionTitle title="Vásárlások" />
      <Card>
        <Text variant="caption" color={palette.textDim} style={{ marginBottom: spacing.md }}>
          Ha új készüléken játszol, vagy újratelepítetted a játékot, itt tudod
          visszahozni a korábbi vásárlásaidat.
        </Text>
        <Button
          label="Vásárlások visszaállítása"
          tone="secondary"
          disabled={busy}
          onPress={() => void restore()}
        />
      </Card>

      <SectionTitle title="Veszélyzóna" />
      <Card>
        <Text variant="caption" color={palette.textDim} style={{ marginBottom: spacing.md }}>
          A törlés minden haladást elvisz: pénz, városok, csillagok, eredmények.
          A megvásárolt csomagok megmaradnak.
        </Text>
        <Button label="Játék törlése" tone="danger" onPress={() => setResetOpen(true)} />
      </Card>

      <Card style={styles.debugCard}>
        <Text variant="caption" color={palette.textDim}>
          Reklámszolgáltató: {adService.name}
          {adService.isMock ? ' (teszt)' : ''}
        </Text>
        <Text variant="caption" color={palette.textDim}>
          Bolt: {iapService.isMock ? 'teszt' : 'éles'} · {iapService.currentState}
        </Text>
      </Card>

      <Button label="Vissza a játékhoz" tone="ghost" onPress={onClose} style={{ marginTop: spacing.lg }} />

      <ModalShell
        visible={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Biztosan törlöd?"
      >
        <Text variant="body" color={palette.textMuted}>
          Ez a művelet nem vonható vissza. Minden haladásod elvész, és a játék
          a legelejéről indul.
        </Text>
        <View style={{ flexDirection: 'row', marginTop: spacing.xl }}>
          <Button
            label="Mégsem"
            tone="ghost"
            onPress={() => setResetOpen(false)}
            style={{ flex: 1 }}
          />
          <Button
            label="Törlés"
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
