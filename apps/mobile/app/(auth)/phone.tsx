import { Button, Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackButton } from '../../src/components/BackButton';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { loginErrorMessage } from '../../src/features/auth/errors';
import { setPendingVerification } from '../../src/features/auth/pending';
import { sendVerificationCode } from '../../src/features/auth/phone-auth';
import { toIndianE164 } from '../../src/lib/phone';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [number, setNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const phone = toIndianE164(number);
    if (!phone) {
      setError(t('phone.invalid'));
      return;
    }
    setError(null);
    setSending(true);
    try {
      const verification = await sendVerificationCode(phone);
      setPendingVerification({ phone, verification });
      router.push('/verify');
    } catch (err) {
      setError(loginErrorMessage(err, t));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Text variant="title" accessibilityRole="header">
        {t('phone.title')}
      </Text>
      <Text color="inkMuted">{t('phone.subtitle')}</Text>
      <TextField
        label={t('phone.label')}
        value={number}
        // Keep the raw text while typing (rewriting it per keystroke can reorder fast input);
        // toIndianE164 cleans and validates it on submit.
        onChangeText={(v) => {
          setNumber(v);
          if (error) setError(null);
        }}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={16}
        autoFocus
        placeholder="98765 43210"
        error={error}
        onSubmitEditing={() => void submit()}
        prefix={
          <Text variant="heading" color="inkMuted" style={{ fontSize: 18 }}>
            +91
          </Text>
        }
      />
      <Button
        label={t('phone.send')}
        loading={sending}
        onPress={() => void submit()}
        style={{ marginTop: theme.space[2] }}
      />
      <Text variant="caption" color="inkMuted" style={{ textAlign: 'center' }}>
        {t('phone.consent')}
      </Text>
    </Screen>
  );
}
