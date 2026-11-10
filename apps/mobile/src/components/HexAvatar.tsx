import { Text, useTheme } from '@xatu/ui';
import { View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** The maker's initials in the brand hexagon (until makers add a profile photo). */
export function HexAvatar({ name, size = 92 }: { name: string; size?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{ width: size, height: size * 1.087, alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
    >
      <Svg width={size} height={size * 1.087} viewBox="0 0 92 100" style={{ position: 'absolute' }}>
        <Polygon
          points="46,3 88,27 88,73 46,97 4,73 4,27"
          fill={theme.colors.brandFill}
          stroke={theme.colors.brandFill}
          strokeWidth={4}
          strokeLinejoin="round"
        />
      </Svg>
      <Text
        variant="title"
        color="onBrand"
        style={{ fontSize: size * 0.3, lineHeight: size * 0.37 }}
      >
        {initials(name)}
      </Text>
    </View>
  );
}
