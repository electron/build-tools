const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');

const { color, fatal } = require('./logging');

const reclientDir = path.resolve(__dirname, '..', '..', 'third_party', 'reclient');
const reclientTagFile = path.resolve(reclientDir, '.tag');
const reclientHelperPath = path.resolve(
  reclientDir,
  `electron-rbe-credential-helper${process.platform === 'win32' ? '.exe' : ''}`,
);
const rbeServiceAddress = 'rbe.notgoma.com:443';

const CREDENTIAL_HELPER_TAG = 'v0.1.0';

function downloadAndPrepareReclient(config) {
  if (config.reclient === 'none') return;

  // Reclient itself comes down with a "gclient sync"
  // run.  We just need to ensure we have the cred helper
  let targetPlatform = null;
  switch (process.platform) {
    case 'win32': {
      targetPlatform = `windows-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
      break;
    }
    case 'darwin': {
      targetPlatform = `darwin-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
      break;
    }
    case 'linux': {
      targetPlatform = `linux-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
      break;
    }
  }

  // Not supported
  if (!targetPlatform) return;

  if (!fs.existsSync(path.dirname(reclientDir))) {
    fs.mkdirSync(path.dirname(reclientDir));
  }

  if (
    fs.existsSync(reclientTagFile) &&
    fs.readFileSync(reclientTagFile, 'utf8') === CREDENTIAL_HELPER_TAG
  )
    return;

  const tmpDownload = path.resolve(reclientDir, '..', 'reclient.tar.gz');
  // Clean Up
  rimraf.sync(reclientDir);
  rimraf.sync(tmpDownload);

  const downloadURL = `https://dev-cdn.electronjs.org/reclient/credential-helper/${CREDENTIAL_HELPER_TAG}/electron-rbe-credential-helper-${targetPlatform}.tar.gz`;
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
    fatal(`Failure while downloading reclient`);
  }

  const targetDir = path.resolve(tmpDownload, '..');

  fs.mkdirSync(reclientDir);
  const result = childProcess.spawnSync('tar', ['zxvf', 'reclient.tar.gz', '-C', reclientDir], {
    cwd: targetDir,
  });
  if (result.status !== 0) {
    fatal('Failed to extract reclient');
  }
  rimraf.sync(tmpDownload);
  fs.writeFileSync(reclientTagFile, CREDENTIAL_HELPER_TAG);
  return;
}

function reclientEnv(config) {
  if (config && config.reclient === 'none') {
    return {};
  }

  return {
    RBE_service: rbeServiceAddress,
    RBE_experimental_credentials_helper: reclientHelperPath,
  };
}

function ensureHelperAuth(config) {
  const result = childProcess.spawnSync(reclientHelperPath, ['status'], {
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    console.error(result.stdout.toString());
    console.error(
      `${color.err} You do not have valid auth for Reclient, please run ${color.cmd(
        'e d rbe login',
      )}`,
    );
    process.exit(result.status || 1);
  }
}

module.exports = {
  env: reclientEnv,
  downloadAndPrepare: downloadAndPrepareReclient,
  helperPath: reclientHelperPath,
  serviceAddress: rbeServiceAddress,
  auth: ensureHelperAuth,
};