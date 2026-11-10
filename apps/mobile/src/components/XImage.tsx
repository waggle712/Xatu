import { type Image as XatuImage, pickVariant } from '@xatu/shared';
import { useTheme } from '@xatu/ui';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  type LayoutChangeEvent,
  PixelRatio,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

interface Props {
  image: XatuImage | null;
  /** Width / height. Defaults to the image's own ratio. */
  aspectRatio?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  borderRadius?: number;
}

/**
 * Xatu image: blurhash first, then the smallest variant that is sharp at the displayed size.
 * Never shows a broken image: a failed load keeps the blurhash, and no image shows a brand tile.
 */
export function XImage({ image, aspectRatio, style, accessibilityLabel, borderRadius }: Props) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const ratio = aspectRatio ?? (image ? image.width / image.height : 1);
  const radius = borderRadius ?? theme.radius.lg;

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const uri =
    image && width > 0 && !failed ? image.urls[pickVariant(width, PixelRatio.get())] : undefined;

  return (
    <View
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          aspectRatio: ratio,
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceWarm,
        },
        style,
      ]}
    >
      {image ? (
        <Image
          style={{ width: '100%', height: '100%' }}
          source={uri ? { uri } : { blurhash: image.blurhash }}
          placeholder={{ blurhash: image.blurhash }}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          recyclingKey={image.id}
          onError={() => setFailed(true)}
          accessible={false}
        />
      ) : (
        <View style={{ flex: 1, backgroundColor: theme.colors.brandFill, opacity: 0.35 }} />
      )}
    </View>
  );
}
