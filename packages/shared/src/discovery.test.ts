import { describe, expect, it } from 'vitest';
import {
  feedQuerySchema,
  hasTamil,
  normaliseQuery,
  roundPoint,
  searchQuerySchema,
} from './discovery.ts';
import { approximateLocation } from './seller.ts';

describe('discovery inputs', () => {
  it('rounds a buyer position the same way as shop locations', () => {
    const p = { lat: 10.828512, lng: 78.679534 };
    expect(roundPoint(p)).toEqual({ lat: 10.83, lng: 78.68 });
    expect(roundPoint(p)).toEqual(approximateLocation(p));
  });

  it('reads query strings, with a default radius and limits', () => {
    expect(feedQuerySchema.parse({ lat: '10.81', lng: '78.69' })).toEqual({
      lat: 10.81,
      lng: 78.69,
      radiusKm: 25,
    });
    expect(feedQuerySchema.safeParse({ radiusKm: '500' }).success).toBe(false);
    expect(feedQuerySchema.safeParse({ lat: '10.8' }).success).toBe(false);
    expect(feedQuerySchema.safeParse({ category: 'DROP TABLE' }).success).toBe(false);
    expect(feedQuerySchema.safeParse({ extra: '1' }).success).toBe(false);
  });

  it('needs a short, non-empty search', () => {
    expect(searchQuerySchema.safeParse({ q: '  ' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: 'x'.repeat(61) }).success).toBe(false);
    expect(searchQuerySchema.parse({ q: ' murukku ' }).q).toBe('murukku');
  });

  it('normalises searches and spots Tamil', () => {
    expect(normaliseQuery('  Murukku   Set ')).toBe('murukku set');
    expect(hasTamil('முறுக்கு')).toBe(true);
    expect(hasTamil('murukku')).toBe(false);
  });
});
