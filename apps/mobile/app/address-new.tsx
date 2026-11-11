import { addressInputSchema } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { TextField } from '../src/components/TextField';
import { useCreateAddress } from '../src/features/orders/api';
import { errorMessage } from '../src/lib/errors';

/** Add a delivery address (local delivery). Checked with the same schema as the API. */
export default function NewAddressScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const create = useCreateAddress();
  const [form, setForm] = useState({
    name: '',
    phone: '',
    line1: '',
    line2: '',
    landmark: '',
    city: 'Trichy',
    pincode: '',
  });
  const [shown, setShown] = useState(false);
  const input = {
    name: form.name,
    phone: form.phone,
    line1: form.line1,
    ...(form.line2.trim() ? { line2: form.line2 } : {}),
    ...(form.landmark.trim() ? { landmark: form.landmark } : {}),
    city: form.city,
    pincode: form.pincode,
  };
  const parsed = addressInputSchema.safeParse(input);
  const issue = (field: string) =>
    shown && !parsed.success && parsed.error.issues.some((i) => i.path[0] === field)
      ? t(`address.errors.${field}`)
      : null;
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={t('address.title')} subtitle={t('address.subtitle')} />
      <View style={{ gap: theme.space[3] }}>
        <TextField
          label={t('address.name')}
          value={form.name}
          onChangeText={set('name')}
          autoComplete="name"
          maxLength={80}
          error={issue('name')}
        />
        <TextField
          label={t('address.phone')}
          value={form.phone}
          onChangeText={set('phone')}
          keyboardType="phone-pad"
          autoComplete="tel"
          maxLength={14}
          error={issue('phone')}
        />
        <TextField
          label={t('address.line1')}
          value={form.line1}
          onChangeText={set('line1')}
          autoComplete="street-address"
          maxLength={200}
          error={issue('line1')}
        />
        <TextField
          label={t('address.line2')}
          value={form.line2}
          onChangeText={set('line2')}
          maxLength={200}
        />
        <TextField
          label={t('address.landmark')}
          value={form.landmark}
          onChangeText={set('landmark')}
          maxLength={100}
        />
        <TextField
          label={t('address.city')}
          value={form.city}
          onChangeText={set('city')}
          maxLength={60}
          error={issue('city')}
        />
        <TextField
          label={t('address.pincode')}
          value={form.pincode}
          onChangeText={set('pincode')}
          keyboardType="number-pad"
          autoComplete="postal-code"
          maxLength={6}
          error={issue('pincode')}
        />
      </View>
      {create.isError ? (
        <Text color="critical" accessibilityLiveRegion="polite">
          {errorMessage(create.error, t)}
        </Text>
      ) : null}
      <Button
        label={t('address.save')}
        loading={create.isPending}
        onPress={() => {
          setShown(true);
          if (parsed.success) create.mutate(input, { onSuccess: () => router.back() });
        }}
      />
    </Screen>
  );
}
