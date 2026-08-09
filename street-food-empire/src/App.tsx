import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { CITIES } from '@/game/content/cities';
import { EQUIPMENT, nextTier } from '@/game/content/equipment';
import { PRODUCTS } from '@/game/content/products';
import { allQuestsClaimed, questProgress } from '@/game/progression';
import { buildCityProductViews, cityUnlockStatus } from '@/game/selectors';
import { useGameStore } from '@/game/store';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { CafeScene } from '@/ui/components/CafeScene';
import { Dock, RewardRail, type PanelKey } from '@/ui/components/Dock';
import { BoosterStrip, Hud } from '@/ui/components/Hud';
import { ToastHost } from '@/ui/components/Overlays';
import { Sheet } from '@/ui/components/Sheet';
import { Button, Text } from '@/ui/components/primitives';
import { GameModals } from '@/ui/modals/GameModals';
import { CitiesScreen } from '@/ui/screens/CitiesScreen';
import { MissionsScreen } from '@/ui/screens/MissionsScreen';
import { ProductsPanel } from '@/ui/screens/ProductsPanel';
import { SettingsScreen } from '@/ui/screens/SettingsScreen';
import { ShopScreen } from '@/ui/screens/ShopScreen';
import { StaffScreen } from '@/ui/screens/StaffScreen';
import { UpgradesScreen } from '@/ui/screens/UpgradesScreen';
import { useEnter } from '@/ui/motion';
import { palette, spacing } from '@/ui/theme';

/**
 * GYÖKÉRKOMPONENS
 *
 * A képernyő MAGA A JÁTÉK: a kávézó teljes méretben fut, és soha nem tűnik el.
 * A fejléc rálebeg, a jutalomgombok az oldalán ülnek, a menüpontok pedig
 * felcsúszó panelként úsznak rá — a macskák közben tovább jönnek-mennek.
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

const PANEL_TITLES: Record<PanelKey | 'settings', { title: string; subtitle?: string }> = {
  products: { title: 'Kínálat', subtitle: 'Termékek és menedzserek' },
  upgrades: { title: 'Gépek', subtitle: 'Berendezés fejlesztése' },
  staff: { title: 'Csapat', subtitle: 'Automatizálás és bónuszok' },
  cities: { title: 'Helyszínek', subtitle: 'Költözés és franchise' },
  missions: { title: 'Küldetések', subtitle: 'Napi feladatok és eredmények' },
  shop: { title: 'Bolt', subtitle: 'Food Coin, kinézet, támogatás' },
  settings: { title: 'Beállítások' },
};

function GameShell() {
  const [panel, setPanel] = useState<PanelKey | 'settings' | null>(null);

  const state = useGameStore((s) => s.state);
  const multipliers = useGameStore((s) => s.multipliers);
  const customers = useGameStore((s) => s.customers);
  const tick = useGameStore((s) => s.tick);
  const serveCustomer = useGameStore((s) => s.serveCustomer);

  const views = useMemo(
    () => buildCityProductViews(state, multipliers, state.activeCityId, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, state.activeCityId, state.settings.buyQuantity],
  );

  const badges = useDockBadges();

  return (
    <View style={styles.shell}>
      {/* --- A játék: mindig fut, mindig látszik --- */}
      <CafeScene
        customers={customers}
        views={views}
        cityId={state.activeCityId}
        onServe={serveCustomer}
      />

      {/* --- Rálebegő felület --- */}
      <SafeAreaView style={styles.overlay} edges={['top']} pointerEvents="box-none">
        <Hud onSettings={() => setPanel('settings')} />
        <BoosterStrip />
      </SafeAreaView>

      <RewardRail />

      <View style={styles.dockWrap} pointerEvents="box-none">
        <Dock
          active={panel === 'settings' ? null : panel}
          onOpen={(key) => setPanel((current) => (current === key ? null : key))}
          badges={badges}
        />
      </View>

      {/* --- Felcsúszó panelek --- */}
      <Sheet
        visible={panel !== null}
        title={panel ? PANEL_TITLES[panel].title : ''}
        subtitle={panel ? PANEL_TITLES[panel].subtitle : undefined}
        onClose={() => setPanel(null)}
      >
        <PanelContent panel={panel} onClose={() => setPanel(null)} />
      </Sheet>

      <ToastHost />
      <GameModals />
    </View>
  );
}

function PanelContent({
  panel,
  onClose,
}: {
  panel: PanelKey | 'settings' | null;
  onClose: () => void;
}) {
  switch (panel) {
    case 'products':
      return <ProductsPanel />;
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
    case 'settings':
      return <SettingsScreen onClose={onClose} />;
    default:
      return null;
  }
}

/**
 * Hol van tennivaló? A pöttyök ezt jelzik a dokkon.
 *
 * Szándékosan csak olyat jelzünk, ami **most, ingyen vagy megfizethetően**
 * elvégezhető — különben a pötty állandóan égne, és a játékos megtanulná
 * figyelmen kívül hagyni.
 */
function useDockBadges(): Partial<Record<PanelKey, boolean>> {
  useGameStore((s) => s.tick);
  const state = useGameStore((s) => s.state);

  const questReady =
    state.daily.quests.some((quest) => {
      const progress = questProgress(state, quest);
      return progress?.complete && !progress.claimed;
    }) || (allQuestsClaimed(state) && !state.daily.allClaimedBonusTaken);

  const cityReady = CITIES.some((city) => cityUnlockStatus(state, city.id).affordable);

  const equipmentReady = EQUIPMENT.some((equipment) => {
    const tier = nextTier(equipment, state.equipment[equipment.id] ?? 0);
    return tier ? state.cash >= tier.cost : false;
  });

  const managerReady = PRODUCTS.some((def) => {
    const product = state.products[def.id];
    if (!product || product.level <= 0 || product.hasManager) return false;
    return state.cash >= def.managerCost;
  });

  return {
    missions: questReady,
    cities: cityReady,
    upgrades: equipmentReady,
    staff: managerReady,
  };
}

// ---------------------------------------------------------------------------
// Indítás
// ---------------------------------------------------------------------------

function BootScreen() {
  const { opacity, translateY } = useEnter();

  return (
    <View style={styles.boot}>
      <Animated.View style={{ opacity, transform: [{ translateY }] }}>
        <Text variant="display" color={palette.primary} align="center">
          Street Food
        </Text>
        <Text variant="title" color={palette.accent} align="center">
          EMPIRE
        </Text>
      </Animated.View>
      <ActivityIndicator color={palette.primary} style={{ marginTop: spacing.xl }} />
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
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  dockWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  boot: {
    flex: 1,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
