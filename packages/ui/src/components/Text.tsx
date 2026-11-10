import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import type { ColorToken, TypeStyleName } from '../tokens.ts';
import { pickFontFamily } from '../theme.ts';
import { useTheme } from '../ThemeProvider.tsx';

export interface TextProps extends RNTextProps {
  variant?: TypeStyleName;
  color?: ColorToken;
}

/** Brand text. Picks Fraunces / Noto Serif Tamil / Hind Madurai and respects the phone's text size. */
export function Text({ variant = 'body', color = 'ink', style, children, ...rest }: TextProps) {
  const theme = useTheme();
  const t = theme.type[variant];
  const plain = typeof children === 'string' ? children : undefined;
  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily: pickFontFamily(variant, plain),
          fontSize: t.fontSize,
          lineHeight: t.lineHeight,
          color: theme.colors[color],
        },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
