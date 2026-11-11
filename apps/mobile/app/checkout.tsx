import { type Address, formatPaise, type OrderMode } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { Bike, CheckCircle2, Circle, Plus, ShoppingBag } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../src/components/States';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import {
  useAddresses,
  useCart,
  useCheckoutEnabled,
  usePlaceOrder,
} from '../src/features/orders/api';
import { MoneyRow } from '../src/features/orders/parts';
import { track } from '../src/lib/analytics';
import { ApiRequestError, NetworkError } from '../src/lib/api';
import { errorMessage } from '../src/lib/errors';

/**
 * Checkout: how to get it (pickup or local delivery), where (address), the server's totals,
 * then "Place order". No payment yet (prompt 15): the order waits 15 minutes, holding stock.
 * No "money held" copy until Protected Pay is confirmed.
 */
export default function CheckoutScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useCheckoutEnabled();
  const cart = useCart();
  const addresses = useAddresses();
  const place = usePlaceOrder();
  const [mode, setMode] = useState<OrderMode | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);

  const options = cart.data?.options ?? [];
  useEffect(() => {
    if (!mode && options.length > 0) setMode(options[0]!.mode);
  }, [mode, options]);
  useEffect(() => {
    if (!addressId && addresses.data?.length) {
      setAddressId((addresses.data.find((a) => a.isDefault) ?? addresses.data[0]!).id);
    }
  }, [addressId, addresses.data]);

  if (!enabled || cart.isPending) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title={t('checkout.title')} />
        {enabled ? (
          <LoadingState />
        ) : (
          <EmptyState title={t('bag.empty')} body={t('bag.emptyBody')} />
        )}
      </Screen>
    );
  }
  if (cart.isError) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title={t('checkout.title')} />
        <ErrorState message={errorMessage(cart.error, t)} onRetry={() => void cart.refetch()} />
      </Screen>
    );
  }
  if (!cart.data || cart.data.lines.length === 0 || options.length === 0) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title={t('checkout.title')} />
        <EmptyState title={t('bag.empty')} body={t('bag.emptyBody')} />
      </Screen>
    );
  }

  const chosen = options.find((o) => o.mode === mode) ?? options[0]!;
  const needsAddress = chosen.mode === 'local_delivery';
  const ready = !needsAddress || !!addressId;

  const submit = () =>
    place.mutate(
      {
        fulfilmentMode: chosen.mode,
        ...(needsAddress && addressId ? { addressId } : {}),
        expectedTotalPaise: chosen.totalPaise,
      },
      {
        onSuccess: (order) => router.replace(`/order/${order.id}`),
        onError: (err) => {
          const reason =
            err instanceof NetworkError
              ? 'network'
              : err instanceof ApiRequestError &&
                  [
                    'out_of_stock',
                    'price_changed',
                    'cart_has_problems',
                    'shop_not_accepting',
                  ].includes(err.code)
                ? (err.code as 'out_of_stock')
                : 'other';
          track('order_failed', { reason });
        },
      },
    );

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        title={t('checkout.title')}
        subtitle={
          cart.data.seller ? t('bag.from', { name: cart.data.seller.businessName }) : undefined
        }
      />
      <OfflineBanner />

      <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup">
        <Text variant="heading" accessibilityRole="header">
          {t('checkout.how')}
        </Text>
        {options.map((o) => {
          const selected = o.mode === chosen.mode;
          const Icon = o.mode === 'pickup' ? ShoppingBag : Bike;
          return (
            <Pressable
              key={o.mode}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${t(`checkout.modes.${o.mode}`)}, ${
                o.deliveryFeePaise > 0 ? formatPaise(o.deliveryFeePaise) : t('checkout.free')
              }`}
              onPress={() => setMode(o.mode)}
              style={radioStyle(theme, selected)}
            >
              {selected ? (
                <CheckCircle2 size={22} strokeWidth={1.75} color={theme.colors.ink} />
              ) : (
                <Circle size={22} strokeWidth={1.75} color={theme.colors.inkMuted} />
              )}
              <Icon size={22} strokeWidth={1.75} color={theme.colors.ink} />
              <View style={{ flex: 1 }}>
                <Text variant="label">{t(`checkout.modes.${o.mode}`)}</Text>
                <Text variant="caption" color="inkMuted">
                  {o.mode === 'pickup'
                    ? t('checkout.pickupHint', {
                        place: [cart.data.seller?.areaName, cart.data.seller?.city]
                          .filter(Boolean)
                          .join(', '),
                      })
                    : t('checkout.deliveryHint')}
                </Text>
              </View>
              <Text variant="label">
                {o.deliveryFeePaise > 0 ? formatPaise(o.deliveryFeePaise) : t('checkout.free')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {needsAddress ? (
        <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup">
          <Text variant="heading" accessibilityRole="header">
            {t('checkout.deliverTo')}
          </Text>
          {addresses.isPending ? (
            <LoadingState lines={2} />
          ) : addresses.isError ? (
            <ErrorState
              message={errorMessage(addresses.error, t)}
              onRetry={() => void addresses.refetch()}
            />
          ) : (
            (addresses.data ?? []).map((a) => (
              <AddressOption
                key={a.id}
                address={a}
                selected={a.id === addressId}
                onPress={() => setAddressId(a.id)}
              />
            ))
          )}
          <Button
            variant="secondary"
            label={t('checkout.addAddress')}
            icon={<Plus size={20} strokeWidth={2} color={theme.colors.ink} />}
            onPress={() => router.push('/address-new')}
          />
        </View>
      ) : null}

      <View style={{ gap: theme.space[2] }}>
        <MoneyRow label={t('bag.subtotal')} paise={cart.data.subtotalPaise} />
        <MoneyRow label={t('checkout.deliveryFee')} paise={chosen.deliveryFeePaise} />
        <MoneyRow label={t('checkout.total')} paise={chosen.totalPaise} strong />
        <Text variant="caption" color="inkMuted">
          {t('bag.inclGst')}
        </Text>
      </View>

      <Text variant="caption" color="inkMuted">
        {t('checkout.holdNote')}
      </Text>
      {place.isError ? (
        <Text color="critical" accessibilityLiveRegion="polite">
          {errorMessage(place.error, t)}
        </Text>
      ) : null}
      <Button
        label={t('checkout.place')}
        disabled={!ready}
        loading={place.isPending}
        onPress={submit}
      />
    </Screen>
  );
}

function AddressOption({
  address,
  selected,
  onPress,
}: {
  address: Address;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const lines = [
    address.line1,
    address.line2,
    address.landmark,
    `${address.city} ${address.pincode}`,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${address.name}, ${lines}`}
      onPress={onPress}
      style={radioStyle(theme, selected)}
    >
      {selected ? (
        <CheckCircle2 size={22} strokeWidth={1.75} color={theme.colors.ink} />
      ) : (
        <Circle size={22} strokeWidth={1.75} color={theme.colors.inkMuted} />
      )}
      <View style={{ flex: 1 }}>
        <Text variant="label">{address.name}</Text>
        <Text variant="caption" color="inkMuted">
          {lines}
        </Text>
      </View>
    </Pressable>
  );
}

function radioStyle(theme: ReturnType<typeof useTheme>, selected: boolean) {
  return {
    minHeight: 56,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space[3],
    paddingHorizontal: theme.space[4],
    paddingVertical: theme.space[3],
    borderRadius: theme.radius.md,
    borderWidth: selected ? 1.5 : 1,
    borderColor: selected ? theme.colors.brandFill : theme.colors.line,
    backgroundColor: selected ? theme.colors.blush : theme.colors.surfaceRaised,
  };
}
