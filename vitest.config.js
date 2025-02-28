import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    testTimeout: 200_000,
  },
});
