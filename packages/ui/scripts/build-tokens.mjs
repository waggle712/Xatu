// Generates src/tokens.ts from the brand kit (docs/brand-kit/tokens.json).
// Run after the brand kit changes: pnpm --filter @xatu/ui build:tokens
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kit = JSON.parse(readFileSync(resolve(here, '../../../docs/brand-kit/tokens.json'), 'utf8'));

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const px = (v) => Number(String(v).replace('px', ''));

const light = {};
const dark = {};
for (const t of kit.color.tokens) {
  light[camel(t.name)] = t.value.light;
  dark[camel(t.name)] = t.value.dark;
}

const space = Object.fromEntries(
  kit.spacing.tokens.map((t) => [Number(t.name.replace('space-', '')), px(t.value)]),
);
const radius = Object.fromEntries(
  kit.radius.tokens.map((t) => [camel(t.name.replace('radius-', '')), px(t.value)]),
);

const type = {};
for (const group of kit.type.groups) {
  for (const s of group.styles) {
    type[s.name] = {
      family: group.family,
      fontSize: px(s.fontSize),
      lineHeight: px(s.lineHeight),
      fontWeight: s.fontWeight,
    };
  }
}

const out = `// GENERATED from docs/brand-kit/tokens.json by scripts/build-tokens.mjs. Do not edit by hand.

export const lightColors = ${JSON.stringify(light, null, 2)} as const;

export const darkColors = ${JSON.stringify(dark, null, 2)} as const;

export type ColorToken = keyof typeof lightColors;
export type Colors = Record<ColorToken, string>;

/** 4-based spacing scale. space[4] = 16 is the screen margin. */
export const space = ${JSON.stringify(space, null, 2)} as const;

export const radius = ${JSON.stringify(radius, null, 2)} as const;

export const typeScale = ${JSON.stringify(type, null, 2)} as const;

export type TypeStyleName = keyof typeof typeScale;
`;

writeFileSync(resolve(here, '../src/tokens.ts'), out);
console.log('Wrote src/tokens.ts');
