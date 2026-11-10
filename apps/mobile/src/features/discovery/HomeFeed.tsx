import { FlashList } from '@shopify/flash-list';
import type { FeedItem } from '@xatu/shared';
import { APP_NAME } from '@xatu/config/brand';
import { Button, Text, useTheme, XatuMark } from '@xatu/ui';
import { List, Map as MapIcon } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../../components/States';
import { errorMessage } from '../../lib/errors';
import { useCategories } from '../shop/api';
import { useFeed } from './api';
import {
  CategoryChips,
  FeedCard,
  MakerMap,
  MakerRow,
  mapAvailable,
  prefetchCards,
} from './FeedParts';
import { useBuyerLocation } from './useBuyerLocation';

/** Home feed (Feed design). Behind the `discovery` flag. */
export function HomeFeed() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const location = useBuyerLocation();
  const categories = useCategories();
  const [category, setCategory] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'map'>('list');
  const feed = useFeed(location.point, category);

  const pages = feed.data?.pages ?? [];
  const items = useMemo(() => pages.flatMap((p) => p.items), [pages]);
  const first = pages[0];
  const cardWidth = Math.min(width, 600) - theme.space[4] * 2;

  // Warm the image cache for the newest page so cards appear without a blank frame.
  const lastPage = pages[pages.length - 1];
  useEffect(() => {
    if (lastPage) prefetchCards(lastPage.items, cardWidth);
  }, [lastPage, cardWidth]);

  const header = (
    <View style={{ gap: theme.space[4], paddingBottom: theme.space[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <XatuMark size={28} />
        <Text
          variant="title"
          maxFontSizeMultiplier={1.4}
          accessibilityRole="header"
          style={{ flex: 1 }}
        >
          {APP_NAME.toLowerCase()}
        </Text>
        {mapAvailable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(mode === 'list' ? 'feed.showMap' : 'feed.showList')}
            onPress={() => setMode(mode === 'list' ? 'map' : 'list')}
            style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            {mode === 'list' ? (
              <MapIcon size={24} strokeWidth={1.75} color={theme.colors.ink} />
            ) : (
              <List size={24} strokeWidth={1.75} color={theme.colors.ink} />
            )}
          </Pressable>
        ) : null}
      </View>
      <OfflineBanner />
      {first?.origin.approximate && location.status !== 'checking' ? (
        <View
          style={{
            gap: theme.space[2],
            padding: theme.space[4],
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceWarm,
          }}
        >
          <Text>{t('feed.showingTrichy')}</Text>
          {location.status !== 'denied' ? (
            <Button
              variant="secondary"
              label={t('feed.useLocation')}
              onPress={() => void location.request()}
            />
          ) : (
            <Text variant="caption" color="inkMuted">
              {t('feed.locationDenied')}
            </Text>
          )}
        </View>
      ) : null}
      <CategoryChips
        categories={categories.data ?? []}
        selected={category}
        onSelect={setCategory}
      />
      {first?.makers ? <MakerRow makers={first.makers} /> : null}
      {mode === 'map' && first ? (
        <MakerMap makers={first.makers ?? []} origin={first.origin} />
      ) : null}
      {feed.isPending ? <LoadingState lines={3} /> : null}
      {feed.isError && items.length === 0 ? (
        <ErrorState message={errorMessage(feed.error, t)} onRetry={() => void feed.refetch()} />
      ) : null}
      {feed.isSuccess && items.length === 0 && mode === 'list' ? (
        <EmptyState
          title={t('feed.emptyTitle')}
          body={t(category ? 'feed.emptyCategory' : 'feed.emptyBody')}
        />
      ) : null}
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <FlashList<FeedItem>
        data={mode === 'list' ? items : []}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => <FeedCard item={item} position={index} source="feed" />}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        ListFooterComponent={feed.isFetchingNextPage ? <LoadingState lines={1} /> : null}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} />
        }
      />
    </SafeAreaView>
  );
}
