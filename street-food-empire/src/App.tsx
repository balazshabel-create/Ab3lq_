import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useGameStore } from '@/game/store';
import { allQuestsClaimed, questProgress } from '@/game/progression';
import { canOpenFreeCrate } from '@/services/ads';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/components/Icon';
import { ToastHost } from '@/ui/components/Overlays';
import { TabBar, type TabKey } from '@/ui/components/TabBar';
import { BoosterBar, TopBar } from '@/ui/components/TopBar';
import { Button, Text } from '@/ui/components/primitives';
import { GameModals } from '@/ui/modals/GameModals';
import { CitiesScreen } from '@/ui/screens/CitiesScreen';
import { MissionsScreen } from '@/ui/screens/MissionsScreen';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { ShopScreen } from '@/ui/screens/ShopScreen';
import { StaffScreen } from '@/ui/screens/StaffScreen';
import { StandScreen } from '@/ui/screens/StandScreen';
import { UpgradesScreen } from '@/ui/screens/UpgradesScreen';
import { palette, spacing } from '@/ui/theme';

/**
 * GYÖKÉRKOMPONENS
 *
 * Felelősségei szigorúan korlátozottak: betöltés, hibakezelés, navigáció.
 * Minden játéklogika a store-ban van, minden megjelenítés a képernyőkben.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <StatusBar style="light" />
        <GameRoot />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function GameRoot() {
  const status = useGameStore((s) => s.status);
  const bootError = useGameStore((s) => s.bootError);
  const boot = useGameStore((s) => s.boot);
  const shutdown = useGameStore((s) => s.shutdown);

  useEffect(() => {
    void boot();
    return () => shutdown();
    // Csak egyszer, az app életciklusa alatt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'booting') return <BootScreen />;
  if (status === 'error') return <BootErrorScreen message={bootError} onRetry={() => void boot()} />;

  return <GameShell />;
}

function GameShell() {
  const [tab, setTab] = useState<TabKey>('stand');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const state = useGameStore((s) => s.state);
  // A `tick`-re való feliratkozás tartja frissen a fül-jelzéseket (pötty):
  // enélkül a küldetés teljesítése után csak fülváltáskor jelenne meg.
  useGameStore((s) => s.tick);

  // Fül-jelzések: hol vár felvehető jutalom vagy elérhető lépés?
  const questsReady = state.daily.quests.some((quest) => {
    const progress = questProgress(state, quest);
    return progress?.complete && !progress.claimed;
  });
  const crateReady = canOpenFreeCrate(state, Date.now()).allowed;
  const dailyBonusReady = allQuestsClaimed(state) && !state.daily.allClaimedBonusTaken;

  const badges: Partial<Record<TabKey, boolean>> = {
    missions: questsReady || dailyBonusReady,
    stand: crateReady,
  };

  return (
    <SafeAreaView style={styles.shell} edges={['top']}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <TopBar />
        </View>
        <Pressable
          onPress={() => setSettingsOpen(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Beállítások"
          style={styles.settingsButton}
        >
          <Icon name="settings" size={22} color={palette.textMuted} />
        </Pressable>
      </View>

      <BoosterBar />

      <View style={styles.screenArea}>
        {settingsOpen ? (
          <SettingsScreen onClose={() => setSettingsOpen(false)} />
        ) : (
          <Screen tab={tab} />
        )}
      </View>

      {!settingsOpen ? <TabBar active={tab} onChange={setTab} badges={badges} /> : null}

      <ToastHost />
      <GameModals />
    </SafeAreaView>
  );
}

function Screen({ tab }: { tab: TabKey }) {
  switch (tab) {
    case 'stand':
      return <StandScreen />;
    case 'upgrades':
      return <UpgradesScreen />;
    case 'staff':
      return <StaffScreen />;
    case 'cities':
      return <CitiesScreen />;
    case 'missions':
      return <MissionsScreen />;
    case 'shop':
      return <ShopScreen />;
    default:
      return <StandScreen />;
  }
}

function BootScreen() {
  return (
    <View style={styles.boot}>
      <Text variant="display" color={palette.primary}>
        Street Food
      </Text>
      <Text variant="title" color={palette.accent} style={{ marginBottom: spacing.xl }}>
        EMPIRE
      </Text>
      <ActivityIndicator color={palette.primary} />
      <Text variant="caption" color={palette.textDim} style={{ marginTop: spacing.lg }}>
        Kinyitunk…
      </Text>
    </View>
  );
}

function BootErrorScreen({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <View style={styles.boot}>
      <Text variant="title" color={palette.danger} align="center">
        Nem sikerült elindulni
      </Text>
      <Text
        variant="caption"
        color={palette.textDim}
        align="center"
        style={{ marginVertical: spacing.lg, paddingHorizontal: spacing.xl }}
      >
        {message ?? 'Ismeretlen hiba.'}
      </Text>
      <Button label="Újrapróbálom" tone="primary" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surface,
  },
  settingsButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  screenArea: {
    flex: 1,
  },
  boot: {
    flex: 1,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
