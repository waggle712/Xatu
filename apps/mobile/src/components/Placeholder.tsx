import { Text, useTheme } from '@xatu/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Screen } from './Screen';

/** Simple tab screen used until each feature is built. */
export function Placeholder({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>
      <View
        style={{
          backgroundColor: theme.colors.surfaceWarm,
          borderRadius: theme.radius.lg,
          padding: theme.space[6],
          gap: theme.space[4],
        }}
      >
        <Text color="inkMuted">{body}</Text>
        {children}
      </View>
    </Screen>
  );
}
