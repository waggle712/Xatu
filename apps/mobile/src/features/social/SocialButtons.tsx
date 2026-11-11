import { APP_NAME } from '@xatu/config/brand';
import { productSharePath, shareUrl, shopSharePath } from '@xatu/shared';
import { Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { Flag, Heart, Share2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, Share, View } from 'react-native';
import { track } from '../../lib/analytics';
import { WEB_URL } from '../../lib/config';
import { errorMessage } from '../../lib/errors';
import { useMyShop } from '../shop/api';
import {
  useIsFollowing,
  useIsSaved,
  useSocialEnabled,
  useToggleFollow,
  useToggleSave,
} from './api';

type SaveSource = 'feed' | 'search' | 'product' | 'saved';

/**
 * The heart. `overlay` sits on a photo (round raised background so it reads on any image);
 * `plain` sits in a header row. Always a 48dp target.
 */
export function SaveButton({
  productId,
  title,
  source,
  overlay = false,
}: {
  productId: string;
  title: string;
  source: SaveSource;
  overlay?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useSocialEnabled();
  const saved = useIsSaved(productId);
  const toggle = useToggleSave(productId);
  if (!enabled) return null;

  const onPress = () => {
    const on = !saved;
    toggle.mutate(
      { on },
      {
        onSuccess: () =>
          on
            ? track('product_saved', { product_id: productId, source })
            : track('product_unsaved', { product_id: productId }),
        onError: (err) => Alert.alert(t('social.saveFailed'), errorMessage(err, t)),
      },
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(saved ? 'social.unsaveLabel' : 'social.saveLabel', { title })}
      accessibilityState={{ selected: saved }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 24,
        backgroundColor: overlay ? theme.colors.surfaceRaised : 'transparent',
        borderWidth: overlay ? 1 : 0,
        borderColor: theme.colors.line,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Heart
        size={24}
        strokeWidth={1.75}
        color={saved ? theme.colors.brand : theme.colors.ink}
        fill={saved ? theme.colors.brand : 'transparent'}
      />
    </Pressable>
  );
}

/** Follow / Following pill for a shop page. Hidden on your own shop. */
export function FollowButton({ handle, businessName }: { handle: string; businessName: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useSocialEnabled();
  const following = useIsFollowing(handle);
  const toggle = useToggleFollow(handle);
  const myShop = useMyShop();
  if (!enabled || myShop.data?.handle === handle) return null;

  const onPress = () => {
    const on = !following;
    toggle.mutate(
      { on },
      {
        onSuccess: () => track(on ? 'shop_followed' : 'shop_unfollowed', { shop_handle: handle }),
        onError: (err) => Alert.alert(t('social.followFailed'), errorMessage(err, t)),
      },
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(following ? 'social.unfollowLabel' : 'social.followLabel', {
        name: businessName,
      })}
      accessibilityState={{ selected: following }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        maxWidth: '100%',
        paddingHorizontal: theme.space[6],
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: following ? theme.colors.line : theme.colors.marigold,
        backgroundColor: following ? theme.colors.surfaceRaised : theme.colors.marigold,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {/* Capped at 200% so the one-word Tamil label never splits mid-word. */}
      <Text variant="label" color={following ? 'ink' : 'onMarigold'} maxFontSizeMultiplier={2}>
        {t(following ? 'social.following' : 'social.follow')}
      </Text>
    </Pressable>
  );
}

export type ShareSubject =
  | { type: 'product'; id: string; title: string; makerName: string }
  | { type: 'shop'; handle: string; businessName: string };

/** Opens the system share sheet with the web link (opens the app when installed). */
export function ShareButton({ subject }: { subject: ShareSubject }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useSocialEnabled();
  if (!enabled) return null;

  const onPress = () => {
    const path =
      subject.type === 'product' ? productSharePath(subject.id) : shopSharePath(subject.handle);
    const url = shareUrl(WEB_URL, path);
    const text =
      subject.type === 'product'
        ? t('social.shareProductText', {
            title: subject.title,
            maker: subject.makerName,
            app: APP_NAME,
          })
        : t('social.shareShopText', { name: subject.businessName, app: APP_NAME });
    track('share_tapped', { target_type: subject.type });
    // iOS shows the url as a rich link; Android only sends `message`, so the link goes in it.
    void Share.share(
      Platform.OS === 'ios' ? { message: text, url } : { message: `${text}\n${url}` },
    ).catch(() => undefined);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('social.share')}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Share2 size={24} strokeWidth={1.75} color={theme.colors.ink} />
    </Pressable>
  );
}

/** Quiet "Report" row at the bottom of a product or shop page. */
export function ReportLink({
  target,
}: {
  target: { type: 'product'; id: string } | { type: 'shop'; handle: string };
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const enabled = useSocialEnabled();
  if (!enabled) return null;
  const label = t(target.type === 'product' ? 'social.reportProduct' : 'social.reportShop');
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() =>
          router.push({
            pathname: '/report',
            params:
              target.type === 'product' ? { productId: target.id } : { handle: target.handle },
          })
        }
        style={{
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
        }}
      >
        <Flag size={18} strokeWidth={1.75} color={theme.colors.inkMuted} />
        <Text variant="label" color="inkMuted">
          {label}
        </Text>
      </Pressable>
    </View>
  );
}
