import { type CartLine, formatPaise, MAX_LINE_QUANTITY } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, View } from 'react-native';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../src/components/States';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { XImage } from '../src/components/XImage';
import { useCart, useCheckoutEnabled, useSetCartItem } from '../src/features/orders/api';
import { QuantityStepper } from '../src/features/orders/parts';
import { errorMessage } from '../src/lib/errors';
import { useSession } from '../src/store/session';

/** The bag: one maker, server prices, problems shown per line, then checkout. */
export default function BagScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useCheckoutEnabled();
  const cart = useCart();
  const data = cart.data;
  const blocked = data?.lines.some((l) => l.problem !== null) ?? false;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        title={t('bag.title')}
        subtitle={data?.seller ? t('bag.from', { name: data.seller.businessName }) : undefined}
      />
      <OfflineBanner />
      {!enabled ? (
        <EmptyState title={t('bag.empty')} body={t('bag.emptyBody')} />
      ) : cart.isPending ? (
        <LoadingState />
      ) : cart.isError ? (
        <ErrorState message={errorMessage(cart.error, t)} onRetry={() => void cart.refetch()} />
      ) : !data || data.lines.length === 0 ? (
        <EmptyState
          title={t('bag.empty')}
          body={t('bag.emptyBody')}
          action={<Button label={t('social.browse')} onPress={() => router.navigate('/home')} />}
        />
      ) : (
        <View style={{ gap: theme.space[4] }}>
          {data.lines.map((line) => (
            <BagLine key={line.variantId} line={line} />
          ))}
          {data.seller && !data.seller.acceptingOrders ? (
            <View
              style={{
                padding: theme.space[4],
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.blush,
              }}
            >
              <Text>{t('catalog.page.notAccepting')}</Text>
            </View>
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: theme.space[2],
            }}
            accessible
            accessibilityLabel={`${t('bag.subtotal')}, ${formatPaise(data.subtotalPaise)}`}
          >
            <Text variant="heading">{t('bag.subtotal')}</Text>
            <Text variant="price">{formatPaise(data.subtotalPaise)}</Text>
          </View>
          <Text variant="caption" color="inkMuted">
            {t('bag.inclGst')}
          </Text>
          {blocked ? (
            <Text color="critical" accessibilityLiveRegion="polite">
              {t('bag.fixProblems')}
            </Text>
          ) : null}
          <Button
            label={t('bag.checkout')}
            disabled={blocked || data.options.length === 0 || !data.seller?.acceptingOrders}
            onPress={() => router.push('/checkout')}
          />
        </View>
      )}
    </Screen>
  );
}

function BagLine({ line }: { line: CartLine }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useSession((s) => s.language);
  const setItem = useSetCartItem();
  const title =
    (language === 'ta' ? line.titleTa || line.title : line.title) || t('bag.unavailableItem');
  const label = language === 'ta' ? line.variantLabelTa || line.variantLabel : line.variantLabel;
  const change = (quantity: number) =>
    setItem.mutate(
      { variantId: line.variantId, quantity },
      { onError: (err) => Alert.alert(t('bag.updateFailed'), errorMessage(err, t)) },
    );
  const max = Math.min(MAX_LINE_QUANTITY, Math.max(line.available ?? 0, line.quantity));

  return (
    <View
      style={{
        gap: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: line.problem ? theme.colors.critical : theme.colors.line,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={[title, label, formatPaise(line.unitPricePaise)]
          .filter(Boolean)
          .join(', ')}
        onPress={() => router.push(`/p/${line.productId}`)}
        style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}
      >
        <View style={{ width: 64 }}>
          <XImage
            image={line.photo}
            aspectRatio={1}
            borderRadius={theme.radius.sm}
            accessibilityLabel={title}
          />
        </View>
        <View style={{ flex: 1, gap: theme.space[1] }}>
          <Text variant="heading" numberOfLines={2}>
            {title}
          </Text>
          {label ? (
            <Text variant="caption" color="inkMuted">
              {label}
            </Text>
          ) : null}
          <Text variant="label">{formatPaise(line.unitPricePaise)}</Text>
        </View>
      </Pressable>
      {line.problem ? (
        <Text variant="label" color="critical">
          {line.problem === 'unavailable'
            ? t('bag.problemUnavailable')
            : t('bag.problemStock', { count: line.available ?? 0 })}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: theme.space[2],
        }}
      >
        {line.problem === 'unavailable' ? (
          <View />
        ) : (
          <QuantityStepper
            value={line.quantity}
            max={max}
            onChange={change}
            label={title}
            busy={setItem.isPending}
          />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('bag.remove', { title })}
          onPress={() => change(0)}
          style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}
        >
          <Trash2 size={18} strokeWidth={1.75} color={theme.colors.inkMuted} />
          <Text variant="label" color="inkMuted">
            {t('bag.removeShort')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
