import os from 'os';
import path from 'path';
import { pathKey } from '../dist/utils/path-key.js';
import createSandbox from './sandbox';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('e-show', () => {
  let sandbox;
  let root;
  let name;
  let out;

  beforeEach(() => {
    sandbox = createSandbox();
    root = path.join(sandbox.tmpdir, sandbox.randomString());
    name = sandbox.randomString();
    out = sandbox.randomString();
  });

  afterEach(() => {
    sandbox.cleanup();
  });

  it('shows the current config', () => {
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .run();
    const result = sandbox
      .eShowRunner()
      .current()
      .run();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual(name);
  });

  it('shows the outdir', () => {
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .out(out)
      .run();
    const result = sandbox
      .eShowRunner()
      .out()
      .run();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual(out);
  });

  it('shows the root', () => {
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .out(out)
      .run();
    const result = sandbox
      .eShowRunner()
      .root()
      .run();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual(root);
  });

  it('shows the exec', () => {
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .out(out)
      .run();
    const result = sandbox
      .eShowRunner()
      .exec()
      .run();
    expect(result.exitCode).toBe(0);
    const exec = result.stdout;
    expect(exec).toContain(root);
    expect(exec).toContain(out);
  });

  it('shows the src', () => {
    const srcdir = 'base';
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .out(out)
      .run();
    const result = sandbox
      .eShowRunner()
      .src(srcdir)
      .run();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual(path.resolve(root, 'src', srcdir));
  });

  it('honors --config=<name> for a single invocation', () => {
    const otherRoot = path.join(sandbox.tmpdir, sandbox.randomString());
    const otherName = sandbox.randomString();
    sandbox
      .eInitRunner()
      .root(otherRoot)
      .name(otherName)
      .run();
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .run();

    // Active config is `name`.
    expect(
      sandbox
        .eShowRunner()
        .current()
        .run().stdout,
    ).toEqual(name);

    // `--config` overrides it for this call only (both = and space forms).
    for (const flagArgs of [[`--config=${otherName}`], ['--config', otherName]]) {
      const result = sandbox
        .eRunner()
        .args(...flagArgs, 'show', 'current')
        .run();
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toEqual(otherName);
    }

    // Persistent current is untouched afterwards.
    expect(
      sandbox
        .eShowRunner()
        .current()
        .run().stdout,
    ).toEqual(name);
  });

  it('shows all configs', () => {
    sandbox
      .eInitRunner()
      .root(`${root}1`)
      .name(`${name}1`)
      .out(`${out}1`)
      .run();
    sandbox
      .eInitRunner()
      .root(`${root}2`)
      .name(`${name}2`)
      .out(`${out}2`)
      .run();
    const result = sandbox
      .eShowRunner()
      .configs()
      .run();
    expect(result.exitCode).toBe(0);
    const names = result.stdout
      .split('\n')
      .map(line => (line.startsWith('* ') ? line.slice(2) : line));
    expect(names).toEqual([`${name}1`, `${name}2`]);
  });

  it('shows env', () => {
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .out(out)
      .run();
    const result = sandbox
      .eShowRunner()
      .env()
      .run();
    expect(result.exitCode).toBe(0);
    const isWindows = os.platform() === 'win32';
    const exportKeyword = isWindows ? 'set' : 'export';
    const env = result.stdout
      .split('\n')
      .map(line => line.slice(`${exportKeyword} `.length).split('=', 2))
      .reduce((acc, [k, v]) => {
        acc[k] = v;
        return acc;
      }, {});
    const envKeys = Object.keys(env).sort();
    expect(envKeys).toEqual(expect.arrayContaining(['GIT_CACHE_PATH', pathKey()]));
    expect(envKeys).not.toContain('CHROMIUM_BUILDTOOLS_PATH');
    expect(envKeys).toEqual(
      (isWindows ? expect : expect.not).arrayContaining(['DEPOT_TOOLS_WIN_TOOLCHAIN']),
    );
  });
});
