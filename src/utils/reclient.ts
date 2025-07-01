import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import tar from 'tar';

import { color, fatal } from './logging.js';
import { deleteDir } from './paths.js';
import { EVMBaseElectronConfiguration } from '../evm-config.schema.js';

const reclientDir = path.resolve(import.meta.dirname, '..', '..', 'third_party', 'reclient');
const reclientTagFile = path.resolve(reclientDir, '.tag');

const DEFAULT_RBE_HELPER_PATH = path.resolve(
  reclientDir,
  `electron-rbe-credential-helper${process.platform === 'win32' ? '.exe' : ''}`,
);
const RBE_SERVICE_ADDRESS = 'rbe.notgoma.com:443';
const CREDENTIAL_HELPER_TAG = 'v0.5.0';

export function downloadAndPrepareRBECredentialHelper(config: EVMBaseElectronConfiguration): void {
  if (config.remoteBuild === 'none') return;

  // If a custom reclient credentials helper is specified, expect
  // that it exists in the specified location
  if (config.rbeHelperPath) {
    console.log(`Using custom reclient credentials helper at  ${color.path(config.rbeHelperPath)}`);
    return;
  }

  // Reclient itself comes down with a "gclient sync"
  // run.  We just need to ensure we have the cred helper
  let targetPlatform: string | null = null;
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
    [path.resolve(import.meta.dirname, '..', 'download.js'), downloadURL, tmpDownload],
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
    fs.renameSync(DEFAULT_RBE_HELPER_PATH.replace(/\.exe$/, ''), DEFAULT_RBE_HELPER_PATH);
  }

  deleteDir(tmpDownload);
  fs.writeFileSync(reclientTagFile, CREDENTIAL_HELPER_TAG);
  return;
}

export function reclientEnv(config: EVMBaseElectronConfiguration | null): Record<string, string> {
  if (config?.remoteBuild === 'none') {
    return {};
  }

  let reclientEnv = {
    RBE_service: getServiceAddress(config),
    RBE_credentials_helper: getHelperPath(config),
    RBE_credentials_helper_args: 'print',
    RBE_experimental_credentials_helper: getHelperPath(config),
    RBE_experimental_credentials_helper_args: 'print',
    ...(config?.defaultTarget === 'chrome'
      ? {
          RBE_fail_early_min_action_count: '0',
          RBE_fail_early_min_fallback_ratio: '0',
        }
      : {}),
  } as const;

  const result = childProcess.spawnSync(getHelperPath(config), ['flags'], {
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

export function ensureHelperAuth(config: EVMBaseElectronConfiguration): void {
  const result = childProcess.spawnSync(getHelperPath(config), ['status'], {
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

export function getHelperPath(config: EVMBaseElectronConfiguration | null): string {
  return config?.rbeHelperPath || DEFAULT_RBE_HELPER_PATH;
}

export function getServiceAddress(config: EVMBaseElectronConfiguration | null): string {
  return config?.rbeServiceAddress || RBE_SERVICE_ADDRESS;
}
