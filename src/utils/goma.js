const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { color } = require('./logging');

const getExternalBinaries = root => path.resolve(root, 'src', 'electron', 'external_binaries');
const gomaDirExists = root => fs.existsSync(path.resolve(getExternalBinaries(root), 'goma'));

function gomaIsAuthenticated(root) {
  const gomaDir = path.resolve(getExternalBinaries(root), 'goma');

  // Bail early if we're not on a branch with the ability to use Goma
  if (!gomaDirExists(root)) return;

  const loggedInInfo = childProcess.execFileSync('python', ['goma_auth.py', 'info'], {
    cwd: gomaDir,
  });

  const loggedInPattern = /^Login as (\w+\s\w+)$/;
  return loggedInPattern.test(loggedInInfo.toString().trim());
}

function authenticateGoma(root) {
  const gomaDir = path.resolve(getExternalBinaries(root), 'goma');

  // Bail early if we're not on a branch with the ability to use Goma
  if (!gomaDirExists(root)) return;

  if (!gomaIsAuthenticated(root)) {
    console.log(color.childExec('goma_auth.py', ['login'], { cwd: gomaDir }));
    childProcess.execFileSync('python', ['goma_auth.py', 'login'], { cwd: gomaDir });
  }
}

function ensureGomaStart(root) {
  const gomaDir = path.resolve(getExternalBinaries(root), 'goma');

  // Bail early if we're not on a branch with the ability to use Goma
  if (!gomaDirExists(root)) return;

  if (gomaIsAuthenticated(root)) {
    console.log(color.childExec('goma_ctl.py', ['ensure_start'], { cwd: gomaDir }));
    childProcess.execFileSync('python', ['goma_ctl.py', 'ensure_start'], { cwd: gomaDir });
  }
}

module.exports = {
  isAuthenticated: gomaIsAuthenticated,
  auth: authenticateGoma,
  ensure: ensureGomaStart,
  exists: gomaDirExists,
  dir: root => path.resolve(getExternalBinaries(root), 'goma'),
};
