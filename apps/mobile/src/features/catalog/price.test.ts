import { paiseToRupeesInput, rupeesToPaise } from './price';
import { uuidv4 } from '../../lib/uuid';

describe('rupeesToPaise', () => {
  it('reads whole rupees and up to two decimals exactly', () => {
    expect(rupeesToPaise('450')).toBe(45000);
    expect(rupeesToPaise('450.5')).toBe(45050);
    expect(rupeesToPaise('0.29')).toBe(29);
    expect(rupeesToPaise(' 1,200 ')).toBe(120000);
  });

  it('refuses empty, zero, negative, too precise or absurd prices', () => {
    for (const bad of ['', '0', '-5', '4.505', 'abc', '1e3', '10000001']) {
      expect(rupeesToPaise(bad)).toBeNull();
    }
  });

  it('round-trips to the input field', () => {
    expect(paiseToRupeesInput(45000)).toBe('450');
    expect(paiseToRupeesInput(45050)).toBe('450.50');
    expect(rupeesToPaise(paiseToRupeesInput(12345))).toBe(12345);
  });
});

describe('uuidv4', () => {
  it('makes distinct version 4 ids', () => {
    const a = uuidv4();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv4()).not.toBe(a);
  });
});
