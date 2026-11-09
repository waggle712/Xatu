import { Button, Text, useTheme } from '@xatu/ui';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { BackButton } from '../../src/components/BackButton';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { createSession } from '../../src/features/auth/api';
import { loginErrorMessage } from '../../src/features/auth/errors';
import { getPendingVerification, setPendingVerification } from '../../src/features/auth/pending';
import { AUTH_MODE } from '../../src/lib/config';
import { formatIndianPhone, isOtpCode } from '../../src/lib/phone';
import { useSession } from '../../src/store/session';

export default function VerifyScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const signIn = useSession((s) => s.signIn);
  const language = useSession((s) => s.language);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const pending = getPendingVerification();

  if (!pending) return <Redirect href="/phone" />;

  const submit = async (value = code) => {
    if (!isOtpCode(value)) {
      setError(t('verify.invalid'));
      return;
    }
    setError(null);
    setVerifying(true);
    try {
      const firebaseIdToken = await pending.verification.confirm(value);
      const session = await createSession({ firebaseIdToken, language, deviceName: 'phone' });
      setPendingVerification(null);
      await signIn(session); // the root layout switches to the tabs
    } catch (err) {
      setError(loginErrorMessage(err, t));
      setVerifying(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Text variant="title" accessibilityRole="header">
        {t('verify.title')}
      </Text>
      <Text color="inkMuted">
        {t('verify.subtitle', { phone: formatIndianPhone(pending.phone) })}
      </Text>
      {AUTH_MODE === 'dev' ? (
        <View
          style={{
            backgroundColor: theme.colors.surfaceWarm,
            borderRadius: theme.radius.sm,
            padding: theme.space[3],
          }}
        >
          <Text variant="caption" color="goldText">
            {t('verify.devHint')}
          </Text>
        </View>
      ) : null}
      <TextField
        label={t('verify.label')}
        value={code}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (error) setError(null);
          if (digits.length === 6) void submit(digits);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        autoFocus
        placeholder="••••••"
        error={error}
        style={{ letterSpacing: 8, fontSize: 22 }}
      />
      <Button label={t('verify.verify')} loading={verifying} onPress={() => void submit()} />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        style={{
          alignSelf: 'center',
          minHeight: 48,
          justifyContent: 'center',
          paddingHorizontal: 12,
        }}
      >
        <Text variant="label" color="brand">
          {t('verify.changeNumber')}
        </Text>
      </Pressable>
    </Screen>
  );
}
