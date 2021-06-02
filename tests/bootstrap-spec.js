const fs = require('fs');
const path = require('path');
const createSandbox = require('./sandbox');

describe('full-test', () => {
  const branch = 'main';
  const importType = 'testing';
  let sandbox;
  let name;
  let root;

  beforeAll(() => {
    sandbox = createSandbox();
    name = `${branch}-${importType}-${sandbox.randomString()}`;
    root = path.join(sandbox.tmpdir, branch);
  });

  afterAll(() => {
    // sandbox.cleanup();
  });

  it('syncs and builds', () => {
    // run `e init` to create a new config
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .import(importType)
      .run();
    const current = sandbox
      .eShowRunner()
      .current()
      .run().stdout;
    expect(current).toStrictEqual(name);

    // run `e sync` to get the source
    let result = sandbox.eSyncRunner().run();
    expect(result.exitCode).toStrictEqual(0);

    // confirm that we got the code src/electron exists
    const srcdir = sandbox
      .eShowRunner()
      .src()
      .run().stdout;
    let expected = path.resolve(root, 'src', 'electron');
    expect(srcdir).toEqual(expected);
    expect(fs.statSync(srcdir).isDirectory()).toStrictEqual(true);

    // run `e make`
    result = sandbox.eMakeRunner().run();
    expect(result.exitCode).toStrictEqual(0);

    // confirm that the exec exists and is executable
    const exec = sandbox
      .eShowRunner()
      .exec()
      .run().stdout;
    expect(fs.statSync(exec).isFile()).toStrictEqual(true);
    expect(fs.accessSync(exec, fs.constants.X_OK));
  });
});
