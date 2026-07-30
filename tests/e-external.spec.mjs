import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathKey } from '../dist/utils/path-key.js';
import createSandbox from './sandbox';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PATH_KEY = pathKey();
const isWindows = os.platform() === 'win32';

// Write an executable `e-<name>` stub into dir that echoes its args
// and exits with the given code.
function writeStub(dir, name, exitCode) {
  if (isWindows) {
    fs.writeFileSync(
      path.join(dir, `e-${name}.cmd`),
      `@echo external ${name} ran with args: %*\r\n@exit /b ${exitCode}\r\n`,
    );
  } else {
    const file = path.join(dir, `e-${name}`);
    fs.writeFileSync(file, `#!/bin/sh\necho "external ${name} ran with args: $@"\nexit ${exitCode}\n`);
    fs.chmodSync(file, 0o755);
  }
}

describe('external subcommands', () => {
  let sandbox;
  let binDir;
  let savedPath;

  beforeEach(() => {
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e-external-'));
    // sandbox snapshots PATH when created, so prepend the stub dir first.
    savedPath = process.env[PATH_KEY];
    process.env[PATH_KEY] = `${binDir}${path.delimiter}${savedPath}`;
    sandbox = createSandbox();
  });

  afterEach(() => {
    process.env[PATH_KEY] = savedPath;
    fs.rmSync(binDir, { recursive: true, force: true });
    sandbox.cleanup();
  });

  it('runs an e-<name> executable from PATH, forwarding args and exit code', () => {
    writeStub(binDir, 'hello', 42);
    const result = sandbox
      .eRunner()
      .args('hello', '--flag', 'arg')
      .run();
    expect(result.exitCode).toBe(42);
    expect(result.stdout).toContain('external hello ran with args: --flag arg');
  });

  it('keeps the unknown-command error when no external command exists', () => {
    const result = sandbox
      .eRunner()
      .args('frobnicate')
      .run();
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`error: unknown command 'frobnicate'`);
  });

  it('keeps typo suggestions for near-misses of built-in commands', () => {
    const result = sandbox
      .eRunner()
      .args('snc')
      .run();
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('(Did you mean sync?)');
  });

  it('lets built-in commands shadow PATH executables', () => {
    writeStub(binDir, 'show', 0);
    const root = path.join(sandbox.tmpdir, sandbox.randomString());
    const name = sandbox.randomString();
    sandbox
      .eInitRunner()
      .root(root)
      .name(name)
      .run();
    const result = sandbox
      .eRunner()
      .args('show', 'current')
      .run();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual(name);
  });
});
