const cp = require('child_process');

function checkGlobalGitConfig() {
  const { stdout: fileMode } = cp.spawnSync('git', ['config', '--global', 'core.filemode']);

  if (fileMode.toString().trim() !== 'false') {
    throw new Error('git config --global core.filemode must be set to false.');
  }

  const { stdout: autoCrlf } = cp.spawnSync('git', ['config', '--global', 'core.autocrlf']);
  if (autoCrlf.toString().trim() !== 'false') {
    throw new Error('git config --global core.autocrlf must be set to false.');
  }

  const { stdout: autoSetupRebase } = cp.spawnSync('git', [
    'config',
    '--global',
    'branch.autosetuprebase',
  ]);
  if (autoSetupRebase.toString().trim() !== 'always') {
    throw new Error('git config --global branch.autosetuprebase must be set to always.');
  }
}

module.exports = {
  checkGlobalGitConfig,
};
