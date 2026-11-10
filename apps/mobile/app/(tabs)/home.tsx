import { useQuery } from '@tanstack/react-query';
import { APP_NAME } from '@xatu/config/brand';
import { Text, useTheme, XatuMark } from '@xatu/ui';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { fetchMe } from '../../src/features/auth/api';
import { formatIndianPhone } from '../../src/lib/phone';
import { useSession } from '../../src/store/session';

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const cached = useSession((s) => s.user);
  // GET /me proves the token round trip; falls back to the cached user while offline.
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const user = me ?? cached;
  const name = user?.name ?? (user ? formatIndianPhone(user.phone) : '');

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <XatuMark size={28} />
        <Text variant="title" maxFontSizeMultiplier={1.4}>
          {APP_NAME.toLowerCase()}
        </Text>
      </View>
      <Text variant="title" accessibilityRole="header">
        {t('home.greeting', { name })}
      </Text>
      <View
        style={{
          backgroundColor: theme.colors.surfaceWarm,
          borderRadius: theme.radius.lg,
          padding: theme.space[6],
        }}
      >
        <Text color="inkMuted">{t('home.comingSoon')}</Text>
      </View>
    </Screen>
  );
}
