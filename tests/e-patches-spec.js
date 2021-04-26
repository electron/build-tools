const createSandbox = require('./sandbox');

const { color } = require('../src/utils/logging');

describe('e-patches', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = createSandbox();
  });

  afterEach(() => {
    sandbox.cleanup();
  });

  it('correctly throws with an unrecognized target', () => {
    const badTarget = 'i-definitely-dont-exist';
    const { exitCode, stdout } = sandbox
      .ePatchesRunner()
      .target(badTarget)
      .run();

    expect(exitCode).toStrictEqual(1);
    expect(stdout).toMatch(/Unrecognized target/);
  });

  it('correctly exports patches for a recognized target', () => {
    const knownTargets = ['chromium', 'v8', 'node', 'all'];

    for (const target of knownTargets) {
      const { exitCode } = sandbox
        .ePatchesRunner()
        .target(target)
        .run();

      expect(exitCode).toStrictEqual(0);
    }
  });
});
