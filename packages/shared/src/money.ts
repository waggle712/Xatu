import { z } from 'zod';

/** Money is always an integer number of paise. Never a float. */
export const paiseSchema = z.number().int().nonnegative();
export type Paise = z.infer<typeof paiseSchema>;

/** Formats paise as an Indian-rupee string, e.g. 45000 -> "₹450", 45050 -> "₹450.50". */
export function formatPaise(paise: Paise, locale = 'en-IN'): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}
