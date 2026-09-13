// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Generated Prisma client is machine-written and already @ts-nocheck'd.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* The project rule is "no `any` unless genuinely unavoidable", so an
         escape hatch must be a visible, reviewable eslint-disable comment. */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      /* A dropped promise in a request handler or a queue processor silently
         loses work and swallows errors. This is the single highest-value rule
         in a Nest + Prisma codebase. */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'no-public' },
      ],

      eqeqeq: ['error', 'smart'],
      'no-console': 'error',
    },
  },
  {
    // Tests may lean on non-null assertions and loose fixtures.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // A promise that deliberately never settles is a legitimate fixture.
      '@typescript-eslint/no-empty-function': 'off',
      // `expect(mock.method).toHaveBeenCalled()` is the standard assertion
      // form; the rule cannot tell it apart from a real unbound call.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // The seed is a one-shot CLI script; stdout is its user interface.
    files: ['prisma/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: [
      '*.mjs',
      'vitest.config.ts',
      'vitest.config.e2e.ts',
      'prisma.config.ts',
    ],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
