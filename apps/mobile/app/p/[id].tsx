import { formatPaise, type PublicProduct } from '@xatu/shared';
import { Chip, PickupSlotIcon, Text, TrustBadge, useTheme } from '@xatu/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { Bike, ChevronRight, Package, ShoppingBag } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '../../src/components/BackButton';
import { HexAvatar } from '../../src/components/HexAvatar';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../../src/components/States';
import { XImage } from '../../src/components/XImage';
import { usePublicProduct } from '../../src/features/catalog/api';
import { ReportLink, SaveButton, ShareButton } from '../../src/features/social/SocialButtons';
import { track, useFeatureFlag } from '../../src/lib/analytics';
import { ApiRequestError } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { clearPendingLink } from '../../src/lib/pendingLink';
import { useSession } from '../../src/store/session';

/**
 * Product page (Product design), with save, share and report (behind `social`). Not here yet:
 * buying (prompt 14), delivery fees, reviews and trust score (prompt 19). No "money held" copy
 * until Protected Pay is confirmed with Razorpay and a lawyer.
 */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useFeatureFlag('catalog');
  const query = usePublicProduct(id);
  const gone = query.error instanceof ApiRequestError && query.error.status === 404;
  useEffect(() => clearPendingLink(`/p/${id}`), [id]);

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: theme.colors.surface }}
    >
      <ScrollView
        contentContainerStyle={{ paddingBottom: theme.space[6], gap: theme.space[4] }}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
        }
      >
        <View style={{ paddingHorizontal: theme.space[4] }}>
          <BackButton />
        </View>
        <View style={{ paddingHorizontal: theme.space[4] }}>
          <OfflineBanner />
        </View>
        {!enabled || gone ? (
          <View style={{ paddingHorizontal: theme.space[4] }}>
            <EmptyState
              title={t('catalog.page.notAvailable')}
              body={t('catalog.page.notAvailableBody')}
            />
          </View>
        ) : query.isPending ? (
          <View style={{ paddingHorizontal: theme.space[4] }}>
            <LoadingState />
          </View>
        ) : query.isError ? (
          <View style={{ paddingHorizontal: theme.space[4] }}>
            <ErrorState
              message={errorMessage(query.error, t)}
              onRetry={() => void query.refetch()}
            />
          </View>
        ) : (
          <ProductDetails product={query.data} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ProductDetails({ product }: { product: PublicProduct }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useSession((s) => s.language);
  const [variantId, setVariantId] = useState(product.variants[0]!.id);
  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0]!;
  const title = language === 'ta' ? product.titleTa || product.title : product.title;
  const description =
    language === 'ta'
      ? (product.descriptionTa ?? product.description)
      : (product.description ?? product.descriptionTa);
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track('product_viewed', { product_id: product.id, shop_handle: product.maker.handle });
  }, [product.id, product.maker.handle]);

  const availability =
    product.madeToOrder && product.leadTimeDays
      ? t('catalog.madeToOrderDays', { count: product.leadTimeDays })
      : variant.stock > 0
        ? t('catalog.inStock', { count: variant.stock })
        : t('catalog.soldOut');
  const modeIcon = { pickup: ShoppingBag, local_delivery: Bike, courier: Package } as const;
  const optionLabel = (v: (typeof product.variants)[number]) =>
    (language === 'ta' ? v.labelTa || v.label : v.label || v.labelTa) ?? '';

  return (
    <View style={{ gap: theme.space[4] }}>
      <Gallery product={product} title={title} />
      <View style={{ paddingHorizontal: theme.space[4], gap: theme.space[4] }}>
        <View style={{ gap: theme.space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <View style={{ flex: 1, alignItems: 'flex-start' }}>
              <View
                style={{
                  paddingHorizontal: theme.space[3],
                  paddingVertical: theme.space[1],
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.blush,
                }}
              >
                <Text variant="caption">
                  {t('catalog.page.handmadeIn', { city: product.maker.city })}
                </Text>
              </View>
            </View>
            <ShareButton
              subject={{
                type: 'product',
                id: product.id,
                title,
                makerName: product.maker.businessName,
              }}
            />
            <SaveButton productId={product.id} title={title} source="product" />
          </View>
          <Text variant="title" accessibilityRole="header">
            {title}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              flexWrap: 'wrap',
              gap: theme.space[2],
            }}
          >
            <Text variant="price">{formatPaise(variant.pricePaise)}</Text>
            <Text
              variant="label"
              color={variant.stock > 0 || product.madeToOrder ? 'inkMuted' : 'critical'}
            >
              {t('catalog.details.inclGst')} · {availability}
            </Text>
          </View>
        </View>

        {product.variants.length > 1 ? (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="label" color="inkMuted">
              {t('catalog.page.chooseOption')}
            </Text>
            <View
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}
              accessibilityRole="radiogroup"
            >
              {product.variants.map((v) => (
                <Chip
                  key={v.id}
                  label={`${optionLabel(v)} · ${formatPaise(v.pricePaise)}`}
                  selected={v.id === variant.id}
                  onPress={() => setVariantId(v.id)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('catalog.page.maker', { name: product.maker.businessName })}
          onPress={() => router.push(`/s/${product.maker.handle}`)}
          style={(s) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[3],
            padding: theme.space[3],
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.colors.line,
            backgroundColor: theme.colors.surfaceRaised,
            opacity: s.pressed ? 0.85 : 1,
          })}
        >
          <HexAvatar name={product.maker.businessName} size={52} />
          <View style={{ flex: 1, gap: theme.space[1] }}>
            <Text variant="heading" numberOfLines={2}>
              {product.maker.businessName}
            </Text>
            {product.maker.verified ? <TrustBadge label={t('shop.public.verified')} /> : null}
          </View>
          <ChevronRight size={22} strokeWidth={1.75} color={theme.colors.inkMuted} />
        </Pressable>

        {!product.maker.acceptingOrders ? (
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

        {product.fulfilmentModes.length > 0 ? (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="heading">{t('catalog.page.howToGet')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {product.fulfilmentModes.map((mode) => {
                const Icon = modeIcon[mode];
                return (
                  <View
                    key={mode}
                    accessible
                    accessibilityLabel={t(`catalog.details.modes.${mode}`)}
                    style={{
                      flexBasis: '30%',
                      flexGrow: 1,
                      minHeight: 88,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: theme.space[1],
                      padding: theme.space[2],
                      borderRadius: theme.radius.md,
                      borderWidth: 1,
                      borderColor: theme.colors.line,
                      backgroundColor: theme.colors.surfaceRaised,
                    }}
                  >
                    <Icon size={22} strokeWidth={1.75} color={theme.colors.ink} />
                    <Text variant="label" style={{ textAlign: 'center' }}>
                      {t(`catalog.details.modes.${mode}`)}
                    </Text>
                  </View>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <PickupSlotIcon size={18} color={theme.colors.inkMuted} />
              <Text variant="caption" color="inkMuted" style={{ flexShrink: 1 }}>
                {[product.maker.areaName, product.maker.city].filter(Boolean).join(', ')} (
                {t('shop.public.approx')})
              </Text>
            </View>
          </View>
        ) : null}

        {description ? (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="heading">{t('catalog.page.about')}</Text>
            <Text>{description}</Text>
          </View>
        ) : null}
        <ReportLink target={{ type: 'product', id: product.id }} />
      </View>
    </View>
  );
}

/** Swipeable photos with page dots. Each photo shows its blurhash first, never a broken image. */
function Gallery({ product, title }: { product: PublicProduct; title: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));

  if (product.photos.length === 0) {
    return <XImage image={null} aspectRatio={1} accessibilityLabel={title} borderRadius={0} />;
  }
  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
      >
        {product.photos.map((photo, i) => (
          <View key={photo.id} style={{ width }}>
            <XImage
              image={photo}
              aspectRatio={1}
              borderRadius={0}
              accessibilityLabel={`${title}, ${t('catalog.photos.photo', { n: i + 1, count: product.photos.length })}`}
            />
          </View>
        ))}
      </ScrollView>
      {product.photos.length > 1 ? (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
            marginTop: theme.space[2],
          }}
          accessibilityElementsHidden
        >
          {product.photos.map((photo, i) => (
            <View
              key={photo.id}
              style={{
                width: i === index ? 20 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === index ? theme.colors.plum : theme.colors.taupe,
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
