const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const { unzipSync } = require('cross-zip');
const { color } = require('./logging');
const depot = require('./depot-tools');

const gomaDir = path.resolve(__dirname, '..', '..', 'third_party', 'goma');
const gomaGnFile = path.resolve(__dirname, '..', '..', 'third_party', 'goma.gn');
const gomaShaFile = path.resolve(__dirname, '..', '..', 'third_party', 'goma', '.sha');
const gomaBaseURL = 'https://electron-build-tools.s3-us-west-2.amazonaws.com/build-dependencies';
const gomaLoginFile = path.resolve(gomaDir, 'last-known-login');

const GOMA_PLATFORM_SHAS = {
  darwin: '0c8c135d9f1833f181e4e09d177aafa76c1f1633b445c9674d231a07d2d3fbde',
  linux: 'fda96d3903c57ca171ccb295bd428af2c2b7c8906f46cfb7b2c00a6f2c73fd66',
  win32: 'f27b333b98b005657521ca35e825f207db26f2e3135d7aaca611a15bd66c451f',
};

const isSupportedPlatform = !!GOMA_PLATFORM_SHAS[process.platform];

function downloadAndPrepareGoma(config) {
  if (!isSupportedPlatform) return;

  const gomaGnContents = `goma_dir = "${gomaDir}"\nuse_goma = true`;
  if (!fs.existsSync(gomaGnFile) || fs.readFileSync(gomaGnFile, 'utf8') !== gomaGnContents) {
    console.log(`Writing new goma.gn file ${color.path(gomaGnFile)}`);
    fs.writeFileSync(gomaGnFile, gomaGnContents);
  }
  const sha = GOMA_PLATFORM_SHAS[process.platform];
  if (
    fs.existsSync(gomaShaFile) &&
    fs.readFileSync(gomaShaFile, 'utf8') === sha &&
    !process.env.ELECTRON_FORGE_GOMA_REDOWNLOAD
  )
    return sha;

  const filename = {
    darwin: 'goma-mac.tgz',
    linux: 'goma-linux.tgz',
    win32: 'goma-win.zip',
  }[process.platform];

  if (fs.existsSync(path.resolve(gomaDir, 'goma_ctl.py'))) {
    depot.spawnSync(config, 'python', ['goma_ctl.py', 'stop'], {
      cwd: gomaDir,
      stdio: 'ignore',
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
      throw new Error('Failed to extract goma');
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

  console.log(color.childExec('goma_ctl.py', ['ensure_start'], { cwd: gomaDir }));
  childProcess.execFileSync('python', ['goma_ctl.py', 'ensure_start'], {
    cwd: gomaDir,
    env: {
      ...process.env,
      ...gomaEnv(config),
    },
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
