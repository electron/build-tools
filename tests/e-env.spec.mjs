import path from 'path';
import { pathKey } from '../dist/utils/path-key.js';
import createSandbox from './sandbox';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('e-env', () => {
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

  it('fails clearly if no command is provided', () => {
    const result = sandbox
      .eRunner()
      .args('env')
      .run();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/must provide a command to 'e env'/i);
  });

  it('forwards child arguments and exposes the active build environment', () => {
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .out(out)
      .run();

    const result = sandbox
      .eRunner()
      .args(
        'env',
        'node',
        '-e',
        `console.log(JSON.stringify({ argv: process.argv.slice(1), hasBuildtoolsPath: !!process.env.CHROMIUM_BUILDTOOLS_PATH, hasGitCachePath: !!process.env.GIT_CACHE_PATH, hasPath: !!process.env[${JSON.stringify(pathKey())}] }))`,
        'arg1',
        '--child-flag',
      )
      .run();

    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split('\n').filter(Boolean);
    const payload = JSON.parse(lines[lines.length - 1]);
    expect(payload.argv).toEqual(['arg1', '--child-flag']);
    expect(payload.hasBuildtoolsPath).toBe(true);
    expect(payload.hasGitCachePath).toBe(true);
    expect(payload.hasPath).toBe(true);
  });

  it('returns the child command status code', () => {
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .out(out)
      .run();

    const result = sandbox
      .eRunner()
      .args('env', 'node', '-e', 'process.exit(7)')
      .run();

    expect(result.exitCode).toBe(7);
  });
});
