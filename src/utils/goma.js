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
if (gomaPlatform === 'linux' && process.arch === 'arm64') {
  gomaPlatform = 'linux-arm64';
}

const GOMA_PLATFORM_SHAS = {
  darwin: 'acdddfb6346d3fce1a0630e9880669082bd64f095a0be81eb3ad54cc14e4ea4c',
  'darwin-arm64': 'd7b44eb9988c81e8b69c14e8c1ad6458bd9fc3f6ee0b360812d605da62d5721a',
  linux: '293d1768c4f1fca239aaad2a347f76dab1856415512e24085afb4b1aeadcdcbf',
  'linux-arm64': '5d1c3bf476097de6db9176e4d88ad3549661c1544bdc14a1701fa46fd70df2e2',
  win32: '8644a9443d03675cc113a26b42a20e97e41e4f4d152ff84140a9a93ea6830a08',
};

const MSFT_GOMA_PLATFORM_SHAS = {
  darwin: 'dac2881cf5f7565fa432f32bc4635a9752e56984966b5fe43f7b37892b4d4553',
  'darwin-arm64': 'd8006830527a37cce19ea03a37fd43db2e0a7c65e90e8d1eac7874ea08e16d45',
  linux: 'ee0199542ced43908f1d60c67872ec1d4925d0d97200ff214eaf6cbf18f2a92b',
  'linux-arm64': '486bd5da5ac16919cb6a7e33c3c29aa35ca345364fb6e2f2438348e6a6d07222',
  win32: 'a54dd1f574f92fa8a6bc81a939d9415fa2dc8f36cea9ea64eb43736dd3ecac4b',
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
    'linux-arm64': 'goma-linux-arm64.tgz',
    win32: 'goma-win.zip',
  }[gomaPlatform];

  if (fs.existsSync(path.resolve(gomaDir, 'goma_ctl.py'))) {
    depot.execFileSync(config, 'python3', ['goma_ctl.py', 'stop'], {
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
  const { status } = childProcess.spawnSync(
    process.execPath,
    [path.resolve(__dirname, '..', 'download.js'), downloadURL, tmpDownload],
    {
      stdio: 'inherit',
    },
  );
  if (status !== 0) {
    rimraf.sync(tmpDownload);
    fatal(`Failure while downloading goma`);
  }
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

function gomaIsAuthenticated(config) {
  const lastKnownLogin = getLastKnownLoginTime();
  // Assume if we authed in the last 12 hours it is still valid
  if (lastKnownLogin && Date.now() - lastKnownLogin.getTime() < 1000 * 60 * 60 * 12) return true;

  let loggedInInfo;
  try {
    loggedInInfo = depot.execFileSync(config, 'python3', ['goma_auth.py', 'info'], {
      cwd: gomaDir,
      stdio: ['ignore'],
    });
  } catch {
    return false;
  }

  return /^Login as (\w+\s\w+)$/.test(loggedInInfo.toString().trim());
}

function authenticateGoma(config) {
  if (!isSupportedPlatform) return;

  downloadAndPrepareGoma(config);

  if (!gomaIsAuthenticated(config)) {
    const { status, error } = depot.spawnSync(config, 'python3', ['goma_auth.py', 'login'], {
      cwd: gomaDir,
      stdio: 'inherit',
      env: {
        AGREE_NOTGOMA_TOS: '1',
      },
    });

    if (status !== 0) {
      let errorMsg = `Failed to run command:`;
      if (status !== null) errorMsg += `\n Exit Code: "${status}"`;
      if (error) errorMsg += `\n ${error}`;
      fatal(errorMsg, status);
    }

    recordGomaLoginTime();
  }
}

function getLastKnownLoginTime() {
  if (!fs.existsSync(gomaLoginFile)) return null;
  const contents = fs.readFileSync(gomaLoginFile);
  return new Date(parseInt(contents, 10));
}

function clearGomaLoginTime() {
  if (!fs.existsSync(gomaLoginFile)) return;
  fs.unlinkSync(gomaLoginFile);
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
    const { length: cpus } = os.cpus();
    subprocs = {
      GOMA_MAX_SUBPROCS: cpus.toString(),
      GOMA_MAX_SUBPROCS_LOW: cpus.toString(),
    };
  }

  depot.execFileSync(config, 'python3', ['goma_ctl.py', 'ensure_start'], {
    cwd: gomaDir,
    env: {
      ...gomaEnv(config),
      ...subprocs,
    },
    // Inherit stdio on Windows because otherwise this never terminates
    stdio: process.platform === 'win32' ? 'inherit' : ['ignore'],
  });
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
    ...gomaCIEnv(config),
  };
}

module.exports = {
  auth: authenticateGoma,
  ensure: ensureGomaStart,
  dir: gomaDir,
  downloadAndPrepare: downloadAndPrepareGoma,
  gnFilePath: gomaGnFile,
  env: gomaEnv,
  clearGomaLoginTime,
  recordGomaLoginTime,
};
