const createSandbox = require('./sandbox');
const path = require('path');

describe('e-patches', () => {
  let sandbox;
  let root;

  beforeEach(() => {
    sandbox = createSandbox();
    root = path.resolve(sandbox.tmpdir, 'master');
  });

  afterEach(() => {
    sandbox.cleanup();
  });

  it('correctly throws with an unrecognized target', () => {
    sandbox
      .eInitRunner()
      .root(root)
      .name('name')
      .run();

    const { exitCode, stderr } = sandbox
      .ePatchesRunner()
      .target('i-definitely-dont-exist')
      .run();

    expect(exitCode).toStrictEqual(1);
    expect(stderr).toMatch(/Unrecognized target/);
  });

  it('correctly exports patches for a recognized target', () => {
    sandbox
      .eInitRunner()
      .root(root)
      .name('name')
      .run();

    for (const target of ['chromium', 'v8', 'node', 'all']) {
      const { exitCode, stderr } = sandbox
        .ePatchesRunner()
        .target(target)
        .run();

      console.debug(stderr);

      expect(exitCode).toStrictEqual(0);
    }
  });
});
