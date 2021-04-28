const path = require('path');
const createSandbox = require('./sandbox');

describe('e-remove', () => {
  let sandbox;
  let root;
  let name;

  beforeEach(() => {
    sandbox = createSandbox();
    root = path.join(sandbox.tmpdir, sandbox.randomString());
    name = sandbox.randomString();
  });

  afterEach(() => {
    sandbox.cleanup();
  });

  it(`fails if a build configuration name doesn't exist or is not specified`, () => {
    const result = sandbox
      .eRemoveRunner()
      .name(name)
      .run();
    expect(result.exitCode).toStrictEqual(1);
    expect(result.stderr).toMatch(/ERR/);
    expect(result.stderr).toMatch(/not found/);
  });

  it('fails if trying to remove a configuration that is currently in use', () => {
    const configNameToRemove = 'remove-me';
    sandbox
      .eInitRunner()
      .root(root)
      .name(configNameToRemove)
      .run();

    const result = sandbox
      .eRemoveRunner()
      .name(configNameToRemove)
      .run();

    expect(result.exitCode).toStrictEqual(1);
    expect(result.stderr).toMatch(/ERR/);
    expect(result.stderr).toMatch(/in use/);
  });

  it('removes the specified configuration from our list', () => {
    const configNameToRemove = 'remove-me';
    sandbox
      .eInitRunner()
      .root(root)
      .name(configNameToRemove)
      .run();

    // Create secondary config to ensure first one is not in use.
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .run();

    const result = sandbox
      .eRemoveRunner()
      .name(configNameToRemove)
      .run();
    expect(result.exitCode).toStrictEqual(0);
    expect(result.stdout.toLowerCase()).toMatch(/removed/);
  });
});
