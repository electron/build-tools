const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const { unzipSync } = require('cross-zip');
const { color, fatal } = require('./logging');
const depot = require('./depot-tools');
const os = require('os');

const gomaDir = path.resolve(__dirname, '..', '..', 'third_party', 'goma');
const gomaGnFile = path.resolve(__dirname, '..', '..', 'third_party', 'goma.gn');
const gomaShaFile = path.resolve(__dirname, '..', '..', 'third_party', 'goma', '.sha');
const gomaBaseURL = 'https://electron-build-tools.s3-us-west-2.amazonaws.com/build-dependencies';
const gomaLoginFile = path.resolve(gomaDir, 'last-known-login');

const GOMA_PLATFORM_SHAS = {
  darwin: '97bfea30079f4376773f48e0a5c4cd4ffeaa9c455d1c2e91881fd8696b01c205',
  linux: 'f615bf878f8eeee7bb8bc87034cc22e3a8a5a88e8ad63f45bdd6441979c63b8a',
  win32: '064e0beb3c11b82b66ae4b4959e6c0cdaa2116d77c50841e4a213d4f4fb1aeaf',
};

const MSFT_GOMA_PLATFORM_SHAS = {
  darwin: '5d359172ddd9221b36f837f84551a6e8358269e12b2e85ccbf25e7270feb107f',
  linux: 'a747621216f3184887b78a032aa2971279be896d9fdb2334f45eaa238abb8393',
  win32: '5ed885f2e33df8a1bf7fb81e180d8cb49a51815afe1b736223f7f2c67ebe6354',
};

const isSupportedPlatform = !!GOMA_PLATFORM_SHAS[process.platform];

function downloadAndPrepareGoma(config) {
  if (!isSupportedPlatform) return;

  const gomaGnContents = `goma_dir = "${gomaDir}"\nuse_goma = true`;
  if (!fs.existsSync(gomaGnFile) || fs.readFileSync(gomaGnFile, 'utf8') !== gomaGnContents) {
    console.log(`Writing new goma.gn file ${color.path(gomaGnFile)}`);
    fs.writeFileSync(gomaGnFile, gomaGnContents);
  }
  let sha = GOMA_PLATFORM_SHAS[process.platform];
  if (config && config.gomaSource === 'msft') {
    sha = MSFT_GOMA_PLATFORM_SHAS[process.platform];
  }
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

  if (process.platform === 'win32') {
    if (fs.existsSync(path.resolve(gomaDir, 'goma_ctl.bat'))) {
      depot.spawnSync(config, 'goma_ctl.bat', ['stop'], {
        cwd: gomaDir,
        stdio: ['ignore'],
      });
    }
  } else {
    if (fs.existsSync(path.resolve(gomaDir, 'goma_ctl.py'))) {
      depot.spawnSync(config, 'python', ['goma_ctl.py', 'stop'], {
        cwd: gomaDir,
        stdio: ['ignore'],
      });
    }
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
    if (process.platform === 'win32') {
      loggedInInfo = childProcess.execFileSync('goma_auth.bat', ['info'], {
        cwd: gomaDir,
        stdio: ['ignore'],
      });
    } else {
      loggedInInfo = childProcess.execFileSync('python', ['goma_auth.py', 'info'], {
        cwd: gomaDir,
        stdio: ['ignore'],
      });
    }
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
    if (process.platform === 'win32') {
      console.log(color.childExec('goma_auth.bat', ['login'], { cwd: gomaDir }));
      childProcess.execFileSync('goma_auth.bat', ['login'], {
        cwd: gomaDir,
        stdio: 'inherit',
      });
    } else {
      console.log(color.childExec('goma_auth.py', ['login'], { cwd: gomaDir }));
      childProcess.execFileSync('python', ['goma_auth.py', 'login'], {
        cwd: gomaDir,
        stdio: 'inherit',
      });
    }
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

  if (process.platform === 'win32') {
    console.log(color.childExec('goma_ctl.bat', ['ensure_start'], { cwd: gomaDir }));
    childProcess.execFileSync('goma_ctl.bat', ['ensure_start'], {
      cwd: gomaDir,
      env: {
        ...process.env,
        ...gomaEnv(config),
      },
      stdio: ['ignore'],
    });
  } else {
    console.log(color.childExec('goma_ctl.py', ['ensure_start'], { cwd: gomaDir }));
    childProcess.execFileSync('python', ['goma_ctl.py', 'ensure_start'], {
      cwd: gomaDir,
      env: {
        ...process.env,
        ...gomaEnv(config),
      },
      stdio: ['ignore'],
    });
  }
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
