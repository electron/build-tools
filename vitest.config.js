import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // spec files can run in parallel: each test gets its own sandbox tmpdir
    // and EVM_CONFIG (tests/sandbox.js), and only the single end-to-end
    // e-init test touches the shared depot_tools checkout
    isolate: false,
    testTimeout: 200_000,
    coverage: {
      provider: 'v8',
      // most of the suite exercises the compiled `e-*.js` CLIs in child
      // processes; collect their coverage too (sets NODE_V8_COVERAGE in the
      // test worker, which Node propagates to every spawned process)
      autoAttachSubprocess: true,
      // report every compiled file (remapped to src/ via source maps), not
      // just the ones the tests loaded
      include: ['dist/**/*.js'],
      reporter: ['lcov', 'text-summary'],
    },
  },
});
