import { Pressable, type PressableProps } from 'react-native';
import { useTheme } from '../ThemeProvider.tsx';
import { Text } from './Text.tsx';

export interface ChipProps extends Omit<PressableProps, 'children'> {
  label: string;
  selected?: boolean;
}

/** Filter chip: pill, line border; selected = blush fill + dusty rose border + plum text. */
export function Chip({ label, selected = false, style, ...rest }: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={(state) => [
        {
          minHeight: 48,
          paddingHorizontal: theme.space[4],
          justifyContent: 'center',
          borderRadius: theme.radius.pill,
          borderWidth: selected ? 1.5 : 1,
          borderColor: selected ? theme.colors.brandFill : theme.colors.line,
          backgroundColor: selected ? theme.colors.blush : theme.colors.surfaceRaised,
          opacity: state.pressed ? 0.85 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      <Text variant="label">{label}</Text>
    </Pressable>
  );
}
