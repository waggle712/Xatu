import { formatPaise, type OrderView } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { track } from '../../lib/analytics';
import { errorMessage } from '../../lib/errors';
import { useSession } from '../../store/session';
import { usePaymentStatus, useStartPayment } from './api';
import { openRazorpayCheckout } from './checkout';

/**
 * "Pay ₹…" for an unpaid order. After Razorpay Checkout closes, whatever it said, the app only
 * shows "Confirming payment…" and polls the server; the server decides from Razorpay's webhook or
 * its own fetch. No "money held" or Protected Pay wording until Razorpay and a lawyer confirm it.
 */
export function PayPanel({ order }: { order: OrderView }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const phone = useSession((s) => s.user?.phone);
  const start = useStartPayment(order.id);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [note, setNote] = useState<null | 'cancelled' | 'failed'>(null);
  const status = usePaymentStatus(paymentId, order.id);
  const confirming = !!paymentId && (status.data?.status ?? 'pending') === 'pending';
  const [startedAt, setStartedAt] = useState(0);
  const slow = confirming && status.dataUpdatedAt - startedAt > 2 * 60_000;

  const pay = () => {
    setNote(null);
    start.mutate(undefined, {
      onSuccess: async (s) => {
        track('payment_started', { order_id: order.id });
        const result = await openRazorpayCheckout(s, {
          phone,
          colour: theme.colors.marigold,
          description: t('order.title', { code: order.code }),
        });
        // Whatever Checkout said, confirm with the server (the app might even have been closed).
        setStartedAt(Date.now());
        setPaymentId(s.paymentId);
        if (result !== 'closed_after_success') setNote(result);
      },
    });
  };

  if (confirming && !note) {
    return (
      <View
        accessible
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          gap: theme.space[3],
          alignItems: 'center',
          padding: theme.space[4],
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surfaceWarm,
        }}
      >
        <ActivityIndicator color={theme.colors.ink} />
        <View style={{ flex: 1, gap: theme.space[1] }}>
          <Text variant="label">{t('pay.confirming')}</Text>
          <Text variant="caption" color="inkMuted">
            {slow ? t('pay.confirmingSlow') : t('pay.confirmingBody')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: theme.space[2] }}>
      {note ? (
        <Text color={note === 'failed' ? 'critical' : 'inkMuted'} accessibilityLiveRegion="polite">
          {t(note === 'failed' ? 'pay.failed' : 'pay.cancelled')}
        </Text>
      ) : null}
      {start.isError ? (
        <Text color="critical" accessibilityLiveRegion="polite">
          {errorMessage(start.error, t)}
        </Text>
      ) : null}
      <Button
        label={t('pay.button', { amount: formatPaise(order.totalPaise) })}
        loading={start.isPending}
        onPress={pay}
      />
      <Text variant="caption" color="inkMuted">
        {t('pay.upiHint')}
      </Text>
    </View>
  );
}
