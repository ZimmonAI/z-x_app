import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { globals: true, environment: 'node', fileParallelism: false, maxWorkers: 1, minWorkers: 1, testTimeout: 30000, hookTimeout: 30000 }
});
