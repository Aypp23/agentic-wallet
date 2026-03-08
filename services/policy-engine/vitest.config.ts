import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@agentic-wallet/common': path.resolve(__dirname, '../../packages/common/src/index.ts'),
    },
  },
});
