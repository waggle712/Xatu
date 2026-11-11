import { formatPaise, type OrderView } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { Clock } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, View } from 'react-native';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../../src/components/States';
import { Screen } from '../../src/components/Screen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useCancelOrder, useOrder } from '../../src/features/orders/api';
import { MoneyRow, OrderStatusPill } from '../../src/features/orders/parts';
import { ApiRequestError } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { useSession } from '../../src/store/session';

/** One order. Payment arrives in prompt 15; until then an unpaid order waits 15 minutes. */
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const query = useOrder(id);
  const gone = query.error instanceof ApiRequestError && query.error.status === 404;
  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        title={query.data ? t('order.title', { code: query.data.code }) : t('orders.title')}
      />
      <OfflineBanner />
      {gone ? (
        <EmptyState title={t('order.notFound')} body={t('order.notFoundBody')} />
      ) : query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
      ) : (
        <OrderDetails order={query.data} />
      )}
    </Screen>
  );
}

function OrderDetails({ order }: { order: OrderView }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useSession((s) => s.language);
  const cancel = useCancelOrder(order.id);
  const until = order.expiresAt
    ? new Date(order.expiresAt).toLocaleTimeString(language === 'ta' ? 'ta-IN' : 'en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
    : null;

  return (
    <View style={{ gap: theme.space[4] }}>
      <OrderStatusPill status={order.status} />
      {order.status === 'awaiting_payment' ? (
        <View
          style={{
            flexDirection: 'row',
            gap: theme.space[3],
            padding: theme.space[4],
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceWarm,
          }}
        >
          <Clock size={22} strokeWidth={1.75} color={theme.colors.ink} />
          <View style={{ flex: 1, gap: theme.space[1] }}>
            <Text variant="label">{t('order.awaitingTitle', { time: until ?? '' })}</Text>
            <Text variant="caption" color="inkMuted">
              {t('order.awaitingBody')}
            </Text>
          </View>
        </View>
      ) : null}
      {order.status === 'expired' ? <Text color="inkMuted">{t('order.expiredBody')}</Text> : null}

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('catalog.page.maker', { name: order.seller.businessName })}
        onPress={() => router.push(`/s/${order.seller.handle}`)}
        style={{ minHeight: 48, justifyContent: 'center' }}
      >
        <Text variant="heading">{order.seller.businessName}</Text>
        <Text variant="caption" color="inkMuted">
          {[order.seller.areaName, order.seller.city].filter(Boolean).join(', ')} ·{' '}
          {t(`checkout.modes.${order.fulfilmentMode}`)}
        </Text>
      </Pressable>

      <View style={{ gap: theme.space[2] }}>
        {order.items.map((i) => (
          <View
            key={i.variantId}
            style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap' }}
          >
            <Text style={{ flex: 1, minWidth: 160 }}>
              {i.quantity} ×{' '}
              {(language === 'ta' ? i.titleTa || i.title : i.title) +
                (i.variantLabel ? ` (${i.variantLabel})` : '')}
            </Text>
            <Text variant="label">{formatPaise(i.lineTotalPaise)}</Text>
          </View>
        ))}
      </View>
      <View style={{ gap: theme.space[2] }}>
        <MoneyRow label={t('bag.subtotal')} paise={order.subtotalPaise} />
        <MoneyRow label={t('checkout.deliveryFee')} paise={order.deliveryFeePaise} />
        <MoneyRow label={t('checkout.total')} paise={order.totalPaise} strong />
      </View>
      {order.address ? (
        <View style={{ gap: theme.space[1] }}>
          <Text variant="label" color="inkMuted">
            {t('checkout.deliverTo')}
          </Text>
          <Text>
            {[
              order.address.name,
              order.address.line1,
              order.address.line2,
              order.address.landmark,
              `${order.address.city} ${order.address.pincode}`,
            ]
              .filter(Boolean)
              .join(', ')}
          </Text>
        </View>
      ) : null}

      {order.status === 'awaiting_payment' ? (
        <Button
          variant="secondary"
          label={t('order.cancel')}
          loading={cancel.isPending}
          onPress={() =>
            Alert.alert(t('order.cancelTitle'), t('order.cancelBody'), [
              { text: t('order.keep'), style: 'cancel' },
              {
                text: t('order.cancel'),
                style: 'destructive',
                onPress: () =>
                  cancel.mutate(undefined, {
                    onError: (err) => Alert.alert(t('order.cancelFailed'), errorMessage(err, t)),
                  }),
              },
            ])
          }
        />
      ) : null}
    </View>
  );
}
