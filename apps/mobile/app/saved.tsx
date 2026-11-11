import { formatPaise, type SavedProductCard } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../src/components/States';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { XImage } from '../src/components/XImage';
import { itemTitle } from '../src/features/discovery/FeedParts';
import { useSavedProducts, useSocialEnabled } from '../src/features/social/api';
import { SaveButton } from '../src/features/social/SocialButtons';
import { errorMessage } from '../src/lib/errors';
import { useSession } from '../src/store/session';

/** Profile → Saved: products the buyer hearted that buyers can still see, newest first. */
export default function SavedScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useSocialEnabled();
  const query = useSavedProducts();
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={t('social.savedTitle')} />
      <OfflineBanner />
      {!enabled ? (
        <EmptyState title={t('social.savedEmpty')} body={t('social.savedEmptyBody')} />
      ) : query.isPending ? (
        <LoadingState />
      ) : query.isError && items.length === 0 ? (
        <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('social.savedEmpty')}
          body={t('social.savedEmptyBody')}
          action={<Button label={t('social.browse')} onPress={() => router.navigate('/home')} />}
        />
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {items.map((item) => (
            <SavedRow key={item.id} item={item} />
          ))}
          {query.hasNextPage ? (
            <Button
              variant="secondary"
              label={t('social.showMore')}
              loading={query.isFetchingNextPage}
              onPress={() => void query.fetchNextPage()}
            />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function SavedRow({ item }: { item: SavedProductCard }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useSession((s) => s.language);
  const title = itemTitle(item, language);
  const price = formatPaise(item.fromPricePaise);
  const priceText = item.hasOptions ? t('catalog.from', { price }) : price;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.line,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={[title, priceText, item.maker.businessName].join(', ')}
        onPress={() => router.push(`/p/${item.id}`)}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}
      >
        <View style={{ width: 72 }}>
          <XImage
            image={item.photo}
            aspectRatio={1}
            borderRadius={theme.radius.sm}
            accessibilityLabel={title}
          />
        </View>
        <View style={{ flex: 1, gap: theme.space[1] }}>
          <Text variant="heading" numberOfLines={2}>
            {title}
          </Text>
          <Text variant="label">{priceText}</Text>
          <Text variant="caption" color="inkMuted" numberOfLines={1}>
            {item.maker.businessName}
            {item.inStock ? '' : ` · ${t('catalog.soldOut')}`}
          </Text>
        </View>
      </Pressable>
      <SaveButton productId={item.id} title={title} source="saved" />
    </View>
  );
}
