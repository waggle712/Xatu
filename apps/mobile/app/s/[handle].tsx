import { type PublicShop, WEEKDAYS } from '@xatu/shared';
import { NearMeIcon, PickupSlotIcon, Text, TrustBadge, useTheme } from '@xatu/ui';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Polygon } from 'react-native-svg';
import { BackButton } from '../../src/components/BackButton';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../../src/components/States';
import { usePublicShop } from '../../src/features/shop/api';
import { errorMessage } from '../../src/lib/errors';
import { useSession } from '../../src/store/session';

export default function PublicShopScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const query = usePublicShop(handle);

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: theme.colors.surface }}
    >
      <ScrollView
        contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
        }
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <BackButton />
          <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>
            {handle}
          </Text>
        </View>
        <OfflineBanner />
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
        ) : (
          <ShopProfile shop={query.data} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function HexAvatar({ name }: { name: string }) {
  const theme = useTheme();
  return (
    <View
      style={{ width: 92, height: 100, alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
    >
      <Svg width={92} height={100} viewBox="0 0 92 100" style={{ position: 'absolute' }}>
        <Polygon
          points="46,3 88,27 88,73 46,97 4,73 4,27"
          fill={theme.colors.brandFill}
          stroke={theme.colors.brandFill}
          strokeWidth={4}
          strokeLinejoin="round"
        />
      </Svg>
      <Text variant="title" color="onBrand" style={{ fontSize: 28, lineHeight: 34 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

function ShopProfile({ shop }: { shop: PublicShop }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useSession((s) => s.language);
  const [tab, setTab] = useState<'shop' | 'reviews'>('shop');
  const story =
    (language === 'ta' ? (shop.storyTa ?? shop.storyEn) : (shop.storyEn ?? shop.storyTa)) ?? '';
  const modes = [
    shop.pickupAvailable ? t('shop.public.pickup') : null,
    shop.localDelivery ? t('shop.public.localDelivery') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const openDays = WEEKDAYS.filter((d) => (shop.openingHours[d]?.length ?? 0) > 0);

  return (
    <View style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
        <HexAvatar name={shop.businessName} />
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around' }}>
          <Stat value={shop.liveProductCount} label={t('shop.public.products')} />
          <Stat value={shop.completedOrderCount} label={t('shop.public.completed')} />
        </View>
      </View>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="title" accessibilityRole="header">
          {shop.businessName}
        </Text>
        {shop.verified ? <TrustBadge label={t('shop.public.verified')} /> : null}
        {story ? <Text>{story}</Text> : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[1],
            flexWrap: 'wrap',
          }}
        >
          <NearMeIcon size={18} color={theme.colors.inkMuted} />
          <Text variant="label" color="inkMuted" style={{ flexShrink: 1 }}>
            {[shop.areaName, shop.city].filter(Boolean).join(', ')} ({t('shop.public.approx')})
            {modes ? ` · ${modes}` : ''}
          </Text>
        </View>
      </View>

      {shop.status === 'paused' ? (
        <View
          style={{
            padding: theme.space[4],
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.blush,
          }}
        >
          <Text>{t('shop.public.paused')}</Text>
        </View>
      ) : null}

      {openDays.length > 0 ? (
        <View
          style={{
            gap: theme.space[1],
            padding: theme.space[4],
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.line,
            backgroundColor: theme.colors.surfaceRaised,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <PickupSlotIcon size={20} color={theme.colors.ink} />
            <Text variant="heading">{t('shop.public.hours')}</Text>
          </View>
          {WEEKDAYS.map((d) => (
            <View
              key={d}
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[2] }}
            >
              <Text variant="label">{t(`shop.hours.days.${d}`)}</Text>
              <Text variant="label" color="inkMuted">
                {(shop.openingHours[d] ?? []).map((r) => `${r.open}–${r.close}`).join(', ') ||
                  t('shop.hours.closed')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View
        style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.line }}
        accessibilityRole="tablist"
      >
        {(['shop', 'reviews'] as const).map((key) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            onPress={() => setTab(key)}
            style={{
              flex: 1,
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              borderBottomWidth: 2,
              borderBottomColor: tab === key ? theme.colors.brand : 'transparent',
            }}
          >
            <Text variant="heading" color={tab === key ? 'ink' : 'inkMuted'}>
              {t(key === 'shop' ? 'shop.public.shopTab' : 'shop.public.reviewsTab')}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === 'shop' ? (
        <EmptyState title={t('shop.public.noProducts')} body={t('shop.public.noProductsBody')} />
      ) : (
        <EmptyState title={t('shop.public.noReviews')} body={t('shop.public.noReviewsBody')} />
      )}
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View
      style={{ alignItems: 'center', flexShrink: 1 }}
      accessible
      accessibilityLabel={`${value} ${label}`}
    >
      <Text variant="price">{String(value)}</Text>
      <Text variant="caption" color="inkMuted" style={{ textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  );
}
