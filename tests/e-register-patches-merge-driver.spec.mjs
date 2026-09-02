import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PATCHES_MERGE_ATTRIBUTE,
  patchesMergeDriverCommand,
} from '../dist/utils/patches-merge-driver.js';

const script = path.resolve(
  import.meta.dirname,
  '..',
  'dist',
  'e-register-patches-merge-driver.js',
);

function git(cwd, ...args) {
  return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function initRepo(cwd) {
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.name', 'build-tools tests');
  git(cwd, 'config', 'user.email', 'build-tools@example.com');
  git(cwd, 'config', 'commit.gpgsign', 'false');
}

describe('e-register-patches-merge-driver', () => {
  let tmpdir;
  let repo;
  let env;

  // Run the compiled subcommand with an empty EVM_CONFIG so no build config
  // on the host machine is picked up as the default checkout.
  function run(args, cwd = tmpdir) {
    const result = childProcess.spawnSync(process.execPath, [script, ...args], {
      cwd,
      env,
      encoding: 'utf8',
    });
    return { exitCode: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  }

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'e-register-patches-merge-driver-'));
    repo = path.join(tmpdir, 'electron');
    fs.mkdirSync(repo);
    initRepo(repo);
    const evmConfigDir = path.join(tmpdir, 'evm-config');
    fs.mkdirSync(evmConfigDir);
    env = { ...process.env, EVM_CONFIG: evmConfigDir, EVM_CURRENT: '' };
    delete env.EVM_CURRENT_FILE;
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it('registers the driver in the given checkout and prints what it wrote', () => {
    const result = run([repo]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Registered the .patches list merge driver');
    expect(result.stdout).toContain(`merge.patches-list.driver = ${patchesMergeDriverCommand()}`);
    expect(result.stdout).toContain(PATCHES_MERGE_ATTRIBUTE);

    expect(git(repo, 'config', '--local', 'merge.patches-list.name')).toBe(
      'electron .patches list merge',
    );
    expect(git(repo, 'config', '--local', 'merge.patches-list.driver')).toBe(
      patchesMergeDriverCommand(),
    );
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'attributes'), 'utf8')).toBe(
      `${PATCHES_MERGE_ATTRIBUTE}\n`,
    );
  });

  it('is idempotent on a second run', () => {
    expect(run([repo]).exitCode).toBe(0);
    const again = run([repo]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('already registered');

    expect(git(repo, 'config', '--local', '--get-all', 'merge.patches-list.driver')).toBe(
      patchesMergeDriverCommand(),
    );
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'attributes'), 'utf8')).toBe(
      `${PATCHES_MERGE_ATTRIBUTE}\n`,
    );
  });

  it('defaults to the git repo containing cwd when no build config is active', () => {
    const subdir = path.join(repo, 'patches', 'chromium');
    fs.mkdirSync(subdir, { recursive: true });

    const result = run([], subdir);
    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'attributes'), 'utf8')).toBe(
      `${PATCHES_MERGE_ATTRIBUTE}\n`,
    );
  });

  it('fails with a clear message for a path that is not a git checkout', () => {
    const notARepo = path.join(tmpdir, 'not-a-repo');
    fs.mkdirSync(notARepo);

    const result = run([notARepo]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('is not a git checkout');
    expect(fs.existsSync(path.join(notARepo, '.git'))).toBe(false);

    // ...and for a cwd outside any repo with no build config
    const outside = run([], notARepo);
    expect(outside.exitCode).toBe(1);
    expect(outside.stderr).toContain('is not a git checkout');
    expect(outside.stderr).toContain('e register-patches-merge-driver');
  });
});
