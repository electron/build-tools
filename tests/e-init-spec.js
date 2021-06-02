const fs = require('fs');
const path = require('path');

const createSandbox = require('./sandbox');

describe('e-init', () => {
  let sandbox;
  beforeEach(() => {
    sandbox = createSandbox();
  });
  afterEach(() => {
    sandbox.cleanup();
  });

  describe('--root', () => {
    it('creates a new directory with a .gclient file', () => {
      const root = path.resolve(sandbox.tmpdir, 'main');
      const gclient_file = path.resolve(root, '.gclient');

      // confirm these files don't exist when the test starts
      expect(!fs.existsSync(root)).toStrictEqual(true);
      expect(!fs.existsSync(gclient_file)).toStrictEqual(true);

      // run `e init` with a user-specified root
      const result = sandbox
        .eInitRunner()
        .root(root)
        .name('name')
        .run();

      // confirm that it worked
      expect(result.exitCode).toStrictEqual(0);
      expect(fs.statSync(root).isDirectory()).toStrictEqual(true);
      expect(fs.statSync(gclient_file).isFile()).toStrictEqual(true);
    });

    it('creates a config correctly reflecting options passed', () => {
      const root = path.resolve(sandbox.tmpdir, 'main');

      const result = sandbox
        .eInitRunner()
        .name('special')
        .root(root)
        .useHttps()
        .fork('cool-fork/electron')
        .run();

      expect(result.exitCode).toStrictEqual(0);

      const configDir = path.resolve(sandbox.tmpdir, 'evm-config');
      expect(fs.statSync(configDir).isDirectory()).toStrictEqual(true);

      const configPath = path.resolve(configDir, 'evm.special.json');
      expect(fs.existsSync(configPath)).toStrictEqual(true);

      const config = require(configPath);
      expect(config.goma).toStrictEqual('cache-only');

      expect(config.remotes).toHaveProperty('electron');
      expect(config.remotes).toHaveProperty('node');

      const remotes = config.remotes.electron;
      expect(remotes.origin).toStrictEqual('https://github.com/electron/electron.git');
      expect(remotes.fork).toStrictEqual('https://github.com/cool-fork/electron.git');

      expect(config.env).toHaveProperty('CHROMIUM_BUILDTOOLS_PATH');
      expect(config.env).toHaveProperty('GIT_CACHE_PATH');

      expect(config.gen.out).toStrictEqual('Testing');
    });

    it('logs an info message when the new build config root already has a .gclient file', () => {
      const root = path.resolve(sandbox.tmpdir, 'main');

      // run `e init` twice on the same directory with two names
      let result;
      result = sandbox
        .eInitRunner()
        .root(root)
        .name('name1')
        .run();
      result = sandbox
        .eInitRunner()
        .root(root)
        .name('name2')
        .run();

      expect(result.exitCode).toStrictEqual(0);
      expect(result.stdout).toMatch('INFO');
      expect(result.stdout).toMatch('already exists');
      expect(result.stdout).toMatch(`OK if you are sharing ${root} between multiple build configs`);
    });

    it('refuses to use a pre-existing directory that lacks its own .gclient file', () => {
      // make a nonempty directory
      const existingDir = path.resolve(sandbox.tmpdir, 'hello');
      fs.mkdirSync(existingDir);
      fs.writeFileSync(path.resolve(existingDir, 'world.txt'), 'hello-exists-and-is-not-empty');

      // run `e init` with a nonempty root directory
      const result = sandbox
        .eInitRunner()
        .root(existingDir)
        .name('name')
        .run();

      // confirm that it failed
      expect(result.exitCode).not.toStrictEqual(0);
      expect(result.stderr).toEqual(expect.stringContaining('ERR'));
    });
  });

  it('fails if a build configuration name is not specified', () => {
    // run `e init` without a build config name
    const result = sandbox.eInitRunner().run();

    // confirm that it errored out and gave a Help message
    expect(result.exitCode).not.toStrictEqual(0);
    expect(result.stdout).toEqual(expect.stringContaining('Usage'));
  });

  it('does not overwrite existing configs unless --force', () => {
    // confirm that `e init` with the same name twice doesn't work...
    const root = path.resolve(sandbox.tmpdir, 'main');
    let result;
    result = sandbox
      .eInitRunner()
      .root(`${root}1`)
      .name('name')
      .run();
    result = sandbox
      .eInitRunner()
      .root(`${root}2`)
      .name('name')
      .run();
    expect(result.exitCode).not.toStrictEqual(0);
    expect(result.stderr).toEqual(expect.stringContaining('ERR'));

    // ...unless you add '--force'
    result = sandbox
      .eInitRunner()
      .root(`${root}2`)
      .name('name')
      .force()
      .run();
    expect(result.exitCode).toStrictEqual(0);
  });

  it('Uses $PWD/electron as the default root', () => {
    // chdir to the test's tmpdir
    const cwd = process.cwd();
    process.chdir(sandbox.tmpdir);

    // run `e init` without specifying a root
    sandbox
      .eInitRunner()
      .name('name')
      .run();

    // confirm that $cwd/electron is the default root
    const expectedRoot = path.resolve(sandbox.tmpdir, 'electron');
    const result = sandbox
      .eShowRunner()
      .root()
      .run();
    expect(result.exitCode).toStrictEqual(0);
    expect(result.stdout).toStrictEqual(expectedRoot);

    // restore the real cwd
    process.chdir(cwd);
  });

  it('Defaults to an outdir that fits the import name', () => {
    const root = path.resolve(sandbox.tmpdir, 'main');
    sandbox
      .eInitRunner()
      .root(root)
      .import('debug')
      .name('name')
      .run();
    const result = sandbox
      .eShowRunner()
      .out()
      .run();
    expect(result.exitCode).toStrictEqual(0);
    expect(result.stdout).toStrictEqual('Debug');
  });
});
