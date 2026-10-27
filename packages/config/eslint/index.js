// Shared flat config. Enforces the design-token rule: no raw hex colours or
// font-family names outside packages/tokens. scripts/check-tokens.ts covers
// non-JS files (CSS, JSON) with the same rule.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// No {n,m} ranges: esquery reads the comma as a selector-list separator.
const HEX = '/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\\b/';
const FONTS = '/\\b(?:Sora|DM Sans|DM_Sans|Inter|Space Grotesk|Plus Jakarta Sans|JetBrains Mono|IBM Plex Mono|Roboto|Helvetica|Arial)\\b/';
const tokenMsg = 'Use a semantic design token from @repo/tokens instead of a raw colour or font name.';

export const tokenRules = {
  'no-restricted-syntax': [
    'error',
    { selector: `Literal[value=${HEX}]`, message: tokenMsg },
    { selector: `TemplateElement[value.raw=${HEX}]`, message: tokenMsg },
    { selector: `Literal[value=${FONTS}]`, message: tokenMsg },
  ],
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/.well-known/workflow/**', '**/.expo/**', '**/generated/**', '**/android/**', '**/ios/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      ...tokenRules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
);
