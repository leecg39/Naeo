import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Incremental strict gate for the new server and account UI. Legacy adapters are audited in P8.
export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'public/**', 'docs/**', 'var/**'] },
  {
    files: ['src/server/**/*.ts', 'src/components/account/**/*.tsx', 'src/components/admin/**/*.tsx', 'src/components/contact/**/*.tsx', 'src/lib/api-client.ts', 'src/lib/inquiry-labels.ts', 'src/lib/safe-next.ts', 'src/app/api/**/*.ts', 'src/app/login/**/*.tsx', 'src/app/auth/**/*.tsx', 'src/app/admin/**/*.tsx', 'src/app/dashboard/settings/**/*.tsx', 'tests/server/**/*.ts', 'scripts/admin.ts', 'scripts/content/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
