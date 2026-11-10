// Xatu's own trust and buying icons (docs/brand-kit/icons). 24px grid, 1.75 stroke.
import Svg, { Path, Polygon } from 'react-native-svg';

export interface IconProps {
  size?: number;
  color: string;
}

const stroke = {
  fill: 'none',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function VerifiedIcon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon
        points="12.0,2.5 20.2,7.3 20.2,16.8 12.0,21.5 3.8,16.8 3.8,7.2"
        stroke={color}
        {...stroke}
      />
      <Path d="M8.4 12.2l2.5 2.5 4.7-4.9" stroke={color} {...stroke} />
    </Svg>
  );
}

export function ProtectedPayIcon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6z" stroke={color} {...stroke} />
      <Path
        d="M9.5 8.8h5M9.5 11h5M11 8.8c2.4 0 2.4 2.2 0 2.2h-1.5l3.6 4"
        stroke={color}
        {...stroke}
      />
    </Svg>
  );
}
