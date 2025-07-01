import { spawnSync } from 'node:child_process';

import { maybeAutoFix } from './maybe-auto-fix.js';
import { color } from './logging.js';

const spawnSyncWithLog = (cmd: string, args: string[]) => {
  console.log(color.childExec(cmd, args, {}));
  return spawnSync(cmd, args);
};

export function checkGlobalGitConfig() {
  const { stdout: fileMode } = spawnSync('git', ['config', '--global', 'core.filemode']);

  if (fileMode.toString().trim() !== 'false') {
    maybeAutoFix(() => {
      spawnSyncWithLog('git', ['config', '--global', 'core.filemode', 'false']);
    }, new Error('git config --global core.filemode must be set to false.'));
  }

  const { stdout: autoCrlf } = spawnSync('git', ['config', '--global', 'core.autocrlf']);
  if (autoCrlf.toString().trim() !== 'false') {
    maybeAutoFix(() => {
      spawnSyncWithLog('git', ['config', '--global', 'core.autocrlf', 'false']);
    }, new Error('git config --global core.autocrlf must be set to false.'));
  }

  const { stdout: autoSetupRebase } = spawnSync('git', [
    'config',
    '--global',
    'branch.autosetuprebase',
  ]);
  if (autoSetupRebase.toString().trim() !== 'always') {
    maybeAutoFix(() => {
      spawnSyncWithLog('git', ['config', '--global', 'branch.autosetuprebase', 'always']);
    }, new Error('git config --global branch.autosetuprebase must be set to always.'));
  }

  const { stdout: fscache } = spawnSync('git', ['config', '--global', 'core.fscache']);
  if (fscache.toString().trim() !== 'true') {
    maybeAutoFix(() => {
      spawnSyncWithLog('git', ['config', '--global', 'core.fscache', 'true']);
    }, new Error('git config --global core.fscache should be set to true.'));
  }

  const { stdout: preloadIndex } = spawnSync('git', ['config', '--global', 'core.preloadindex']);
  if (preloadIndex.toString().trim() !== 'true') {
    maybeAutoFix(() => {
      spawnSyncWithLog('git', ['config', '--global', 'core.preloadindex', 'true']);
    }, new Error('git config --global core.preloadindex should be set to true.'));
  }

  const { stdout: longPaths } = spawnSync('git', ['config', '--global', 'core.longpaths']);
  if (longPaths.toString().trim() !== 'true') {
    maybeAutoFix(() => {
      spawnSyncWithLog('git', ['config', '--global', 'core.longpaths', 'true']);
    }, new Error('git config --global core.longpaths should be set to true.'));
  }
}
