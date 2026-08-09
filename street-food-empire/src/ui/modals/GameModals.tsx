import React from 'react';
import { StyleSheet, View } from 'react-native';

import { GAME_CONFIG } from '@/config/gameConfig';
import { formatDuration, formatMoney, formatNumber } from '@/core/format';
import { useGameStore } from '@/game/store';
import { rewardIsFree } from '@/services/ads';
import { Icon } from '@/ui/components/Icon';
import { ModalShell } from '@/ui/components/Overlays';
import { Button, Card, Text } from '@/ui/components/primitives';
import { palette, radius, spacing } from '@/ui/theme';

/**
 * JÁTÉK-MODÁLOK
 *
 * Három ablak, prioritási sorrendben: offline bevétel → jutalom → eredmény.
 * Egyszerre mindig csak egy látszik, hogy ne legyen "ablak-torlódás" indításkor.
 */
export function GameModals() {
  const offlineReport = useGameStore((s) => s.offlineReport);
  const rewardPopup = useGameStore((s) => s.rewardPopup);
  const achievement = useGameStore((s) => s.achievementQueue[0]);

  if (offlineReport) return <OfflineModal />;
  if (rewardPopup) return <RewardModal />;
  if (achievement) return <AchievementModal />;
  return null;
}

// ---------------------------------------------------------------------------
// Offline bevétel
// ---------------------------------------------------------------------------

/**
 * A visszatérési képernyő. Ez az idle játék legfontosabb egyetlen ablaka:
 * ez jutalmazza meg a játékost azért, hogy visszajött.
 *
 * A ×2 gomb mindig **opcionális**, és a sima „Felveszem” ugyanúgy elérhető,
 * azonos hangsúllyal — nem trükközünk az elhelyezéssel.
 */
