import globals from 'globals'
import pluginJs from '@eslint/js'

/** @type {import('eslint').Linter.Config[]} */
export default [
  pluginJs.configs.recommended,
  {
    rules: {
      'no-unused-vars': 'warn',
    },
  },
  { ignores: ['client/*'] },
  {
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        wiki: 'readonly',
        ...globals.node,
        ...globals.nodeBuiltin,
        ...globals.mocha,
      },
    },
  },
]
