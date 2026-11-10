// GENERATED from docs/brand-kit/tokens.json by scripts/build-tokens.mjs. Do not edit by hand.

export const lightColors = {
  surface: '#FCF8F1',
  surfaceRaised: '#FFFFFF',
  surfaceWarm: '#F4E6CF',
  ink: '#3A2230',
  inkMuted: '#6E5A64',
  line: '#E8DCD3',
  taupe: '#BFB3AA',
  brand: '#9A4E5E',
  brandFill: '#C98A96',
  onBrand: '#3A2230',
  blush: '#EBCFD0',
  plum: '#3A2230',
  onPlum: '#FCF8F1',
  marigold: '#E3A62F',
  onMarigold: '#3A2230',
  sage: '#4E6B4C',
  sageSoft: '#E2EADB',
  gold: '#C29A62',
  goldText: '#7A5826',
  critical: '#B3261E',
  focusRing: '#9A4E5E',
} as const;

export const darkColors = {
  surface: '#1E1218',
  surfaceRaised: '#2B1B24',
  surfaceWarm: '#33222B',
  ink: '#FCF8F1',
  inkMuted: '#CDBBC3',
  line: '#3F2C36',
  taupe: '#6E625A',
  brand: '#E3AAB6',
  brandFill: '#C98A96',
  onBrand: '#3A2230',
  blush: '#3E2530',
  plum: '#4A2E3D',
  onPlum: '#FCF8F1',
  marigold: '#F0B544',
  onMarigold: '#3A2230',
  sage: '#A9C4A0',
  sageSoft: '#23301F',
  gold: '#C29A62',
  goldText: '#E0BC85',
  critical: '#FF8A80',
  focusRing: '#F0B544',
} as const;

export type ColorToken = keyof typeof lightColors;
export type Colors = Record<ColorToken, string>;

/** 4-based spacing scale. space[4] = 16 is the screen margin. */
export const space = {
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '6': 24,
  '8': 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
} as const;

export const typeScale = {
  display: {
    family: 'display',
    fontSize: 32,
    lineHeight: 38,
    fontWeight: 700,
  },
  title: {
    family: 'display',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: 600,
  },
  price: {
    family: 'display',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: 600,
  },
  heading: {
    family: 'sans',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: 600,
  },
  body: {
    family: 'sans',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: 400,
  },
  label: {
    family: 'sans',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 600,
  },
  caption: {
    family: 'sans',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 500,
  },
} as const;

export type TypeStyleName = keyof typeof typeScale;
