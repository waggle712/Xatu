import type { FollowedShop } from '@xatu/shared';
import { Button, Text, useTheme, VerifiedIcon } from '@xatu/ui';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { HexAvatar } from '../src/components/HexAvatar';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../src/components/States';
import { Screen } from '../src/components/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { useFollowing, useSocialEnabled } from '../src/features/social/api';
import { FollowButton } from '../src/features/social/SocialButtons';
import { errorMessage } from '../src/lib/errors';

/** Profile → Following: makers the buyer follows (public shops only), newest first. */
export default function FollowingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useSocialEnabled();
  const query = useFollowing();
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={t('social.followingTitle')} />
      <OfflineBanner />
      {!enabled ? (
        <EmptyState title={t('social.followingEmpty')} body={t('social.followingEmptyBody')} />
      ) : query.isPending ? (
        <LoadingState />
      ) : query.isError && items.length === 0 ? (
        <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('social.followingEmpty')}
          body={t('social.followingEmptyBody')}
          action={<Button label={t('social.browse')} onPress={() => router.navigate('/home')} />}
        />
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {items.map((shop) => (
            <ShopRow key={shop.handle} shop={shop} />
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

function ShopRow({ shop }: { shop: FollowedShop }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const place = [shop.areaName, shop.city].filter(Boolean).join(', ');
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
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
        accessibilityLabel={[shop.businessName, place].filter(Boolean).join(', ')}
        onPress={() => router.push(`/s/${shop.handle}`)}
        style={{
          flexGrow: 1,
          flexBasis: 180,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          minHeight: 48,
        }}
      >
        <HexAvatar name={shop.businessName} size={48} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
            <Text variant="heading" numberOfLines={2} style={{ flexShrink: 1 }}>
              {shop.businessName}
            </Text>
            {shop.verified ? <VerifiedIcon size={18} color={theme.colors.sage} /> : null}
          </View>
          <Text variant="caption" color="inkMuted" numberOfLines={2}>
            {place}
            {shop.acceptingOrders ? '' : ` · ${t('social.shopPaused')}`}
          </Text>
        </View>
      </Pressable>
      <FollowButton handle={shop.handle} businessName={shop.businessName} />
    </View>
  );
}
