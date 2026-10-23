import { FlatCompat } from '@eslint/eslintrc';

// Next.js ships its rules as a legacy config. FlatCompat loads them into the
// flat config format ESLint 9 uses.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'public/vendor/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals'),
];

export default config;
