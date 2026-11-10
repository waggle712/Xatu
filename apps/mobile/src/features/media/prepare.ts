/** Longest side we upload. The server makes thumb/card/full (320/800/1600) from it. */
export const MAX_UPLOAD_SIDE = 2048;

/** New size that fits inside MAX_UPLOAD_SIDE, keeping the aspect ratio; null if no resize is needed. */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_UPLOAD_SIDE,
): { width: number; height: number } | null {
  const longest = Math.max(width, height);
  if (longest <= max) return null;
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
