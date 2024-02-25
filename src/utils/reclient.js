const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const tar = require('tar');

const { color, fatal } = require('./logging');
const { deleteDir } = require('./paths');
const evmConfig = require('../evm-config');

const reclientDir = path.resolve(__dirname, '..', '..', 'third_party', 'reclient');
const reclientTagFile = path.resolve(reclientDir, '.tag');
const reclientHelperPath = path.resolve(
  reclientDir,
  `electron-rbe-credential-helper${process.platform === 'win32' ? '.exe' : ''}`,
);
const rbeServiceAddress = 'rbe.notgoma.com:443';

const CREDENTIAL_HELPER_TAG = 'v0.3.0';

function getTargetPlatform() {
  let targetPlatform = null;

  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  switch (process.platform) {
    case 'win32': {
      targetPlatform = `windows-${arch}`;
      break;
    }
    case 'darwin': {
      targetPlatform = `darwin-${arch}`;
      break;
    }
    case 'linux': {
      targetPlatform = `linux-${arch}`;
      break;
    }
  }

  return targetPlatform;
}

function downloadAndPrepareReclient(config, force = false) {
  if (config.reclient === 'none' && !force) return;
  // If a custom reclient credentials helper is specified, expect
  // that it exists in the specified location
  if (config.reclientHelperPath) {
    console.log(
      `Using custom reclient credentials helper at  ${color.path(config.reclientHelperPath)}`,
    );
    return;
  }

  // Reclient itself comes down with a "gclient sync"
  // run.  We just need to ensure we have the cred helper
  const targetPlatform = getTargetPlatform();

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
  deleteDir(reclientDir);
  deleteDir(tmpDownload);

  const downloadURL = `https://dev-cdn.electronjs.org/reclient/credential-helper/${CREDENTIAL_HELPER_TAG}/electron-rbe-credential-helper-${targetPlatform}.tar.gz`;
  console.log(`Downloading ${color.cmd(downloadURL)} into ${color.path(tmpDownload)}`);
  const { status } = childProcess.spawnSync(
    process.execPath,
    [path.resolve(__dirname, '..', 'download.js'), downloadURL, tmpDownload],
    { stdio: 'inherit' },
  );
  if (status !== 0) {
    deleteDir(tmpDownload);
    fatal(`Failure while downloading reclient`);
  }

  fs.mkdirSync(reclientDir);

  tar.x({
    file: tmpDownload,
    C: reclientDir,
    sync: true,
  });

  if (process.platform === 'win32') {
    fs.renameSync(reclientHelperPath.replace(/\.exe$/, ''), reclientHelperPath);
  }

  deleteDir(tmpDownload);
  fs.writeFileSync(reclientTagFile, CREDENTIAL_HELPER_TAG);
  return;
}

function reclientEnv(config) {
  if (config?.reclient === 'none') return {};

  return {
    RBE_service: config.reclientServiceAddress || rbeServiceAddress,
    RBE_experimental_credentials_helper: getHelperPath(config),
    RBE_experimental_credentials_helper_args: 'print',
  };
}

function isAuthenticated() {
  const { stdout } = childProcess.spawnSync(reclientHelperPath, ['status'], {
    cwd: reclientDir,
    stdio: ['ignore'],
  });

  const match = stdout
    .toString()
    .trim()
    .match(/Authentication Status:\s*(.*)/);

  return match ? match[1].trim() === 'Authenticated' : false;
}

function auth() {
  if (getTargetPlatform() === null) {
    fatal('Unsupported platform for reclient');
  }

  if (isAuthenticated()) return;

  const { status } = childProcess.spawnSync(reclientHelperPath, ['login'], {
    stdio: 'inherit',
  });

  if (status !== 0) {
    if (process.env.CODESPACES) {
      console.warn(
        'Failed to authenticate with Reclient - updating config to disable remote execution',
      );
      evmConfig.overwriteValue({ key: 'reclient', value: 'none' });
      return;
    }

    console.error(
      `${color.err} Failed to authenticate with Reclient - please run ${color.cmd(
        'e d rbe login',
      )} or update your config to set ${color.cmd('reclient')} to 'none'`,
    );

    process.exit(result.status || 1);
  }
}

function getHelperPath(config) {
  return config.reclientHelperPath || reclientHelperPath;
}

module.exports = {
  env: reclientEnv,
  downloadAndPrepare: downloadAndPrepareReclient,
  helperPath: getHelperPath,
  serviceAddress: rbeServiceAddress,
  auth,
};
