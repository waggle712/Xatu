import { useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

export function BackButton() {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('a11y.back')}
      onPress={() => router.back()}
      hitSlop={8}
      style={{ width: 48, height: 48, justifyContent: 'center', marginLeft: -12 }}
    >
      <ChevronLeft
        size={28}
        strokeWidth={1.75}
        color={theme.colors.ink}
        style={{ alignSelf: 'center' }}
      />
    </Pressable>
  );
}
