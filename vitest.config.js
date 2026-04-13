import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 1,
    isolate: false,
    testTimeout: 200_000,
  },
});
