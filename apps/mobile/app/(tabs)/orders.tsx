import { formatPaise, type OrderView } from '@xatu/shared';
import { Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Placeholder } from '../../src/components/Placeholder';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../../src/components/States';
import { useCheckoutEnabled, useOrders } from '../../src/features/orders/api';
import { OrderStatusPill } from '../../src/features/orders/parts';
import { errorMessage } from '../../src/lib/errors';

export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useCheckoutEnabled();
  const orders = useOrders();
  if (!enabled) return <Placeholder title={t('orders.title')} body={t('orders.empty')} />;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: theme.space[4], gap: theme.space[3] }}
        refreshControl={
          <RefreshControl
            refreshing={orders.isRefetching}
            onRefresh={() => void orders.refetch()}
          />
        }
      >
        <Text variant="title" accessibilityRole="header">
          {t('orders.title')}
        </Text>
        <OfflineBanner />
        {orders.isPending ? (
          <LoadingState />
        ) : orders.isError ? (
          <ErrorState
            message={errorMessage(orders.error, t)}
            onRetry={() => void orders.refetch()}
          />
        ) : orders.data.length === 0 ? (
          <EmptyState title={t('orders.none')} body={t('orders.empty')} />
        ) : (
          orders.data.map((o) => <OrderRow key={o.id} order={o} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function OrderRow({ order }: { order: OrderView }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const count = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${order.code}, ${order.seller.businessName}, ${t(`orderStatus.${order.status}`)}, ${formatPaise(order.totalPaise)}`}
      onPress={() => router.push(`/order/${order.id}`)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[4],
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.line,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <View style={{ flex: 1, gap: theme.space[1] }}>
        <Text variant="heading" numberOfLines={2}>
          {order.seller.businessName}
        </Text>
        <Text variant="caption" color="inkMuted">
          {order.code} · {t('orders.items', { count })} · {formatPaise(order.totalPaise)}
        </Text>
        <OrderStatusPill status={order.status} />
      </View>
      <ChevronRight size={22} strokeWidth={1.75} color={theme.colors.inkMuted} />
    </Pressable>
  );
}
