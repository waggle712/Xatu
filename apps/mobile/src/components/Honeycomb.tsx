import { lightColors } from '@xatu/ui';
import Svg, { Polygon } from 'react-native-svg';

// Decorative hive cells for the welcome hero (marigold and dusty rose on plum).
const CELLS: [number, number, 'm' | 'r'][] = [
  [3, 0, 'm'],
  [4, 0, 'm'],
  [2, 1, 'r'],
  [3, 1, 'm'],
  [4, 1, 'm'],
  [5, 1, 'm'],
  [1, 2, 'r'],
  [2, 2, 'm'],
  [3, 2, 'm'],
  [4, 2, 'r'],
  [5, 2, 'm'],
  [2, 3, 'r'],
  [3, 3, 'm'],
  [4, 3, 'm'],
  [5, 3, 'm'],
  [3, 4, 'r'],
  [4, 4, 'm'],
  [5, 4, 'm'],
];

function hex(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

export function Honeycomb({ width = 150 }: { width?: number }) {
  const r = 11;
  const w = Math.sqrt(3) * r + 2;
  const h = 1.5 * r + 2;
  return (
    <Svg width={width} height={width} viewBox="0 0 150 150" accessibilityElementsHidden>
      {CELLS.map(([col, row, tone]) => (
        <Polygon
          key={`${col}-${row}`}
          points={hex(col * w + (row % 2 ? w / 2 : 0), row * h + r + 4, r)}
          fill={tone === 'm' ? lightColors.marigold : lightColors.brandFill}
          opacity={tone === 'm' ? 1 : 0.9}
        />
      ))}
    </Svg>
  );
}
