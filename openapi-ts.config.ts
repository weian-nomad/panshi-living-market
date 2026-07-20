import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: 'contracts/openapi/public-v1.yaml',
  output: 'apps/web/src/api/generated',
  plugins: [
    '@hey-api/typescript',
    {
      name: '@hey-api/sdk',
      operations: true,
    },
    '@hey-api/client-fetch',
  ],
});
