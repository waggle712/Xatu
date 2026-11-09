import base from '@xatu/config/eslint';

export default [
  ...base,
  { ignores: ['src/generated/**', 'dist/**'] },
  {
    // Nest reads constructor parameter types at runtime (emitDecoratorMetadata),
    // so those imports must stay value imports.
    languageOptions: {
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
  },
];
