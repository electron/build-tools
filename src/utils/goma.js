const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const { unzipSync } = require('cross-zip');
const { color } = require('./logging');

const gomaDir = path.resolve(__dirname, '..', '..', 'third_party', 'goma');
const gomaGnFile = path.resolve(__dirname, '..', '..', 'third_party', 'goma.gn');
const gomaShaFile = path.resolve(__dirname, '..', '..', 'third_party', 'goma', '.sha');
const gomaBaseURL = 'https://electron-build-tools.s3-us-west-2.amazonaws.com/build-dependencies';

const GOMA_PLATFORM_SHAS = {
  darwin: '129235876fed7ad09973b3aab0c5b62c215cff227f56a776bbd838cbf2d9d549',
  linux: '0d210c75cb39a0db88dea2c9ecca6d9607c0d8d7256be22eb39303130116ef0c',
  win32: 'dbed01176cfc45adfe6c41045307cba1b0b4851ce6d9ad1f96beed180592924d',
};

const isSupportedPlatform = !!GOMA_PLATFORM_SHAS[process.platform];

function downloadAndPrepareGoma() {
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
    return;

  const filename = {
    darwin: 'goma-mac.tgz',
    linux: 'goma-linux.tgz',
    win32: 'goma-win.zip',
  }[process.platform];

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
}

function gomaIsAuthenticated() {
  if (!isSupportedPlatform) return false;

  downloadAndPrepareGoma();

  const loggedInInfo = childProcess.execFileSync('python', ['goma_auth.py', 'info'], {
    cwd: gomaDir,
  });

  const loggedInPattern = /^Login as (\w+\s\w+)$/;
  return loggedInPattern.test(loggedInInfo.toString().trim());
}

function authenticateGoma() {
  if (!isSupportedPlatform) return;

  downloadAndPrepareGoma();

  if (!gomaIsAuthenticated()) {
    console.log(color.childExec('goma_auth.py', ['login'], { cwd: gomaDir }));
    childProcess.execFileSync('python', ['goma_auth.py', 'login'], { cwd: gomaDir });
  }
}

function ensureGomaStart() {
  console.log(color.childExec('goma_ctl.py', ['ensure_start'], { cwd: gomaDir }));
  childProcess.execFileSync('python', ['goma_ctl.py', 'ensure_start'], { cwd: gomaDir });
}

module.exports = {
  isAuthenticated: gomaIsAuthenticated,
  auth: authenticateGoma,
  ensure: ensureGomaStart,
  dir: gomaDir,
  downloadAndPrepare: downloadAndPrepareGoma,
  gnFilePath: gomaGnFile,
};
