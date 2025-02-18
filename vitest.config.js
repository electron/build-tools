import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    testTimeout: 180_000,
  },
});
