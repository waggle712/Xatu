import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, View } from 'react-native';
import { useTheme } from '../ThemeProvider.tsx';
import { Text } from './Text.tsx';

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  /** primary = the one marigold action per screen; secondary = outlined. */
  variant?: 'primary' | 'secondary';
  icon?: ReactNode;
  loading?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        {
          borderRadius: theme.radius.md,
          backgroundColor: primary ? theme.colors.marigold : theme.colors.surfaceRaised,
          borderColor: primary ? theme.colors.marigold : theme.colors.line,
          opacity: isDisabled ? 0.55 : state.pressed ? 0.85 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.onMarigold} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text variant="heading" color={primary ? 'onMarigold' : 'ink'} style={styles.label}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  label: { flexShrink: 1, textAlign: 'center' },
});
