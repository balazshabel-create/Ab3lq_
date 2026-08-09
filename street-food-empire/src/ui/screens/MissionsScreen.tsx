import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { formatNumber } from '@/core/format';
import { ACHIEVEMENTS } from '@/game/content/achievements';
import { activeEvents } from '@/game/content/events';
import { allQuestsClaimed, questProgress } from '@/game/progression';
import { useGameStore } from '@/game/store';
import { GAME_CONFIG } from '@/config/gameConfig';
import { Icon, type IconName } from '@/ui/components/Icon';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  SectionTitle,
  Text,
} from '@/ui/components/primitives';
import { palette, radius, spacing } from '@/ui/theme';

/**
 * KÜLDETÉSEK KÉPERNYŐ
 *
 * Három blokk: aktív esemény, napi küldetések, achievementek.
 *
 * A napi küldetés a legerősebb visszatérési ok egy idle játékban, ezért
 * legfelül van, és a teljesített, de fel nem vett küldetés vizuálisan
 * kiabál (zöld gomb + pötty a fülön).
 */
export function MissionsScreen() {
  const tick = useGameStore((s) => s.tick);
  const state = useGameStore((s) => s.state);
  const claimQuest = useGameStore((s) => s.claimQuest);
  const claimDailyBonus = useGameStore((s) => s.claimDailyBonus);

  const events = activeEvents(Date.now());
  const quests = state.daily.quests
    .map((quest) => questProgress(state, quest))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const unlockedCount = state.unlockedAchievementIds.length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} removeClippedSubviews>
      {/* --- Events --- */}
      {events.length > 0 ? (
        <>
          <SectionTitle title="Live event" hint="today" />
          {events.map((event) => (
            <Card key={event.id} style={[styles.eventCard, { borderColor: event.color }]}>
              <View style={styles.eventHeader}>
                <Icon name={event.icon as IconName} size={20} color={event.color} />
                <Text variant="heading" color={palette.text} style={{ marginLeft: spacing.sm }}>
                  {event.name}
                </Text>
              </View>
              <Text variant="caption" color={palette.textMuted} style={{ marginTop: 4 }}>
                {event.description}
              </Text>
            </Card>
          ))}
        </>
      ) : null}

      {/* --- Daily quests --- */}
      <SectionTitle
        title="Daily quests"
        hint={`${quests.filter((q) => q.claimed).length}/${quests.length}`}
      />

      {quests.length === 0 ? (
        <EmptyState
          title="No active quests"
          body="New quests arrive at midnight."
        />
      ) : (
        quests.map((quest) => (
          <Card key={`${quest.quest.questId}-${tick % 2}`} style={styles.questCard}>
            <View style={styles.questRow}>
              <View style={{ flex: 1 }}>
                <Text variant="label" color={palette.text}>
                  {quest.text}
                </Text>
                <Text variant="caption" color={palette.textDim} style={{ marginTop: 2 }}>
                  {formatNumber(quest.current)} / {formatNumber(quest.target)}
                </Text>
              </View>

              {quest.claimed ? (
                <Icon name="check" size={22} color={palette.success} />
              ) : (
                <Button
                  label={quest.complete ? 'Felveszem' : `+${quest.coinReward}`}
                  compact
                  tone={quest.complete ? 'success' : 'ghost'}
                  disabled={!quest.complete}
                  onPress={() => claimQuest(quest.quest.questId)}
                  style={{ marginLeft: spacing.md, minWidth: 96 }}
                />
              )}
            </View>

            <ProgressBar
              progress={quest.target > 0 ? quest.current / quest.target : 0}
              color={quest.complete ? palette.success : palette.primary}
              height={6}
            />
          </Card>
        ))
      )}

      {quests.length > 0 ? (
        <Card style={styles.bonusCard}>
          <View style={{ flex: 1 }}>
            <Text variant="label" color={palette.text}>
              All {quests.length} completed
            </Text>
            <Text variant="caption" color={palette.textDim}>
              Bonus: +{GAME_CONFIG.coins.dailyAllCompleteBonus} Food Coins
            </Text>
          </View>
          {state.daily.allClaimedBonusTaken ? (
            <Icon name="check" size={22} color={palette.success} />
          ) : (
            <Button
              label="Claim"
              compact
              tone={allQuestsClaimed(state) ? 'success' : 'ghost'}
              disabled={!allQuestsClaimed(state)}
              onPress={claimDailyBonus}
            />
          )}
        </Card>
      ) : null}

      {/* --- Achievementek --- */}
      <SectionTitle
        title="Achievements"
        hint={`${unlockedCount}/${ACHIEVEMENTS.length}`}
      />

      {ACHIEVEMENTS.map((achievement) => {
        const unlocked = state.unlockedAchievementIds.includes(achievement.id);
        const current = state.stats[achievement.metric] ?? 0;
        const progress = Math.min(1, current / achievement.threshold);

        return (
          <Card
            key={`${achievement.id}-${tick % 2}`}
            style={[styles.achievementCard, unlocked && styles.achievementDone]}
          >
            <View style={styles.achievementIcon}>
              <Icon
                name="trophy"
                size={18}
                color={unlocked ? palette.accent : palette.textDim}
                tint={unlocked ? palette.primary : palette.textDim}
              />
            </View>

            <View style={{ flex: 1 }}>
              <View style={styles.achievementTitleRow}>
                <Text
                  variant="label"
                  color={unlocked ? palette.text : palette.textMuted}
                  style={{ flex: 1 }}
                >
                  {achievement.name}
                </Text>
                <Badge
                  label={`+${Math.round(achievement.incomeBonus * 100)}%`}
                  color={unlocked ? palette.success : palette.surfaceSunken}
                  textColor={unlocked ? '#08240F' : palette.textDim}
                />
              </View>
              <Text variant="caption" color={palette.textDim}>
                {achievement.description}
              </Text>
              {!unlocked ? (
                <View style={{ marginTop: spacing.sm }}>
                  <ProgressBar progress={progress} color={palette.primary} height={4} />
                </View>
              ) : null}
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  eventCard: { marginBottom: spacing.md, borderWidth: 1.5, padding: spacing.md },
  eventHeader: { flexDirection: 'row', alignItems: 'center' },
  questCard: { marginBottom: spacing.sm, padding: spacing.md },
  questRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  bonusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: palette.surfaceSunken,
  },
  achievementCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    padding: spacing.md,
    opacity: 0.75,
  },
  achievementDone: { opacity: 1 },
  achievementIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: palette.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  achievementTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
});
