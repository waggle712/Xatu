import {
  type Colors,
  darkColors,
  lightColors,
  radius,
  space,
  typeScale,
  type TypeStyleName,
} from './tokens.ts';

/**
 * Font family names as loaded by the app (useFonts keys from @expo-google-fonts).
 * React Native has no font fallback lists, so Tamil display text switches to Noto Serif Tamil
 * (see pickFontFamily); Hind Madurai covers both Tamil and Latin.
 */
export const fontFamilies = {
  display: { 600: 'Fraunces_600SemiBold', 700: 'Fraunces_700Bold' },
  displayTamil: { 600: 'NotoSerifTamil_600SemiBold', 700: 'NotoSerifTamil_700Bold' },
  sans: {
    400: 'HindMadurai_400Regular',
    500: 'HindMadurai_500Medium',
    600: 'HindMadurai_600SemiBold',
  },
} as const;

const TAMIL = /[஀-௿]/;

export function pickFontFamily(style: TypeStyleName, text?: string): string {
  const s = typeScale[style];
  if (s.family === 'display') {
    const weight = s.fontWeight >= 700 ? 700 : 600;
    return text && TAMIL.test(text)
      ? fontFamilies.displayTamil[weight]
      : fontFamilies.display[weight];
  }
  const weight = s.fontWeight >= 600 ? 600 : s.fontWeight >= 500 ? 500 : 400;
  return fontFamilies.sans[weight];
}

export interface Theme {
  scheme: 'light' | 'dark';
  colors: Colors;
  space: typeof space;
  radius: typeof radius;
  type: typeof typeScale;
  /** Minimum touch target in px. */
  touchTarget: 48;
  shadowCard: {
    shadowColor: string;
    shadowOpacity: number;
    shadowRadius: number;
    shadowOffset: { width: number; height: number };
    elevation: number;
  };
}

export function buildTheme(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    colors: scheme === 'dark' ? darkColors : lightColors,
    space,
    radius,
    type: typeScale,
    touchTarget: 48,
    shadowCard: {
      shadowColor: '#3A2230',
      shadowOpacity: scheme === 'dark' ? 0 : 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: scheme === 'dark' ? 0 : 4,
    },
  };
}
