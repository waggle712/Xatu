import { MAX_PRICE_PAISE } from '@xatu/shared';

/**
 * Seller types rupees ("450", "450.5"); the API takes whole paise. Parsed as text, never through
 * floating point, so "0.29" is exactly 29 paise. Returns null for anything that isn't a valid price.
 */
export function rupeesToPaise(input: string): number | null {
  const text = input.trim().replace(/,/g, '');
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return paise > 0 && paise <= MAX_PRICE_PAISE ? paise : null;
}

/** 45000 → "450", 45050 → "450.50" (for filling the price field). */
export function paiseToRupeesInput(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, '0')}`;
}
