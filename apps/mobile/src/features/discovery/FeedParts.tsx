import {
  type Category,
  type FeedItem,
  formatPaise,
  type NearbyMaker,
  pickVariant,
} from '@xatu/shared';
import { Chip, NearMeIcon, Text, useTheme, VerifiedIcon } from '@xatu/ui';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import { ChevronRight } from 'lucide-react-native';
import type { TFunction } from 'i18next';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelRatio, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { HexAvatar } from '../../components/HexAvatar';
import { XImage } from '../../components/XImage';
import { track } from '../../lib/analytics';
import { useSession } from '../../store/session';

const googleMapsConfigured =
  (Constants.expoConfig?.extra as { googleMapsConfigured?: boolean } | undefined)
    ?.googleMapsConfigured === true;
/** Android needs a Google Maps key; without one the Map toggle is hidden, never a blank map. */
export const mapAvailable =
  Platform.OS === 'ios' || (Platform.OS === 'android' && googleMapsConfigured);

/** Warms the image cache with the variant XImage will pick for a full-width card. */
export function prefetchCards(items: FeedItem[], width: number): void {
  const variant = pickVariant(width, PixelRatio.get());
  const urls = items.flatMap((i) => (i.photo ? [i.photo.urls[variant]] : []));
  if (urls.length) void Image.prefetch(urls);
}

export function itemTitle(item: Pick<FeedItem, 'title' | 'titleTa'>, language: string): string {
  return language === 'ta' ? item.titleTa || item.title : item.title;
}

function priceText(item: FeedItem, t: TFunction): string {
  const price = formatPaise(item.fromPricePaise);
  return item.hasOptions ? t('catalog.from', { price }) : price;
}

/** One product in the feed (Feed design): maker row, photo with a price pill, short story. */
export const FeedCard = memo(function FeedCard({
  item,
  position,
  source,
}: {
  item: FeedItem;
  position: number;
  source: 'feed' | 'search';
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useSession((s) => s.language);
  const title = itemTitle(item, language);
  const description =
    language === 'ta'
      ? (item.descriptionTa ?? item.description)
      : (item.description ?? item.descriptionTa);
  const place = [item.maker.areaName, item.maker.city].filter(Boolean).join(', ');
  const open = () => {
    track('feed_item_opened', { product_id: item.id, position, source });
    router.push(`/p/${item.id}`);
  };

  return (
    <View style={{ gap: theme.space[2], paddingBottom: theme.space[6] }}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${item.maker.businessName}, ${place}, ${t('feed.km', { km: item.distanceKm })}`}
        onPress={() => router.push(`/s/${item.maker.handle}`)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 48 }}
      >
        <HexAvatar name={item.maker.businessName} size={40} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
            <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
              {item.maker.businessName}
            </Text>
            {item.maker.verified ? <VerifiedIcon size={18} color={theme.colors.sage} /> : null}
          </View>
          <Text variant="caption" color="inkMuted" numberOfLines={1}>
            {place} · {t('feed.km', { km: item.distanceKm })}
          </Text>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={[title, priceText(item, t), item.inStock ? null : t('catalog.soldOut')]
          .filter(Boolean)
          .join(', ')}
        onPress={open}
      >
        <XImage
          image={item.photo}
          aspectRatio={1}
          borderRadius={theme.radius.lg}
          accessibilityLabel={title}
        />
        <View
          style={{
            position: 'absolute',
            left: theme.space[3],
            right: theme.space[3],
            bottom: theme.space[3],
            flexDirection: 'row',
          }}
          pointerEvents="none"
        >
          <View
            style={{
              flexShrink: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[2],
              paddingHorizontal: theme.space[4],
              paddingVertical: theme.space[2],
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.surfaceRaised,
            }}
          >
            <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
              {title}
            </Text>
            <Text variant="heading">{priceText(item, t)}</Text>
            <ChevronRight size={18} strokeWidth={1.75} color={theme.colors.ink} />
          </View>
        </View>
      </Pressable>

      {!item.inStock ? (
        <Text variant="caption" color="critical">
          {t('catalog.soldOut')}
        </Text>
      ) : null}
      {description ? (
        <Text numberOfLines={2}>
          <Text variant="label">{item.maker.businessName} </Text>
          {description}
        </Text>
      ) : null}
    </View>
  );
});

/** "Near me" plus one chip per category; one selected at a time. */
export function CategoryChips({
  categories,
  selected,
  onSelect,
}: {
  categories: Category[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useSession((s) => s.language);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.space[2], paddingVertical: theme.space[1] }}
      accessibilityRole="radiogroup"
    >
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: selected === null }}
        onPress={() => onSelect(null)}
        style={{
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[1],
          paddingHorizontal: theme.space[4],
          borderRadius: theme.radius.pill,
          borderWidth: selected === null ? 1.5 : 1,
          borderColor: selected === null ? theme.colors.brandFill : theme.colors.line,
          backgroundColor: selected === null ? theme.colors.blush : theme.colors.surfaceRaised,
        }}
      >
        <NearMeIcon size={18} color={theme.colors.ink} />
        <Text variant="label">{t('feed.nearMe')}</Text>
      </Pressable>
      {categories.map((c) => (
        <Chip
          key={c.slug}
          label={language === 'ta' ? c.nameTa : c.nameEn}
          selected={selected === c.slug}
          onPress={() => onSelect(c.slug)}
        />
      ))}
    </ScrollView>
  );
}

/** Makers near you as hexagons; tap opens the shop. */
export function MakerRow({ makers }: { makers: NearbyMaker[] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (makers.length === 0) return null;
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" color="inkMuted">
        {t('feed.makersNear')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: theme.space[3] }}
      >
        {makers.slice(0, 12).map((m) => (
          <Pressable
            key={m.handle}
            accessibilityRole="link"
            accessibilityLabel={`${m.businessName}, ${t('feed.km', { km: m.distanceKm })}`}
            onPress={() => router.push(`/s/${m.handle}`)}
            style={{ width: 76, alignItems: 'center', gap: theme.space[1] }}
          >
            <HexAvatar name={m.businessName} size={64} />
            <Text variant="caption" numberOfLines={1} style={{ textAlign: 'center' }}>
              {m.businessName.split(' ')[0]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** Makers on a map at their rounded public points (never the exact pickup spot). */
export function MakerMap({
  makers,
  origin,
}: {
  makers: NearbyMaker[];
  origin: { lat: number; lng: number };
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const camera = { coordinates: { latitude: origin.lat, longitude: origin.lng }, zoom: 11 };
  const markers = makers.map((m) => ({
    id: m.handle,
    title: m.businessName,
    coordinates: { latitude: m.location.lat, longitude: m.location.lng },
  }));
  const openShop = (event: { id?: string }) => {
    if (event.id) router.push(`/s/${event.id}`);
  };
  return (
    <View style={{ gap: theme.space[2] }}>
      <View
        style={{
          height: 420,
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.colors.line,
        }}
        accessibilityLabel={t('feed.mapLabel', { count: makers.length })}
      >
        {Platform.OS === 'ios' ? (
          <AppleMaps.View
            style={StyleSheet.absoluteFill}
            cameraPosition={camera}
            markers={markers.map((m) => ({ ...m, tintColor: theme.colors.brand }))}
            onMarkerClick={openShop}
          />
        ) : (
          <GoogleMaps.View
            style={StyleSheet.absoluteFill}
            cameraPosition={camera}
            markers={markers}
            onMarkerClick={openShop}
          />
        )}
      </View>
      <Text variant="caption" color="inkMuted">
        {t('feed.mapHint')}
      </Text>
    </View>
  );
}
