import { FlashList } from '@shopify/flash-list';
import { type FeedItem, normaliseQuery } from '@xatu/shared';
import { Text, useTheme } from '@xatu/ui';
import { Clock, Search, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../../components/States';
import { track } from '../../lib/analytics';
import { errorMessage } from '../../lib/errors';
import { useSearch } from './api';
import { FeedCard, prefetchCards } from './FeedParts';
import { addRecent, clearRecent, readRecent } from './recentSearches';
import { useBuyerLocation } from './useBuyerLocation';

/** Discover tab: search Tamil and English names, with recent searches kept on this phone. */
export function SearchScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const location = useBuyerLocation();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const search = useSearch(q, location.point);

  useEffect(() => {
    void readRecent().then(setRecent);
  }, []);

  // Search 400 ms after typing stops.
  useEffect(() => {
    const next = normaliseQuery(text);
    const timer = setTimeout(() => setQ(next), 400);
    return () => clearTimeout(timer);
  }, [text]);

  const pages = search.data?.pages ?? [];
  const items = useMemo(() => pages.flatMap((p) => p.items), [pages]);
  const terms = pages[0]?.terms ?? [];
  const extraTerms = terms.filter((term) => term !== q);

  // One event per finished search (never the words, only their length).
  const reported = useRef<string | null>(null);
  useEffect(() => {
    const firstPage = pages[0];
    if (!q || !firstPage || reported.current === q) return;
    reported.current = q;
    track('search_performed', {
      query_length: q.length,
      results: firstPage.items.length,
      transliterated: firstPage.terms.length > 1,
    });
    if (firstPage.items.length > 0) void addRecent(q).then(setRecent);
    prefetchCards(firstPage.items, Math.min(width, 600) - 32);
  }, [pages, q, width]);

  const header = (
    <View style={{ gap: theme.space[4], paddingBottom: theme.space[4] }}>
      <Text variant="title" accessibilityRole="header">
        {t('discover.title')}
      </Text>
      <OfflineBanner />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          minHeight: 56,
          paddingHorizontal: theme.space[4],
          borderRadius: theme.radius.pill,
          borderWidth: 1,
          borderColor: theme.colors.line,
          backgroundColor: theme.colors.surfaceRaised,
        }}
      >
        <Search size={20} strokeWidth={1.75} color={theme.colors.inkMuted} />
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          placeholder={t('discover.placeholder')}
          placeholderTextColor={theme.colors.inkMuted}
          accessibilityLabel={t('discover.placeholder')}
          returnKeyType="search"
          autoCorrect={false}
          maxLength={60}
          style={{
            flex: 1,
            fontSize: 18,
            color: theme.colors.ink,
            fontFamily: 'HindMadurai_500Medium',
          }}
        />
        {text ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('discover.clear')}
            onPress={() => {
              setText('');
              input.current?.focus();
            }}
            style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={20} strokeWidth={1.75} color={theme.colors.inkMuted} />
          </Pressable>
        ) : null}
      </View>

      {!q && recent.length > 0 ? (
        <View style={{ gap: theme.space[1] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="label" color="inkMuted" style={{ flex: 1 }}>
              {t('discover.recent')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void clearRecent().then(() => setRecent([]))}
              style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: theme.space[2] }}
            >
              <Text variant="label" color="brand">
                {t('discover.clearRecent')}
              </Text>
            </Pressable>
          </View>
          {recent.map((term) => (
            <Pressable
              key={term}
              accessibilityRole="button"
              onPress={() => setText(term)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space[3],
                minHeight: 48,
              }}
            >
              <Clock size={18} strokeWidth={1.75} color={theme.colors.inkMuted} />
              <Text>{term}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!q && recent.length === 0 ? <Text color="inkMuted">{t('discover.hint')}</Text> : null}

      {q && extraTerms.length > 0 ? (
        <Text variant="caption" color="inkMuted">
          {t('discover.alsoSearched', { terms: extraTerms.join(', ') })}
        </Text>
      ) : null}
      {q && search.isPending ? <LoadingState lines={2} /> : null}
      {q && search.isError ? (
        <ErrorState message={errorMessage(search.error, t)} onRetry={() => void search.refetch()} />
      ) : null}
      {q && search.isSuccess && items.length === 0 ? (
        <EmptyState title={t('discover.noResults', { q })} body={t('discover.noResultsBody')} />
      ) : null}
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <FlashList<FeedItem>
        data={q ? items : []}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => <FeedCard item={item} position={index} source="search" />}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
        }}
        ListFooterComponent={search.isFetchingNextPage ? <LoadingState lines={1} /> : null}
      />
    </SafeAreaView>
  );
}
