module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  plugins: ['@typescript-eslint'],
  ignorePatterns: [
    'dist/**',
    'generated/**',
    'node_modules/**',
    'release*/**',
    'src/**/*-legacy.ts',
  ],
  rules: {},
};
