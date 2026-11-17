import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['node_modules/**', 'dist/**', 'artifacts/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  { files: ['**/*.js', '**/*.cjs', '**/*.mjs'], languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  { files: ['audio/devices.mjs', 'security.cjs'], rules: { 'no-control-regex': 'off' } },
];
