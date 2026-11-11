import { formatPaise, type OrderStatus } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { Minus, Plus, ShoppingBag } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, View } from 'react-native';
import { track } from '../../lib/analytics';
import { errorMessage } from '../../lib/errors';
import { otherSellerOf, useBagCount, useCheckoutEnabled, useSetCartItem } from './api';

/** "Add to bag" on the product page. Asks before replacing a bag from another maker. */
export function AddToBagButton({
  productId,
  variantId,
  disabled,
}: {
  productId: string;
  variantId: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useCheckoutEnabled();
  const setItem = useSetCartItem();
  if (!enabled) return null;

  const add = (replaceCart: boolean) =>
    setItem.mutate(
      { variantId, quantity: 1, replaceCart },
      {
        onSuccess: (cart) => {
          const qty = cart.lines.find((l) => l.variantId === variantId)?.quantity ?? 1;
          track('cart_item_added', { product_id: productId, quantity: qty });
          Alert.alert(t('bag.added'), undefined, [
            { text: t('bag.keepShopping'), style: 'cancel' },
            { text: t('bag.view'), onPress: () => router.push('/bag') },
          ]);
        },
        onError: (err) => {
          const other = otherSellerOf(err);
          if (other) {
            Alert.alert(
              t('bag.otherMakerTitle'),
              t('bag.otherMakerBody', { name: other.businessName }),
              [
                { text: t('bag.keepBag'), style: 'cancel' },
                { text: t('bag.startNew'), style: 'destructive', onPress: () => add(true) },
              ],
            );
          } else {
            Alert.alert(t('bag.addFailed'), errorMessage(err, t));
          }
        },
      },
    );

  // Adding the same item again raises its quantity by one (the server keeps the bag).
  return (
    <Button
      label={t('bag.add')}
      icon={<ShoppingBag size={20} strokeWidth={2} color={theme.colors.onMarigold} />}
      disabled={disabled}
      loading={setItem.isPending}
      onPress={() => add(false)}
    />
  );
}

/** Bag icon with a count, for headers. */
export function BagButton() {
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useCheckoutEnabled();
  const count = useBagCount();
  if (!enabled) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? t('bag.openWithCount', { count }) : t('bag.open')}
      onPress={() => router.push('/bag')}
      style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
    >
      <ShoppingBag size={24} strokeWidth={1.75} color={theme.colors.ink} />
      {count > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: 4,
            right: 2,
            minWidth: 20,
            height: 20,
            paddingHorizontal: 4,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.marigold,
          }}
        >
          <Text variant="caption" color="onMarigold" maxFontSizeMultiplier={1.3}>
            {count > 99 ? '99+' : String(count)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function QuantityStepper({
  value,
  max,
  onChange,
  label,
  busy,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const button = (icon: React.ReactNode, a11y: string, next: number, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled || busy}
      onPress={() => onChange(next)}
      style={{
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 24,
        borderWidth: 1,
        borderColor: theme.colors.line,
        backgroundColor: theme.colors.surfaceRaised,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon}
    </Pressable>
  );
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}
      accessibilityLabel={t('bag.quantityOf', { title: label, count: value })}
    >
      {button(<Minus size={20} color={theme.colors.ink} />, t('bag.less'), value - 1, value <= 0)}
      <Text variant="heading" style={{ minWidth: 28, textAlign: 'center' }}>
        {String(value)}
      </Text>
      {button(<Plus size={20} color={theme.colors.ink} />, t('bag.more'), value + 1, value >= max)}
    </View>
  );
}

/** Status pill. Trust colours only for good news; critical for the end states. */
export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tone =
    status === 'completed'
      ? { bg: theme.colors.sageSoft, fg: 'ink' as const }
      : [
            'expired',
            'cancelled_by_buyer',
            'cancelled_by_seller',
            'refunded',
            'partially_refunded',
          ].includes(status)
        ? { bg: theme.colors.surfaceWarm, fg: 'inkMuted' as const }
        : { bg: theme.colors.blush, fg: 'ink' as const };
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: theme.space[3],
        paddingVertical: theme.space[1],
        borderRadius: theme.radius.pill,
        backgroundColor: tone.bg,
      }}
    >
      <Text variant="label" color={tone.fg}>
        {t(`orderStatus.${status}`)}
      </Text>
    </View>
  );
}

export function MoneyRow({
  label,
  paise,
  strong,
}: {
  label: string;
  paise: number;
  strong?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: theme.space[2],
        flexWrap: 'wrap',
      }}
      accessible
      accessibilityLabel={`${label}, ${formatPaise(paise)}`}
    >
      <Text variant={strong ? 'heading' : 'body'} color={strong ? 'ink' : 'inkMuted'}>
        {label}
      </Text>
      <Text variant={strong ? 'price' : 'label'}>{formatPaise(paise)}</Text>
    </View>
  );
}
