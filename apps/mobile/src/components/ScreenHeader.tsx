import { Text } from '@xatu/ui';
import { View } from 'react-native';
import { BackButton } from './BackButton';

export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <BackButton />
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="label" color="inkMuted">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
