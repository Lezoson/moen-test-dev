// eslint.config.mjs
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierRecommended from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';

export default [
  {
    files: ['**/*.ts'],
    ignores: ['dist/**', 'node_modules/**', '**/*.test.ts', '**/*.spec.ts'],

    languageOptions: {
      parser: tsparser,
      sourceType: 'module',
      ecmaVersion: 2021,
    },

    plugins: {
      '@typescript-eslint': tseslint,
      prettier: prettierPlugin,
      import: importPlugin,
    },

    rules: {
      // TypeScript recommended
      ...tseslint.configs.recommended.rules,

      // Prettier disables
      ...prettierRecommended.rules,

      // Common production rules
      'no-console': 'warn',
      'no-debugger': 'error',

      // Override to support unused vars starting with _
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

      // TypeScript strictness
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // Import ordering
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
        },
      ],

      // Prettier enforcement
      'prettier/prettier': 'warn',
    },
  },
];
