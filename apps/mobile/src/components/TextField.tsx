import { Text, useTheme } from '@xatu/ui';
import type { ReactNode } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

interface Props extends TextInputProps {
  label: string;
  error?: string | null;
  prefix?: ReactNode;
}

export function TextField({ label, error, prefix, style, ...rest }: Props) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" color="inkMuted">
        {label}
      </Text>
      <View
        style={[
          styles.box,
          {
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceRaised,
            borderColor: error ? theme.colors.critical : theme.colors.line,
            paddingHorizontal: theme.space[4],
            gap: theme.space[2],
          },
        ]}
      >
        {prefix}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={theme.colors.inkMuted}
          style={[
            styles.input,
            { color: theme.colors.ink, fontFamily: 'HindMadurai_500Medium', fontSize: 18 },
            style,
          ]}
          {...rest}
        />
      </View>
      {error ? (
        <Text variant="caption" color="critical" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { minHeight: 56, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, minHeight: 54 },
});
