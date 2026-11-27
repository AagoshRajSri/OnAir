import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/extension/dist'] },
  tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'extension/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks
    },
    rules: {
      ...eslintPluginReactHooks.configs['recommended-latest'].rules,
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true
        }
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ]
    }
  },
  eslintConfigPrettier,
  {
    rules: {
      'prettier/prettier': 'off'
    }
  }
)
