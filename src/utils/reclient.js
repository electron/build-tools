const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const tar = require('tar');

const { color, fatal } = require('./logging');
const { deleteDir } = require('./paths');

const reclientDir = path.resolve(__dirname, '..', '..', 'third_party', 'reclient');
const reclientTagFile = path.resolve(reclientDir, '.tag');
const rbeHelperPath = path.resolve(
  reclientDir,
  `electron-rbe-credential-helper${process.platform === 'win32' ? '.exe' : ''}`,
);
const RBE_SERVICE_ADDRESS = 'rbe.notgoma.com:443';

const CREDENTIAL_HELPER_TAG = 'v0.5.1';

let usingRemote = true;

function downloadAndPrepareRBECredentialHelper(config) {
  if (config.remoteBuild === 'none') return;

  // If a custom reclient credentials helper is specified, expect
  // that it exists in the specified location
  if (config.rbeHelperPath) {
    console.log(`Using custom reclient credentials helper at  ${color.path(config.rbeHelperPath)}`);
    return;
  }

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
  deleteDir(reclientDir);
  deleteDir(tmpDownload);

  const downloadURL = `https://dev-cdn-experimental.electronjs.org/reclient/credential-helper/${CREDENTIAL_HELPER_TAG}/electron-rbe-credential-helper-${targetPlatform}.tar.gz`;
  console.log(`Downloading ${color.cmd(downloadURL)} into ${color.path(tmpDownload)}`);
  const { status } = childProcess.spawnSync(
    process.execPath,
    [path.resolve(__dirname, '..', 'download.js'), downloadURL, tmpDownload],
    {
      stdio: 'inherit',
    },
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
    fs.renameSync(rbeHelperPath.replace(/\.exe$/, ''), rbeHelperPath);
  }

  deleteDir(tmpDownload);
  fs.writeFileSync(reclientTagFile, CREDENTIAL_HELPER_TAG);
  return;
}

function reclientEnv(config) {
  if (config?.remoteBuild === 'none' || !usingRemote) {
    return {};
  }

  let reclientEnv = {
    RBE_service: getServiceAddress(config),
    RBE_credentials_helper: getHelperPath(config),
    RBE_credentials_helper_args: 'print',
    RBE_experimental_credentials_helper: getHelperPath(config),
    RBE_experimental_credentials_helper_args: 'print',
  };

  // When building Chromium, don't fail early on local fallbacks
  // as they are expected.
  if (config.defaultTarget === 'chrome') {
    reclientEnv.RBE_fail_early_min_action_count = 0;
    reclientEnv.RBE_fail_early_min_fallback_ratio = 0;
  }

  const result = childProcess.spawnSync(rbeHelperPath, ['flags'], {
    stdio: 'pipe',
  });

  if (result.status === 0) {
    try {
      const extraArgs = JSON.parse(result.stdout.toString());
      reclientEnv = Object.assign(reclientEnv, extraArgs);
    } catch (e) {
      console.error(result.stdout.toString());
      fatal('Failure to run reclient credential helper');
    }
  }

  return reclientEnv;
}

function ensureHelperAuth(config) {
  const result = childProcess.spawnSync(rbeHelperPath, ['status'], {
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

function getHelperPath(config) {
  return config.rbeHelperPath || rbeHelperPath;
}

function getServiceAddress(config) {
  return config.rbeServiceAddress || RBE_SERVICE_ADDRESS;
}

module.exports = {
  env: reclientEnv,
  downloadAndPrepareRBECredentialHelper,
  helperPath: getHelperPath,
  serviceAddress: getServiceAddress,
  auth: ensureHelperAuth,
  usingRemote,
};
