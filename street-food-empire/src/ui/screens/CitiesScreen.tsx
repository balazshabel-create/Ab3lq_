import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { formatMoney, formatMultiplier, formatNumber } from '@/core/format';
import { CITIES } from '@/game/content/cities';
import { FRANCHISE_PERKS } from '@/game/content/franchise';
import { franchisePreview } from '@/game/actions';
import { earningsForNextStar } from '@/game/economy';
import { cityUnlockStatus } from '@/game/selectors';
import { useGameStore } from '@/game/store';
import { Icon } from '@/ui/components/Icon';
import { ModalShell } from '@/ui/components/Overlays';
import {
  Badge,
  Button,
  Card,
  Divider,
  ProgressBar,
  SectionTitle,
  Text,
  Touchable,
} from '@/ui/components/primitives';
import { palette, radius, spacing } from '@/ui/theme';

/**
 * VÁROSOK + FRANCHISE KÉPERNYŐ
 *
 * A városok a "középtávú" cél, a franchise a "hosszú távú". Egy képernyőn
 * vannak, mert mindkettő ugyanarra a kérdésre válaszol: *hova tartok most?*
 *
 * A franchise gomb szándékosan kétlépcsős (megerősítő ablak): ez a játék
 * egyetlen visszafordíthatatlan lépése.
 */
