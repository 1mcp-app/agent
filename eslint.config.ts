import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

import prettierConfig from 'eslint-config-prettier';
import prettier from 'eslint-plugin-prettier';
import globals from 'globals';

export default [
  {
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.vitest,
        ...globals.node,
      },
    },
  },
  eslint.configs.recommended,
  {
    ignores: [
      'node_modules',
      'dist',
      'build',
      'eslint.config.*',
      'docs/.vitepress/dist',
      'docs/.vitepress/cache',
      '.claude/**',
    ],
  },
  prettierConfig,
  {
    files: ['**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.e2e.test.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: 'tsconfig.eslint.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      // Critical rules for code quality
      'no-console': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      //
      // // Additional rules for future consideration (commented out)
      // // Complexity & Maintainability
      // 'complexity': ['warn', { max: 15 }],
      // 'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }],
      // 'max-depth': ['warn', { max: 4 }],
      // // Async Quality
      // '@typescript-eslint/await-thenable': 'error',
      // '@typescript-eslint/no-misused-promises': 'error',
      // 'require-await': 'warn',
      // // Code Style Consistency
      // '@typescript-eslint/no-non-null-assertion': 'warn',
      // '@typescript-eslint/strict-boolean-expressions': 'warn',
      // 'no-warning-comments': ['warn', { terms: ['TODO', 'FIXME', 'XXX'], location: 'start' }],
      // // Best Practices
      // 'no-throw-literal': 'error',
      // 'no-promise-executor-return': 'error',
      // 'prefer-promise-reject-errors': 'error',
    },
  },
  // CLI commands - allow console.log for user output
  {
    files: ['src/commands/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Logger implementation - needs console for output
  {
    files: ['src/logger/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // CLI entry point - allow console for error output
  {
    files: ['src/index.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // UI utilities and formatters - allow console for user output
  {
    files: [
      'src/utils/ui/**/*.ts',
      'src/domains/**/formatters/**/*.ts',
      'src/domains/**/configurators/**/*.ts',
      'src/domains/discovery/**/*.ts',
      'src/domains/preset/services/presetErrorHandler.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  // Test files configuration - more lenient rules
  {
    files: ['**/*.test.ts', '**/*.e2e.test.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: 'tsconfig.eslint.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off', // Allow any in test files
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  // Disable typed linting for VitePress site config files to avoid tsconfig project inclusion issues
  {
    files: ['docs/.vitepress/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
];
