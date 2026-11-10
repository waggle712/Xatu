import { suggestHandle } from './api';

describe('suggestHandle', () => {
  it('turns a shop name into a link', () => {
    expect(suggestHandle('Meena Clay Studio')).toBe('meenaclaystudio');
    expect(suggestHandle("Abi's Henna & Mehndi!")).toBe('abishennamehndi');
  });
  it('drops Tamil letters (links are ASCII) and caps length', () => {
    expect(suggestHandle('மீனா Clay')).toBe('clay');
    expect(suggestHandle('a'.repeat(40))).toHaveLength(30);
  });
});
