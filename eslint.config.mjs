import { includeIgnoreFile } from '@eslint/compat';
import { fileURLToPath } from 'node:url';
import mridangPlugin from '@mridang/eslint-defaults';

export default [
  includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url))),
  ...mridangPlugin.configs.recommended,
  {
    // Large data or adapter file kept as one module.
    files: ['src/adapters/cloudflare-adapter.ts'],
    rules: { 'sonarjs/max-lines': 'off' },
  },
];
