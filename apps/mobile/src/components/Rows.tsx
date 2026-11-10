import { Text, Toggle, useTheme } from '@xatu/ui';
import { CheckCircle2, ChevronRight, Circle } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

/** Tappable row that opens a section; shows whether that section is complete. */
export function SectionRow({
  label,
  done,
  onPress,
}: {
  label: string;
  done?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={done === undefined ? undefined : done ? undefined : ' '}
      onPress={onPress}
      style={(s) => ({
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingHorizontal: theme.space[4],
        paddingVertical: theme.space[3],
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: c.line,
        backgroundColor: c.surfaceRaised,
        opacity: s.pressed ? 0.85 : 1,
      })}
    >
      {done === undefined ? null : done ? (
        <CheckCircle2 size={22} strokeWidth={1.75} color={c.sage} />
      ) : (
        <Circle size={22} strokeWidth={1.75} color={c.taupe} />
      )}
      <Text variant="heading" style={{ flex: 1 }}>
        {label}
      </Text>
      <ChevronRight size={22} strokeWidth={1.75} color={c.inkMuted} />
    </Pressable>
  );
}

export function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}
    >
      <Text style={{ flex: 1 }}>{label}</Text>
      <Toggle accessibilityLabel={label} value={value} onChange={onChange} />
    </View>
  );
}
