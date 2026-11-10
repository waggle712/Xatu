/**
 * Paise are BIGINT in the database and plain numbers in JSON (the app and zod schemas use
 * numbers). JSON.stringify throws on a bigint, so every money value crosses this boundary here,
 * and refuses anything outside the safe-integer range instead of silently losing precision.
 */
export function paiseToNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`Paise value ${value} is not a safe integer`);
  return n;
}

export function paiseToBigInt(value: number): bigint {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Paise value ${value} is not an integer`);
  return BigInt(value);
}
