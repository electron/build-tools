import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // spec files can run in parallel: each test gets its own sandbox tmpdir
    // and EVM_CONFIG (tests/sandbox.js), and only the single end-to-end
    // e-init test touches the shared depot_tools checkout
    isolate: false,
    testTimeout: 200_000,
  },
});
