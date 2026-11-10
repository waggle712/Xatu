import { describe, expect, it } from 'vitest';
import { paiseToBigInt, paiseToNumber } from './money.js';

describe('paise conversion', () => {
  it('round-trips whole paise', () => {
    expect(paiseToNumber(paiseToBigInt(45000))).toBe(45000);
    expect(paiseToNumber(9007199254740991n)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses fractions and values that would lose precision', () => {
    expect(() => paiseToBigInt(450.5)).toThrow(RangeError);
    expect(() => paiseToBigInt(Number.NaN)).toThrow(RangeError);
    expect(() => paiseToNumber(9007199254740993n)).toThrow(RangeError);
  });
});
