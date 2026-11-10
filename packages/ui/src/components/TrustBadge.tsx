import { View } from 'react-native';
import { VerifiedIcon } from '../icons/TrustIcons.tsx';
import { useTheme } from '../ThemeProvider.tsx';
import { Text } from './Text.tsx';

/** Sage-soft pill with the verified icon. Trust colours are used only for trust. */
export function TrustBadge({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: theme.space[1],
        paddingHorizontal: theme.space[2],
        paddingVertical: 2,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.colors.sageSoft,
      }}
    >
      <VerifiedIcon size={16} color={theme.colors.sage} />
      <Text variant="caption" color="sage">
        {label}
      </Text>
    </View>
  );
}
