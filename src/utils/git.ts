import * as cp from 'node:child_process';

import { maybeAutoFix } from './maybe-auto-fix.js';
import { color } from './logging.js';

function spawnSyncWithLog(cmd: string, args: string[]): cp.SpawnSyncReturns<Buffer> {
  console.log(color.childExec(cmd, args, {}));
  return cp.spawnSync(cmd, args);
}

function getGitConfig(key: string): string {
  const { stdout } = cp.spawnSync('git', ['config', '--global', key]);
  return stdout.toString().trim();
}

function ensureGitConfig(key: string, expected: string, verb: string): void {
  if (getGitConfig(key) !== expected) {
    maybeAutoFix(
      () => {
        spawnSyncWithLog('git', ['config', '--global', key, expected]);
      },
      new Error(`git config --global ${key} ${verb} be set to ${expected}.`),
    );
  }
}

export function checkGlobalGitConfig(): void {
  ensureGitConfig('core.filemode', 'false', 'must');
  ensureGitConfig('core.autocrlf', 'false', 'must');
  ensureGitConfig('branch.autosetuprebase', 'always', 'must');
  ensureGitConfig('core.fscache', 'true', 'should');
  ensureGitConfig('core.preloadindex', 'true', 'should');
  ensureGitConfig('core.longpaths', 'true', 'should');
}
