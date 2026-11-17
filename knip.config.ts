export default {
  entry: ['src/index.ts', 'src/adapters/cloudflare-adapter.ts'],
  includeEntryExports: false,
  ignoreDependencies: [
    /^@semantic-release\//u,
    /^@cloudflare\/workers-types$/u,
  ],
};
