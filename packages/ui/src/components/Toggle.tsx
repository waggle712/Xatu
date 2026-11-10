import { Pressable, View } from 'react-native';
import { useTheme } from '../ThemeProvider.tsx';

export interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}

/**
 * On/off switch drawn in brand colours, identical on Android and iOS
 * (the native Switch differs per OS and mis-aligns on newer iOS). 48dp touch target.
 */
export function Toggle({ value, onChange, accessibilityLabel, disabled }: ToggleProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={{
        minWidth: 56,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: 52,
          height: 32,
          borderRadius: 16,
          padding: 3,
          backgroundColor: value ? theme.colors.brandFill : theme.colors.line,
          alignItems: value ? 'flex-end' : 'flex-start',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: theme.colors.surfaceRaised,
            ...theme.shadowCard,
            shadowRadius: 2,
          }}
        />
      </View>
    </Pressable>
  );
}
