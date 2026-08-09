import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/ui/components/Icon';
import { Text } from '@/ui/components/primitives';
import { HIT_SIZE, palette, spacing } from '@/ui/theme';

/**
 * BOTTOM NAVIGATION
 *
 * A small custom tab bar - no navigation library, because the game's 6 screens
 * need no stack, deep linking or transitions. That is ~200 KB less bundle and a
 * faster cold start.
 *
 * The dot marks a tab that has a reward waiting - one of the strongest
 * incentives to come back.
 */

export type TabKey = 'stand' | 'upgrades' | 'staff' | 'cities' | 'missions' | 'shop';

export const TABS: readonly { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'stand', label: 'Stand', icon: 'stand' },
  { key: 'upgrades', label: 'Machines', icon: 'upgrade' },
  { key: 'staff', label: 'Crew', icon: 'chef' },
  { key: 'cities', label: 'Cities', icon: 'city' },
  { key: 'missions', label: 'Missions', icon: 'quest' },
  { key: 'shop', label: 'Shop', icon: 'shop' },
];

type Props = {
  active: TabKey;
  onChange: (key: TabKey) => void;
  /** Which tabs have a claimable reward / available purchase. */
  badges?: Partial<Record<TabKey, boolean>>;
};

export const TabBar = React.memo(function TabBar({ active, onChange, badges }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isActive }}
            style={styles.tab}
          >
            <View>
              <Icon
                name={tab.icon}
                size={22}
                color={isActive ? palette.primary : palette.textDim}
                tint={isActive ? palette.accent : palette.textDim}
              />
              {badges?.[tab.key] ? <View style={styles.dot} /> : null}
            </View>
            <Text
              variant="caption"
              color={isActive ? palette.primary : palette.textDim}
              style={styles.label}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.sm,
  },
  tab: {
    flex: 1,
    minHeight: HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 3,
  },
  dot: {
    position: 'absolute',
    top: -2,
    right: -6,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: palette.danger,
    borderWidth: 1.5,
    borderColor: palette.surface,
  },
});
