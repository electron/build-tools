const fs = require('node:fs');
const path = require('node:path');

const { maybeAutoFix } = require('./maybe-auto-fix');
const { refreshPathVariable } = require('./refresh-path');
const { fatal } = require('./logging');
const { pathKey } = require('./path-key');

const isWindows = process.platform === 'win32';

function isExecutable(p) {
  try {
    if (isWindows) {
      fs.accessSync(p, fs.constants.F_OK);
      return fs.statSync(p).isFile();
    }
    fs.accessSync(p, fs.constants.F_OK | fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// Locate an executable on PATH. Returns the absolute path, or null if not found.
function which(cmd, env = process.env) {
  const envPath = env[pathKey(env)] || '';
  const dirs = envPath.split(path.delimiter).filter(Boolean);
  const exts = isWindows ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      if (isExecutable(candidate)) return candidate;
    }
    if (isWindows) {
      const bare = path.join(dir, cmd);
      if (isExecutable(bare)) return bare;
    }
  }
  return null;
}

function commandExists(cmd) {
  return which(cmd) !== null;
}

const whichAndFix = (cmd, check, fix) => {
  const found = check ? check() : which(cmd) !== null;
  if (!found) {
    maybeAutoFix(
      fix,
      new Error(
        `A required dependency "${cmd}" could not be located, it probably has to be installed.`,
      ),
    );

    refreshPathVariable();

    if (!(check ? check() : which(cmd) !== null)) {
      fatal(
        `A required dependency "${cmd}" could not be located and we could not install it - it likely has to be installed manually.`,
      );
    }
  }
};

module.exports = {
  which,
  commandExists,
  whichAndFix,
};
