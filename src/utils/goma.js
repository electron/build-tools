const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const { unzipSync } = require('cross-zip');
const { color, fatal } = require('./logging');
const depot = require('./depot-tools');
const os = require('os');
const { getIsArm } = require('./arm');

const gomaDir = path.resolve(__dirname, '..', '..', 'third_party', 'goma');
const gomaGnFile = path.resolve(__dirname, '..', '..', 'third_party', 'goma.gn');
const gomaShaFile = path.resolve(__dirname, '..', '..', 'third_party', 'goma', '.sha');
const gomaBaseURL = 'https://dev-cdn.electronjs.org/goma-clients';
const gomaLoginFile = path.resolve(gomaDir, 'last-known-login');

let gomaPlatform = process.platform;

if (gomaPlatform === 'darwin' && getIsArm()) {
  gomaPlatform = 'darwin-arm64';
}

const GOMA_PLATFORM_SHAS = {
  darwin: '40b0a35b31784157216403a88b5d3b612ae45904756d0e8e00d783244a09bce6',
  'darwin-arm64': '3a9485206c4b7ea8ede3abc8c8e87724fee77d1545cfd03063b3a8a36ae6538d',
  linux: '9de3f9d577c74c628ca1525632a5f9132115223b617097cd3944c07293a50174',
  win32: '1443058faae05ad1553914ba46a4c1bffed34b7cec890d3346f34767d8df02bb',
};

const MSFT_GOMA_PLATFORM_SHAS = {
  darwin: '35243755d119837c0897dbaf1d05110874c9e0466dedf4a2a5fae6dcec4b9b8a',
  'darwin-arm64': '084930bee548ca10fc9b2b9d04066d75a7f4330040592d68fc55abd2f6a3be69',
  linux: '8f27a41d431b1c51cb45f5f151dfd62ac2fb1e6a543e16eaf1e5a0935898da3d',
  win32: '1d26d7e0b16f693f8cc3bb36496deb5aacbc52907e6dfad89f44ebc3772d99b6',
};

const isSupportedPlatform = !!GOMA_PLATFORM_SHAS[gomaPlatform];

function downloadAndPrepareGoma(config) {
  if (!isSupportedPlatform) return;

  if (!fs.existsSync(path.dirname(gomaDir))) {
    fs.mkdirSync(path.dirname(gomaDir));
  }

  const gomaGnContents = `goma_dir = "${gomaDir}"\nuse_goma = true`;
  if (!fs.existsSync(gomaGnFile) || fs.readFileSync(gomaGnFile, 'utf8') !== gomaGnContents) {
    console.log(`Writing new goma.gn file ${color.path(gomaGnFile)}`);
    fs.writeFileSync(gomaGnFile, gomaGnContents);
  }
  let sha = GOMA_PLATFORM_SHAS[gomaPlatform];
  if (config && config.gomaSource === 'msft') {
    sha = MSFT_GOMA_PLATFORM_SHAS[gomaPlatform];
  }
  if (
    fs.existsSync(gomaShaFile) &&
    fs.readFileSync(gomaShaFile, 'utf8') === sha &&
    !process.env.ELECTRON_FORGE_GOMA_REDOWNLOAD
  )
    return sha;

  const filename = {
    darwin: 'goma-mac.tgz',
    'darwin-arm64': 'goma-mac-arm64.tgz',
    linux: 'goma-linux.tgz',
    win32: 'goma-win.zip',
  }[gomaPlatform];

  if (fs.existsSync(path.resolve(gomaDir, 'goma_ctl.py'))) {
    depot.spawnSync(config, 'python', ['goma_ctl.py', 'stop'], {
      cwd: gomaDir,
      stdio: ['ignore'],
    });
  }

  const tmpDownload = path.resolve(gomaDir, '..', filename);
  // Clean Up
  rimraf.sync(gomaDir);
  rimraf.sync(tmpDownload);

  const downloadURL = `${gomaBaseURL}/${sha}/${filename}`;
  console.log(`Downloading ${color.cmd(downloadURL)} into ${color.path(tmpDownload)}`);
  childProcess.spawnSync(
    process.execPath,
    [path.resolve(__dirname, '..', 'download.js'), downloadURL, tmpDownload],
    {
      stdio: 'inherit',
    },
  );
  const hash = crypto
    .createHash('SHA256')
    .update(fs.readFileSync(tmpDownload))
    .digest('hex');
  if (hash !== sha) {
    console.error(
      `${color.err} Got hash for downloaded file ${color.cmd(hash)} which did not match ${color.cmd(
        sha,
      )}. Halting now`,
    );
    rimraf.sync(tmpDownload);
    process.exit(1);
  }

  const targetDir = path.resolve(tmpDownload, '..');
  if (filename.endsWith('.tgz')) {
    const result = childProcess.spawnSync('tar', ['zxvf', filename], {
      cwd: targetDir,
    });
    if (result.status !== 0) {
      fatal('Failed to extract goma');
    }
  } else {
    unzipSync(tmpDownload, targetDir);
  }
  rimraf.sync(tmpDownload);
  fs.writeFileSync(gomaShaFile, sha);
  return sha;
}

