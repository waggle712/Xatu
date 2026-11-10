import type { MyShop } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { Camera, ImagePlus, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { XImage } from '../../components/XImage';
import { errorMessage } from '../../lib/errors';
import { useUpdateShop } from '../shop/api';
import { useImageUpload } from './useImageUpload';

/** Cover photo for My shop: pick or shoot, crop 16:9, upload with progress, then attach to the shop. */
export function CoverPhotoEditor({ shop }: { shop: MyShop }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const upload = useImageUpload('shop_cover', [16, 9]);
  const update = useUpdateShop(shop.id);
  const { state } = upload;
  const busy =
    state.step === 'preparing' ||
    state.step === 'uploading' ||
    state.step === 'processing' ||
    update.isPending;

  const choose = async (source: 'library' | 'camera') => {
    const asset = await upload.pick(source);
    if (asset) update.mutate({ coverMediaId: asset.id }, { onSuccess: () => upload.reset() });
  };

  const status =
    state.step === 'preparing'
      ? t('media.preparing')
      : state.step === 'uploading'
        ? t('media.uploading', { percent: Math.round(state.progress * 100) })
        : state.step === 'processing'
          ? t('media.processing')
          : null;

  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" color="inkMuted">
        {t('media.cover')}
      </Text>
      <XImage image={shop.cover} aspectRatio={16 / 9} accessibilityLabel={t('media.cover')} />
      {shop.cover ? null : (
        <Text variant="caption" color="inkMuted">
          {t('media.coverHint')}
        </Text>
      )}

      {status ? (
        <View style={{ gap: theme.space[1] }} accessibilityLiveRegion="polite">
          <Text variant="label">{status}</Text>
          {state.step === 'uploading' ? (
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(state.progress * 100) }}
              style={{
                height: 6,
                borderRadius: 3,
                backgroundColor: theme.colors.line,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.round(state.progress * 100)}%`,
                  height: '100%',
                  backgroundColor: theme.colors.brandFill,
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {state.step === 'failed' ? (
        <View style={{ gap: theme.space[2] }} accessibilityLiveRegion="polite">
          <Text variant="label" color="critical">
            {state.reason === 'rejected' && state.rejectReason
              ? t(`media.rejectReasons.${state.rejectReason}`, {
                  defaultValue: t('media.failed.rejected'),
                })
              : t(`media.failed.${state.reason}`)}
          </Text>
          {state.reason === 'network' ||
          state.reason === 'timeout' ||
          state.reason === 'unknown' ? (
            <Button
              variant="secondary"
              label={t('media.retry')}
              icon={<RefreshCw size={18} strokeWidth={1.75} color={theme.colors.ink} />}
              onPress={() =>
                void upload
                  .retry()
                  .then((asset) => asset && update.mutate({ coverMediaId: asset.id }))
              }
            />
          ) : null}
        </View>
      ) : null}
      {update.isError ? (
        <Text variant="label" color="critical">
          {errorMessage(update.error, t)}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap' }}>
        <Button
          variant="secondary"
          label={t('media.library')}
          disabled={busy}
          icon={<ImagePlus size={18} strokeWidth={1.75} color={theme.colors.ink} />}
          onPress={() => void choose('library')}
          style={{ flexGrow: 1 }}
        />
        <Button
          variant="secondary"
          label={t('media.camera')}
          disabled={busy}
          icon={<Camera size={18} strokeWidth={1.75} color={theme.colors.ink} />}
          onPress={() => void choose('camera')}
          style={{ flexGrow: 1 }}
        />
      </View>
    </View>
  );
}
