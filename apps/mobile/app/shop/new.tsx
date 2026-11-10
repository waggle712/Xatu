import { handleSchema } from '@xatu/shared';
import { Button, Chip, Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { ErrorState, LoadingState, OfflineBanner } from '../../src/components/States';
import { TextField } from '../../src/components/TextField';
import {
  checkHandle,
  suggestHandle,
  useCategories,
  useCreateShop,
} from '../../src/features/shop/api';
import { errorMessage } from '../../src/lib/errors';
import { useSession } from '../../src/store/session';

type HandleState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function NewShop() {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useSession((s) => s.language);
  const categories = useCategories();
  const create = useCreateShop();
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleEdited, setHandleEdited] = useState(false);
  const [handleState, setHandleState] = useState<HandleState>('idle');
  const [categoryId, setCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (!handleEdited) setHandle(suggestHandle(name));
  }, [name, handleEdited]);

  // Debounced availability check.
  useEffect(() => {
    if (!handle) return setHandleState('idle');
    if (!handleSchema.safeParse(handle).success) return setHandleState('invalid');
    setHandleState('checking');
    const timer = setTimeout(() => {
      checkHandle(handle)
        .then((ok) => setHandleState(ok ? 'available' : 'taken'))
        .catch(() => setHandleState('idle'));
    }, 400);
    return () => clearTimeout(timer);
  }, [handle]);

  const canSubmit = name.trim().length >= 2 && handleState === 'available' && categoryId !== null;
  const handleMessage =
    handleState === 'available'
      ? t('shop.new.handleAvailable')
      : handleState === 'taken'
        ? t('shop.new.handleTaken')
        : t('shop.new.handleHint');

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={t('shop.new.title')} subtitle={t('shop.new.step', { n: 1, total: 4 })} />
      <OfflineBanner />
      <TextField
        label={t('shop.new.name')}
        defaultValue=""
        onChangeText={setName}
        placeholder={t('shop.new.namePlaceholder')}
        maxLength={60}
        autoFocus
      />
      <View style={{ gap: theme.space[1] }}>
        <TextField
          label={t('shop.new.handle')}
          value={handle}
          onChangeText={(v) => {
            setHandleEdited(true);
            setHandle(v.toLowerCase().replace(/[^a-z0-9_]/g, ''));
          }}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={30}
          prefix={
            <Text variant="heading" color="inkMuted">
              @
            </Text>
          }
          error={handleState === 'taken' || handleState === 'invalid' ? handleMessage : null}
        />
        {handleState !== 'taken' && handleState !== 'invalid' ? (
          <Text
            variant="caption"
            color={handleState === 'available' ? 'sage' : 'inkMuted'}
            accessibilityLiveRegion="polite"
          >
            {handleMessage}
          </Text>
        ) : null}
      </View>

      <Text variant="label" color="inkMuted">
        {t('shop.new.category')}
      </Text>
      {categories.isPending ? (
        <LoadingState lines={1} />
      ) : categories.isError ? (
        <ErrorState
          message={errorMessage(categories.error, t)}
          onRetry={() => void categories.refetch()}
        />
      ) : (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}
          accessibilityRole="radiogroup"
        >
          {categories.data.map((c) => (
            <Chip
              key={c.id}
              label={language === 'ta' ? c.nameTa : c.nameEn}
              selected={categoryId === c.id}
              onPress={() => setCategoryId(c.id)}
            />
          ))}
        </View>
      )}

      {create.isError ? (
        <Text variant="label" color="critical" accessibilityLiveRegion="polite">
          {errorMessage(create.error, t)}
        </Text>
      ) : null}
      <Button
        label={t('shop.new.create')}
        disabled={!canSubmit}
        loading={create.isPending}
        onPress={() =>
          categoryId &&
          create.mutate(
            { businessName: name.trim(), handle, categoryId },
            { onSuccess: () => router.replace('/shop') },
          )
        }
        style={{ marginTop: 'auto' }}
      />
    </Screen>
  );
}
