import Svg, { Circle, Path, Polygon } from 'react-native-svg';
import { lightColors } from '../tokens.ts';

/** The Xatu mark: marigold hive cell, plum flight path, bee dot. Never recolour the cell. */
export function XatuMark({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden>
      <Polygon
        points="32.0,6.0 54.5,19.0 54.5,45.0 32.0,58.0 9.5,45.0 9.5,19.0"
        fill={lightColors.marigold}
        stroke={lightColors.marigold}
        strokeWidth={6}
        strokeLinejoin="round"
      />
      <Path
        d="M15 35c3-7 7-7 10 0s7 7 10 0 7-7 10 0"
        fill="none"
        stroke={lightColors.plum}
        strokeWidth={4.5}
        strokeLinecap="round"
      />
      <Circle cx={49} cy={27} r={4} fill={lightColors.plum} />
    </Svg>
  );
}
