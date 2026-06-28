import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    ignores: ['.vanilla/', 'dist/']
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        document: 'readonly',
        fetch: 'readonly',
        Fragment: 'readonly',
        window: 'readonly'
      }
    }
  }
];
