import { describe, expect, it } from 'vitest';
import { formatPaise, paiseSchema } from './money.ts';

describe('money', () => {
  it('formats whole rupees without decimals', () => {
    expect(formatPaise(45000)).toBe('₹450');
  });

  it('formats paise with two decimals', () => {
    expect(formatPaise(45050)).toBe('₹450.50');
  });

  it('uses Indian digit grouping', () => {
    expect(formatPaise(12345600)).toBe('₹1,23,456');
  });

  it('rejects floats and negatives', () => {
    expect(paiseSchema.safeParse(10.5).success).toBe(false);
    expect(paiseSchema.safeParse(-1).success).toBe(false);
  });
});
