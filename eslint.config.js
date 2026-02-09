import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import jest from 'eslint-plugin-jest';
import unusedImports from 'eslint-plugin-unused-imports';
import promise from 'eslint-plugin-promise';
import tsParser from '@typescript-eslint/parser';

export default tseslint.config(
  { ignores: ['dist', 'src/generated/**/*'] },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      jest,
      'unused-imports': unusedImports,
      promise,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended[0].rules,
      ...jest.configs.recommended.rules,
      ...jest.configs.style.rules,
      ...promise.configs.recommended.rules,

      // Unused imports & vars
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      // Async/promise rules
      'no-await-in-loop': 'off',
      'no-async-promise-executor': 'error',
      'no-return-await': 'error',
      'require-await': 'error',
      'promise/param-names': 'error',

      // General best practices
      'no-misleading-character-class': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-unsafe-finally': 'error',
      'consistent-return': 'warn',
      'no-new': 'error',

      // Prettier formatting handled by config
      ...prettier.rules,
    },
  }
);
