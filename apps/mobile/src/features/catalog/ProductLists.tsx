import { formatPaise, type ProductCard, type SellerProductCard } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { ChevronRight, Plus } from 'lucide-react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { XImage } from '../../components/XImage';
import { errorMessage } from '../../lib/errors';
import { uuidv4 } from '../../lib/uuid';
import { useSession } from '../../store/session';
import { useMyProducts, useShopProducts } from './api';
import { StatusPill } from './parts';

export function startNewProduct() {
  router.push(`/shop/product/${uuidv4()}?new=1`);
}

function useTitle() {
  const language = useSession((s) => s.language);
  return (p: { title: string | null; titleTa: string | null }) =>
    (language === 'ta' ? p.titleTa || p.title : p.title || p.titleTa) ?? '';
}

function priceLine(p: Pick<ProductCard, 'fromPricePaise' | 'hasOptions'>, t: TFunction) {
  if (p.fromPricePaise <= 0) return '';
  const price = formatPaise(p.fromPricePaise);
  return p.hasOptions ? t('catalog.from', { price }) : price;
}

/** My shop → Products: every product with its status and stock, plus "Add a product". */
export function SellerProductList() {
  const { t } = useTranslation();
  const theme = useTheme();
  const query = useMyProducts();
  const title = useTitle();

  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="heading" accessibilityRole="header">
        {t('catalog.products')}
      </Text>
      {query.isPending ? (
        <LoadingState lines={2} />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState title={t('catalog.noProducts')} body={t('catalog.noProductsBody')} />
      ) : (
        query.data.map((p) => <SellerRow key={p.id} product={p} title={title(p)} />)
      )}
      <Button
        label={t('catalog.addProduct')}
        icon={<Plus size={20} strokeWidth={2} color={theme.colors.onMarigold} />}
        onPress={startNewProduct}
      />
    </View>
  );
}

function SellerRow({ product, title }: { product: SellerProductCard; title: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const label = title || t('catalog.untitled');
  const stock = product.madeToOrder
    ? null
    : product.totalStock > 0
      ? t('catalog.inStock', { count: product.totalStock })
      : t('catalog.soldOut');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        label,
        t(`catalog.status.${product.status}`),
        priceLine(product, t),
        stock,
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={() => router.push(`/shop/product/${product.id}`)}
      style={(s) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[2],
        minHeight: 72,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.line,
        backgroundColor: theme.colors.surfaceRaised,
        opacity: s.pressed ? 0.85 : 1,
      })}
    >
      <View style={{ width: 64 }}>
        <XImage
          image={product.photo}
          aspectRatio={1}
          borderRadius={theme.radius.sm}
          accessibilityLabel={label}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" numberOfLines={2}>
          {label}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.space[2],
            alignItems: 'center',
          }}
        >
          <StatusPill status={product.status} />
          <Text variant="caption" color="inkMuted">
            {[priceLine(product, t), stock].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      <ChevronRight size={22} strokeWidth={1.75} color={theme.colors.inkMuted} />
    </Pressable>
  );
}

/** A shop's live products as a two-column grid, with "Show more" paging. */
export function ShopProductGrid({ handle }: { handle: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const query = useShopProducts(handle, true);
  const title = useTitle();
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  if (query.isPending) return <LoadingState lines={2} />;
  if (query.isError)
    return (
      <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
    );
  if (items.length === 0)
    return (
      <EmptyState title={t('shop.public.noProducts')} body={t('shop.public.noProductsBody')} />
    );

  return (
    <View style={{ gap: theme.space[3] }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          rowGap: theme.space[4],
        }}
      >
        {items.map((p) => (
          <ProductTile key={p.id} product={p} title={title(p)} />
        ))}
      </View>
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          label={t('catalog.page.loadMore')}
          loading={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
        />
      ) : null}
    </View>
  );
}

function ProductTile({ product, title }: { product: ProductCard; title: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const price = priceLine(product, t);
  const note = product.inStock ? null : t('catalog.soldOut');
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[title, price, note].filter(Boolean).join(', ')}
      onPress={() => router.push(`/p/${product.id}`)}
      style={(s) => ({
        width: '48%',
        gap: theme.space[1],
        opacity: s.pressed ? 0.85 : 1,
      })}
    >
      <XImage
        image={product.photo}
        aspectRatio={1}
        borderRadius={theme.radius.md}
        accessibilityLabel={title}
      />
      <Text variant="label" numberOfLines={2}>
        {title}
      </Text>
      <Text variant="heading">{price}</Text>
      {note ? (
        <Text variant="caption" color="critical">
          {note}
        </Text>
      ) : null}
    </Pressable>
  );
}
