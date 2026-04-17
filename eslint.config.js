import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.turbo/**', 'coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
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