function OfflineModal() {
  const report = useGameStore((s) => s.offlineReport);
  const state = useGameStore((s) => s.state);
  const busy = useGameStore((s) => s.busy);
  const claimOffline = useGameStore((s) => s.claimOffline);
  const dismissOffline = useGameStore((s) => s.dismissOffline);

  if (!report) return null;

  const doubled = report.baseEarnings * GAME_CONFIG.offline.adMultiplier;
  const adFree = rewardIsFree(state);

  return (
    <ModalShell visible onClose={dismissOffline} dismissable={false}>
      <View style={styles.center}>
        <View style={styles.bigIcon}>
          <Icon name="moon" size={36} color={palette.accent} />
        </View>

        <Text variant="title" color={palette.text} align="center">
          While you were away…
        </Text>
        <Text variant="caption" color={palette.textDim} align="center" style={{ marginTop: 4 }}>
          {formatDuration(report.creditedSeconds)} of production
          {report.cappedOut ? ' (cap reached)' : ''}
        </Text>

        <Text variant="display" color={palette.success} align="center" style={styles.amount}>
          {formatMoney(report.baseEarnings)}
        </Text>

        {report.cappedOut ? (
          <Card style={styles.hintCard}>
            <Text variant="caption" color={palette.textMuted} align="center">
              Your current cap is {formatDuration(report.capHours * 3600)}. Raise it
              with Storage upgrades and Couriers.
            </Text>
          </Card>
        ) : null}
      </View>

      <Button
        label={adFree ? `Felveszem ${formatMoney(doubled)}` : `Dupla: ${formatMoney(doubled)}`}
        sublabel={adFree ? 'ad-free bonus' : 'watch a short video'}
        tone="success"
        disabled={busy}
        onPress={() => void claimOffline(true)}
        style={{ marginTop: spacing.lg }}
      />

      <Button
        label={`Felveszem ${formatMoney(report.baseEarnings)}`}
        tone="ghost"
        disabled={busy}
        onPress={() => void claimOffline(false)}
        style={{ marginTop: spacing.sm }}
      />
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Jutalom (láda, booster)
// ---------------------------------------------------------------------------

function RewardModal() {
  const popup = useGameStore((s) => s.rewardPopup);
  const dismiss = useGameStore((s) => s.dismissRewardPopup);

  if (!popup) return null;

  const content = (() => {
    if (popup.kind === 'booster') {
      return { icon: 'flame' as const, title: popup.title, body: popup.body, color: palette.primary };
    }
    if (popup.kind === 'cash') {
      return {
        icon: 'coin' as const,
        title: popup.title,
        body: formatMoney(popup.amount),
        color: palette.cash,
      };
    }

    switch (popup.reward.kind) {
      case 'coins':
        return {
          icon: 'coin' as const,
          title: 'Food Coin!',
          body: `+${formatNumber(popup.reward.amount)} coins`,
          color: palette.coin,
        };
      case 'cash':
        return {
          icon: 'crate' as const,
          title: 'Cash prize!',
          body: `${formatMoney(popup.reward.amount)} (${formatDuration(popup.reward.seconds)} of income)`,
          color: palette.cash,
        };
      case 'booster':
        return {
          icon: 'flame' as const,
          title: popup.reward.booster === 'turbo' ? 'Turbo shift!' : 'Double income!',
          body: 'The bonus is active right now.',
          color: palette.primary,
        };
      default:
        return { icon: 'crate' as const, title: 'Reward', body: '', color: palette.primary };
    }
  })();

  return (
    <ModalShell visible onClose={dismiss}>
      <View style={styles.center}>
        <View style={[styles.bigIcon, { backgroundColor: `${content.color}22` }]}>
          <Icon name={content.icon} size={36} color={content.color} tint={palette.bg} />
        </View>
        <Text variant="title" color={palette.text} align="center">
          {content.title}
        </Text>
        <Text variant="body" color={palette.textMuted} align="center" style={{ marginTop: spacing.sm }}>
          {content.body}
        </Text>
      </View>
      <Button label="Szuper!" tone="primary" onPress={dismiss} style={{ marginTop: spacing.lg }} />
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Eredmény
// ---------------------------------------------------------------------------

function AchievementModal() {
  const achievement = useGameStore((s) => s.achievementQueue[0]);
  const dismiss = useGameStore((s) => s.dismissAchievement);

  if (!achievement) return null;

  return (
    <ModalShell visible onClose={dismiss}>
      <View style={styles.center}>
        <View style={[styles.bigIcon, { backgroundColor: `${palette.accent}22` }]}>
          <Icon name="trophy" size={36} color={palette.accent} tint={palette.primary} />
        </View>
        <Text variant="caption" color={palette.textDim} align="center">
          NEW ACHIEVEMENT
        </Text>
        <Text variant="title" color={palette.text} align="center">
          {achievement.name}
        </Text>
        <Text variant="body" color={palette.textMuted} align="center" style={{ marginTop: spacing.sm }}>
          {achievement.description}
        </Text>

        <View style={styles.rewardRow}>
          <View style={styles.rewardChip}>
            <Icon name="coin" size={14} color={palette.coin} />
            <Text variant="label" color={palette.text} style={{ marginLeft: 6 }}>
              +{achievement.coinReward}
            </Text>
          </View>
          <View style={styles.rewardChip}>
            <Icon name="flame" size={14} color={palette.success} />
            <Text variant="label" color={palette.text} style={{ marginLeft: 6 }}>
              +{Math.round(achievement.incomeBonus * 100)}% income
            </Text>
          </View>
        </View>
      </View>

      <Button label="Continue" tone="primary" onPress={dismiss} style={{ marginTop: spacing.lg }} />
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  bigIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: palette.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  amount: { marginTop: spacing.md },
  hintCard: {
    marginTop: spacing.lg,
    backgroundColor: palette.surfaceSunken,
    padding: spacing.md,
  },
  rewardRow: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  rewardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceSunken,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
});
