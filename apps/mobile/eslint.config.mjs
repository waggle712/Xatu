import base from '@xatu/config/eslint';
import globals from 'globals';

export default [
  ...base,
  { ignores: ['.expo/**', 'ios/**', 'android/**', 'expo-env.d.ts'] },
  {
    languageOptions: { globals: { ...globals.browser, __DEV__: 'readonly' } },
  },
  {
    files: ['*.config.js', 'babel.config.js', 'metro.config.js', 'jest.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
