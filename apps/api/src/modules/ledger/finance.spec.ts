import { describe, expect, it } from 'vitest';
import { csvCell } from './finance.service.js';

describe('payout CSV cells', () => {
  it('quotes every cell and neutralises spreadsheet formulas in seller-written text', () => {
    expect(csvCell('Amma Pots')).toBe('"Amma Pots"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+91 call')).toBe(`"'+91 call"`);
    expect(csvCell('-2')).toBe(`"'-2"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell(123n)).toBe('"123"');
  });
});
