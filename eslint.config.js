'use strict';

// ESLint 9 flat config. The repo shipped without one, so `npm run lint` failed before
// checking a single file. Kept to core recommended rules on Node/CommonJS. The source
// carries `no-await-in-loop` / `global-require` directives from an earlier airbnb-style
// setup that these rules do not enable; unused-directive reports are off so those stay
// harmless until a stricter rule set is chosen.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'coverage/**', 'uploads/**', 'logs/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.jest } },
  },
];
