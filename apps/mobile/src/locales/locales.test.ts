import en from './en.json';
import ta from './ta.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]!).sort();
}

describe('locales', () => {
  it('Tamil and English have exactly the same keys', () => {
    expect(keys(ta).sort()).toEqual(keys(en).sort());
  });

  it('every Tamil string keeps the English placeholders', () => {
    const get = (o: object, path: string) =>
      path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], o) as string;
    for (const key of keys(en)) {
      expect([key, placeholders(get(ta, key))]).toEqual([key, placeholders(get(en, key))]);
    }
  });

  it('never hard-codes the app name', () => {
    expect(JSON.stringify(en)).not.toMatch(/xatu/i);
    expect(JSON.stringify(ta)).not.toMatch(/xatu/i);
  });
});
