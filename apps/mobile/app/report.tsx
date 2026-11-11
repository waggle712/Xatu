import {
  createReportSchema,
  MAX_REPORT_DETAILS,
  REPORT_REASONS,
  type ReportReason,
  parseShareLink,
} from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Circle } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { EmptyState } from '../src/components/States';
import { TextField } from '../src/components/TextField';
import { useReport, useSocialEnabled } from '../src/features/social/api';
import { track } from '../src/lib/analytics';
import { errorMessage } from '../src/lib/errors';

/**
 * Report a listing (?productId=) or a shop (?handle=). The target comes from route params, so it
 * is checked like an incoming link before anything is sent.
 */
export default function ReportScreen() {
  const params = useLocalSearchParams<{ productId?: string; handle?: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useSocialEnabled();
  const target = params.productId
    ? parseShareLink(`/p/${params.productId}`)
    : params.handle
      ? parseShareLink(`/s/${params.handle}`)
      : null;
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState<null | { already: boolean }>(null);
  const report = useReport();

  if (!enabled || !target) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title={t('social.reportTitle')} />
        <EmptyState
          title={t('catalog.page.notAvailable')}
          body={t('catalog.page.notAvailableBody')}
        />
      </Screen>
    );
  }

  const apiTarget =
    target.type === 'product'
      ? { type: 'product' as const, id: target.id }
      : { type: 'shop' as const, handle: target.handle };
  const input = { target: apiTarget, reason, details: details.trim() || undefined };
  const valid = reason !== null && createReportSchema.safeParse(input).success;

  if (sent) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title={t('social.reportTitle')} />
        <View style={{ alignItems: 'center', gap: theme.space[4], paddingTop: theme.space[6] }}>
          <CheckCircle2 size={48} strokeWidth={1.5} color={theme.colors.sage} />
          <Text variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t(sent.already ? 'social.reportAlready' : 'social.reportThanks')}
          </Text>
          <Text color="inkMuted" style={{ textAlign: 'center' }}>
            {t('social.reportThanksBody')}
          </Text>
        </View>
        <Button label={t('social.done')} onPress={() => router.back()} />
      </Screen>
    );
  }

  const submit = () => {
    if (!reason || !valid) return;
    report.mutate(
      { target: apiTarget, reason, ...(input.details ? { details: input.details } : {}) },
      {
        onSuccess: (receipt) => {
          track('report_submitted', { target_type: target.type, reason });
          setSent({ already: receipt.alreadyReported });
        },
      },
    );
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        title={t(target.type === 'product' ? 'social.reportProduct' : 'social.reportShop')}
        subtitle={t('social.reportIntro')}
      />
      <View accessibilityRole="radiogroup" style={{ gap: theme.space[2] }}>
        {REPORT_REASONS.map((r) => {
          const selected = r === reason;
          return (
            <Pressable
              key={r}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`social.reasons.${r}`)}
              onPress={() => setReason(r)}
              style={{
                minHeight: 56,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space[3],
                paddingHorizontal: theme.space[4],
                paddingVertical: theme.space[3],
                borderRadius: theme.radius.md,
                borderWidth: selected ? 1.5 : 1,
                borderColor: selected ? theme.colors.brandFill : theme.colors.line,
                backgroundColor: selected ? theme.colors.blush : theme.colors.surfaceRaised,
              }}
            >
              {selected ? (
                <CheckCircle2 size={22} strokeWidth={1.75} color={theme.colors.ink} />
              ) : (
                <Circle size={22} strokeWidth={1.75} color={theme.colors.inkMuted} />
              )}
              <Text style={{ flex: 1 }}>{t(`social.reasons.${r}`)}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextField
        label={t(reason === 'other' ? 'social.detailsRequired' : 'social.details')}
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={MAX_REPORT_DETAILS}
        placeholder={t('social.detailsHint')}
        style={{ minHeight: 96, textAlignVertical: 'top' }}
      />
      {report.isError ? (
        <Text color="critical" accessibilityLiveRegion="polite">
          {errorMessage(report.error, t)}
        </Text>
      ) : null}
      <Button
        label={t('social.sendReport')}
        disabled={!valid}
        loading={report.isPending}
        onPress={submit}
      />
    </Screen>
  );
}
