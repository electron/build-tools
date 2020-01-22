const childProcess = require('child_process');
const os = require('os');
const path = require('path');

const { color } = require('./logging');

const getExternalBinaries = root => path.resolve(root, 'src', 'electron', 'external_binaries');

function getSCCacheExec(root) {
  return path.resolve(getExternalBinaries(root), 'sccache');
}

function ensureSCCache(config) {
  const sccache = getSCCacheExec(config.root);
  const opts = { env: config.env, stdio: 'ignore' };

  if (os.platform() === 'win32') {
    console.debug(`Building on Windows -- skipping ${color.path(sccache)}`);
    return;
  }

  try {
    childProcess.execFileSync(sccache, ['--stop-server'], opts);
  } catch {}

  //TODO(codebytere): refactor this to be recursive
  for (;;) {
    try {
      const args = ['--start-server'];
      console.log(color.childExec(sccache, args, opts));
      childProcess.execFileSync(sccache, args, opts);
      break;
    } catch {
      console.warn('Failed to start sccache. Trying again...');
    }
  }
}

module.exports = {
  ensure: ensureSCCache,
  exec: root => getSCCacheExec(root),
};
