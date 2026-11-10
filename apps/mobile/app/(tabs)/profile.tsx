import type { Language } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { logout } from '../../src/features/auth/api';
import { formatIndianPhone } from '../../src/lib/phone';
import { useSession } from '../../src/store/session';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useSession((s) => s.user);
  const language = useSession((s) => s.language);
  const chooseLanguage = useSession((s) => s.chooseLanguage);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        {t('profile.title')}
      </Text>
      <View
        style={{
          backgroundColor: theme.colors.surfaceRaised,
          borderColor: theme.colors.line,
          borderWidth: 1,
          borderRadius: theme.radius.md,
          padding: theme.space[4],
          gap: theme.space[1],
        }}
      >
        <Text variant="label" color="inkMuted">
          {t('profile.phone')}
        </Text>
        <Text variant="heading">{user ? formatIndianPhone(user.phone) : ''}</Text>
      </View>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="inkMuted">
          {t('profile.language')}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }} accessibilityRole="radiogroup">
          {(['ta', 'en'] as Language[]).map((lang) => {
            const selected = lang === language;
            return (
              <Pressable
                key={lang}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => void chooseLanguage(lang)}
                style={{
                  minHeight: 48,
                  paddingHorizontal: theme.space[4],
                  justifyContent: 'center',
                  borderRadius: theme.radius.pill,
                  borderWidth: 1,
                  borderColor: selected ? theme.colors.brandFill : theme.colors.line,
                  backgroundColor: selected ? theme.colors.blush : theme.colors.surfaceRaised,
                }}
              >
                <Text variant="label">{t(`language.${lang}`)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Button
        variant="secondary"
        label={t('profile.signOut')}
        loading={signingOut}
        onPress={() => {
          setSigningOut(true);
          void logout();
        }}
        style={{ marginTop: 'auto' }}
      />
    </Screen>
  );
}
