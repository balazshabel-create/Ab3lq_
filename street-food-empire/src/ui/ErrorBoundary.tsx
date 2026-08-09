import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { log } from '@/core/logger';
import { Button, Card, Text } from '@/ui/components/primitives';
import { palette, spacing } from '@/ui/theme';

/**
 * HIBAHATÁR
 *
 * Egy játék soha ne legyen fehér képernyő. Ha a React fa bárhol elszáll:
 *  - naplózzuk (és a crash-reporter sink is megkapja),
 *  - a játékos kap egy értelmes üzenetet és egy „Újraindítom” gombot,
 *  - a mentés érintetlen marad, tehát a haladás nem vész el.
 *
 * A `resetKey` növelésével a teljes fát újramountoljuk – ez a legtöbb
 * átmeneti render-hibát megoldja anélkül, hogy az appot be kellene zárni.
 */

type Props = {
  children: React.ReactNode;
  /** Opcionális: mit tegyünk újraindításkor (pl. store újratöltés). */
  onReset?: () => void;
};

type State = {
  error: Error | null;
  resetKey: number;
};

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    log.error('Unhandled UI error', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  private handleReset = (): void => {
    this.props.onReset?.();
    this.setState((prev) => ({ error: null, resetKey: prev.resetKey + 1 }));
  };

  override render(): React.ReactNode {
    const { error, resetKey } = this.state;

    if (!error) {
      return <React.Fragment key={resetKey}>{this.props.children}</React.Fragment>;
    }

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text variant="display" color={palette.primary} align="center">
            Oops!
          </Text>
          <Text variant="body" color={palette.textMuted} align="center" style={styles.body}>
            Something went wrong. Your progress is safe - the last save is
            untouched.
          </Text>

          <Card style={styles.errorCard}>
            <Text variant="caption" color={palette.textDim}>
              {error.message}
            </Text>
          </Card>

          <Button label="Restart" tone="primary" onPress={this.handleReset} />
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  body: { marginTop: spacing.md },
  errorCard: {
    marginVertical: spacing.xl,
    backgroundColor: palette.surfaceSunken,
  },
});