export function CitiesScreen() {
  const tick = useGameStore((s) => s.tick);
  const state = useGameStore((s) => s.state);
  const selectCity = useGameStore((s) => s.selectCity);
  const unlockCity = useGameStore((s) => s.unlockCity);
  const buyPerk = useGameStore((s) => s.buyPerk);
  const franchise = useGameStore((s) => s.franchise);
  const busy = useGameStore((s) => s.busy);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const preview = franchisePreview(state);
  const toNextStar = earningsForNextStar(state.runEarnings);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} removeClippedSubviews>
      <SectionTitle
        title="Helyszínek"
        hint={`${state.unlockedCityIds.length}/${CITIES.length}`}
      />

      {CITIES.map((city) => {
        const status = cityUnlockStatus(state, city.id);
        const isActive = state.activeCityId === city.id;

        return (
          <Touchable
            key={`${city.id}-${tick % 2}`}
            onPress={() => (status.unlocked ? selectCity(city.id) : undefined)}
            accessibilityRole="button"
            accessibilityLabel={city.name}
            disabled={!status.unlocked}
          >
            <Card
              style={[
                styles.cityCard,
                isActive && { borderColor: city.colors[0], borderWidth: 2 },
              ]}
            >
              <View style={styles.cityHeader}>
                <View style={[styles.cityDot, { backgroundColor: city.colors[0] }]} />
                <View style={{ flex: 1 }}>
                  <Text variant="heading" color={status.unlocked ? palette.text : palette.textMuted}>
                    {city.name}
                  </Text>
                  <Text variant="caption" color={palette.textDim}>
                    {city.tagline}
                  </Text>
                </View>
                {isActive ? (
                  <Badge label="AKTÍV" color={city.colors[0]} textColor="#1A0E03" />
                ) : status.unlocked ? (
                  <Icon name="check" size={18} color={palette.success} />
                ) : (
                  <Icon name="lock" size={18} color={palette.textDim} />
                )}
              </View>

              {!status.unlocked ? (
                <View style={styles.unlockBlock}>
                  <View style={styles.unlockRow}>
                    <Text variant="caption" color={palette.textMuted}>
                      Ár: {formatMoney(city.unlockCost)}
                    </Text>
                    <Text variant="caption" color={palette.accent}>
                      {formatMultiplier(city.globalMultiplier)} globális bevétel
                    </Text>
                  </View>

                  {status.missingLifetime > 0 ? (
                    <Text variant="caption" color={palette.textDim}>
                      Még {formatMoney(status.missingLifetime)} összbevétel kell
                    </Text>
                  ) : null}

                  <Button
                    label="Megnyitom"
                    tone="primary"
                    compact
                    disabled={!status.affordable || busy}
                    onPress={() => void unlockCity(city.id)}
                    style={{ marginTop: spacing.sm }}
                  />
                </View>
              ) : (
                <Text variant="caption" color={palette.textDim} style={{ marginTop: spacing.sm }}>
                  Eddigi bevétel itt: {formatMoney(state.cityEarnings[city.id] ?? 0)}
                </Text>
              )}
            </Card>
          </Touchable>
        );
      })}

      {/* ------------------------------------------------------------------ */}
      <SectionTitle title="Franchise" hint={`${formatNumber(state.stars)} csillag`} />

      <Card style={styles.franchiseCard}>
        <View style={styles.franchiseHeader}>
          <Icon name="star" size={26} color={palette.star} />
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text variant="heading" color={palette.text}>
              Arany Merőkanál
            </Text>
            <Text variant="caption" color={palette.textDim}>
              Minden csillag +2% bevétel, örökre
            </Text>
          </View>
        </View>

        <Divider />

        <View style={styles.franchiseRow}>
          <Text variant="label" color={palette.textMuted}>
            Most kapnál
          </Text>
          <Text variant="title" color={preview.canFranchise ? palette.star : palette.textDim}>
            +{formatNumber(preview.stars)}
          </Text>
        </View>

        {!preview.canFranchise ? (
          <>
            <Text variant="caption" color={palette.textDim} style={{ marginBottom: spacing.sm }}>
              A következő csillagig még {formatMoney(toNextStar)} kell ebben a futásban.
            </Text>
            <ProgressBar
              progress={Math.min(1, state.runEarnings / Math.max(1, state.runEarnings + toNextStar))}
              color={palette.star}
            />
          </>
        ) : null}

        <Button
          label="Franchise indítása"
          sublabel="Újrakezdés, de a csillagok megmaradnak"
          tone="premium"
          disabled={!preview.canFranchise || busy}
          onPress={() => setConfirmOpen(true)}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      <SectionTitle title="Franchise fejlesztések" hint="csillagküszöbök" />

      {FRANCHISE_PERKS.map((perk) => {
        const owned = state.ownedPerkIds.includes(perk.id);
        const requiresOk = !perk.requires || state.ownedPerkIds.includes(perk.requires);
        const enough = state.stars >= perk.starCost;

        return (
          <Card key={`${perk.id}-${tick % 2}`} style={styles.perkCard}>
            <View style={{ flex: 1 }}>
              <View style={styles.perkTitleRow}>
                <Text
                  variant="label"
                  color={owned ? palette.success : palette.text}
                  style={{ flex: 1 }}
                >
                  {perk.name}
                </Text>
                <View style={styles.starCost}>
                  <Icon name="star" size={12} color={palette.star} />
                  <Text variant="caption" color={palette.star} style={{ marginLeft: 3 }}>
                    {formatNumber(perk.starCost)}
                  </Text>
                </View>
              </View>
              <Text variant="caption" color={palette.textDim}>
                {perk.description}
              </Text>
            </View>

            {owned ? (
              <Icon name="check" size={20} color={palette.success} />
            ) : (
              <Button
                label="Aktivál"
                compact
                tone={enough && requiresOk ? 'primary' : 'ghost'}
                disabled={!enough || !requiresOk}
                onPress={() => buyPerk(perk.id)}
                style={{ marginLeft: spacing.md }}
              />
            )}
          </Card>
        );
      })}

      {/* --- Megerősítő ablak --- */}
      <ModalShell
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Biztosan franchise-olsz?"
      >
        <Text variant="body" color={palette.textMuted}>
          Elveszíted: készpénz, termékek, menedzserek, gépek, alkalmazottak és a
          megnyitott városok.
        </Text>
        <Text variant="body" color={palette.success} style={{ marginTop: spacing.md }}>
          Megmarad: {formatNumber(preview.stars)} új csillag, az összes eddigi
          csillag, achievement, Food Coin, kinézet és vásárlás.
        </Text>
        <View style={{ flexDirection: 'row', marginTop: spacing.xl }}>
          <Button
            label="Mégsem"
            tone="ghost"
            onPress={() => setConfirmOpen(false)}
            style={{ flex: 1 }}
          />
          <Button
            label="Indítás"
            tone="premium"
            onPress={() => {
              setConfirmOpen(false);
              void franchise();
            }}
            style={{ flex: 1, marginLeft: spacing.sm }}
          />
        </View>
      </ModalShell>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  cityCard: { marginBottom: spacing.md, padding: spacing.md },
  cityHeader: { flexDirection: 'row', alignItems: 'center' },
  cityDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: spacing.md,
  },
  unlockBlock: { marginTop: spacing.md },
  unlockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  franchiseCard: { marginBottom: spacing.md },
  franchiseHeader: { flexDirection: 'row', alignItems: 'center' },
  franchiseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  perkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  perkTitleRow: { flexDirection: 'row', alignItems: 'center' },
  starCost: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceSunken,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});
