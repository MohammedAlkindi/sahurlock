import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

// eslint-config-next ships its rules as flat configs from version 16.
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'public/vendor/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts'],
  },
  ...nextCoreWebVitals,
  {
    // React Compiler rules from eslint-plugin-react-hooks 7, which eslint-config-next 16 brings, that
    // flag code written before them. Its other new rules pass and stay on. Reworking that code is its
    // own change (docs/ROADMAP.md).
    rules: {
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
    },
  },
];

export default config;