function gomaIsAuthenticated() {
  if (!isSupportedPlatform) return false;
  const lastKnownLogin = getLastKnownLoginTime();
  // Assume if we authed in the last 12 hours it is still valid
  if (lastKnownLogin && Date.now() - lastKnownLogin.getTime() < 1000 * 60 * 60 * 12) return true;

  let loggedInInfo;
  try {
    loggedInInfo = childProcess.execFileSync('python', ['goma_auth.py', 'info'], {
      cwd: gomaDir,
      stdio: ['ignore'],
    });
  } catch {
    return false;
  }

  const loggedInPattern = /^Login as (\w+\s\w+)$/;
  return loggedInPattern.test(loggedInInfo.toString().trim());
}

function authenticateGoma(config) {
  if (!isSupportedPlatform) return;

  downloadAndPrepareGoma(config);

  if (!gomaIsAuthenticated()) {
    console.log(color.childExec('goma_auth.py', ['login'], { cwd: gomaDir }));
    childProcess.execFileSync('python', ['goma_auth.py', 'login'], {
      cwd: gomaDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        AGREE_NOTGOMA_TOS: '1',
      },
    });
    recordGomaLoginTime();
  }
}

function getLastKnownLoginTime() {
  if (!fs.existsSync(gomaLoginFile)) return null;
  const contents = fs.readFileSync(gomaLoginFile);
  return new Date(parseInt(contents, 10));
}

function recordGomaLoginTime() {
  fs.writeFileSync(gomaLoginFile, `${Date.now()}`);
}

function ensureGomaStart(config) {
  // GomaCC is super fast and we can assume that a 0 exit code means we are good-to-go
  const gomacc = path.resolve(gomaDir, process.platform === 'win32' ? 'gomacc.exe' : 'gomacc');
  const { status } = childProcess.spawnSync(gomacc, ['port', '2']);
  if (status === 0) return;

  // Set number of subprocs to equal number of CPUs for MacOS
  let subprocs = {};
  if (process.platform === 'darwin') {
    const cpus = os.cpus().length;
    subprocs = {
      GOMA_MAX_SUBPROCS: cpus.toString(),
      GOMA_MAX_SUBPROCS_LOW: cpus.toString(),
    };
  }

  console.log(color.childExec('goma_ctl.py', ['ensure_start'], { cwd: gomaDir }));
  childProcess.execFileSync('python', ['goma_ctl.py', 'ensure_start'], {
    cwd: gomaDir,
    env: {
      ...process.env,
      ...gomaEnv(config),
      ...subprocs,
    },
    // Inherit stdio on Windows because otherwise this never terminates
    stdio: process.platform === 'win32' ? 'inherit' : ['ignore'],
  });
}

function gomaAuthFailureEnv(config) {
  let isCacheOnly = config && config.goma === 'cache-only';
  if (!config) {
    // If no config is provided we are running in CI, infer cache-only from the presence
    // of the RAW_GOMA_AUTH env var
    isCacheOnly = !process.env.RAW_GOMA_AUTH;
  }
  if (isCacheOnly) {
    return {
      GOMA_FALLBACK_ON_AUTH_FAILURE: 'true',
    };
  }
  return {};
}

function gomaCIEnv(config) {
  if (!config && process.env.CI) {
    return {
      // Automatically start the compiler proxy when it dies in CI, random flakes be random
      GOMA_START_COMPILER_PROXY: 'true',
    };
  }
  return {};
}

function gomaEnv(config) {
  return {
    ...gomaAuthFailureEnv(config),
    ...gomaCIEnv(config),
  };
}

module.exports = {
  isAuthenticated: gomaIsAuthenticated,
  auth: authenticateGoma,
  ensure: ensureGomaStart,
  dir: gomaDir,
  downloadAndPrepare: downloadAndPrepareGoma,
  gnFilePath: gomaGnFile,
  env: gomaEnv,
  recordGomaLoginTime,
};
