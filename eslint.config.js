import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.turbo/**',
      'coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  // .vue SFCs use vue-eslint-parser, but need @typescript-eslint/parser as the
  // *script* parser so `<script setup lang="ts">` blocks (interfaces, type
  // assertions, generics) don't trip "Unexpected token" parse errors.
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
      globals: { ...globals.browser },
    },
  },
  // Frontend source/tests run in the browser/jsdom env — expose DOM globals
  // so we don't false-positive on `document`, `window`, `HTMLElement`, etc.
  // Patterns must match both relative paths (when lint is invoked from the
  // workspace) and absolute paths (when invoked from the repo root).
  {
    files: ['**/frontend/**/*.{ts,tsx,vue}', 'apps/frontend/**/*.{ts,tsx,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      // Underscore-prefixed args/vars are an intentional "unused" marker (e.g.
      // port methods with deferred implementations).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Prettier owns whitespace; these vue rules conflict with it.
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
    },
  },
);
