import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { color, fatal } from './logging.js';
import { deleteDir, resolvePath } from './paths.js';
import type { SanitizedConfig } from '../types.js';

const reclientDir = path.resolve(import.meta.dirname, '..', '..', 'third_party', 'reclient');
const reclientTagFile = path.resolve(reclientDir, '.tag');
const rbeHelperPath = path.resolve(
  reclientDir,
  `electron-rbe-credential-helper${process.platform === 'win32' ? '.exe' : ''}`,
);
const RBE_SERVICE_ADDRESS = 'rbe.notgoma.com:443';

// Pinned in JSON so automated bumps (electron/roller) only touch data, not code.
const credentialHelperPinPath = path.resolve(import.meta.dirname, 'rbe-credential-helper.json');

function readCredentialHelperPin(): { tag: string; sha256: Record<string, string> } {
  let pin: unknown;
  try {
    pin = JSON.parse(fs.readFileSync(credentialHelperPinPath, 'utf8'));
  } catch (e) {
    fatal(`Failed to read reclient credential helper pin from ${credentialHelperPinPath}: ${e}`);
  }
  if (
    typeof pin !== 'object' ||
    pin === null ||
    !('tag' in pin) ||
    typeof pin.tag !== 'string' ||
    !('sha256' in pin) ||
    typeof pin.sha256 !== 'object' ||
    pin.sha256 === null
  ) {
    fatal(
      `Malformed reclient credential helper pin in ${credentialHelperPinPath}: expected a string "tag" and an object "sha256"`,
    );
  }
  return { tag: pin.tag, sha256: pin.sha256 as Record<string, string> };
}

export let usingRemote = true;
export function setUsingRemote(value: boolean): void {
  usingRemote = value;
}

type ConfigLike = Pick<
  SanitizedConfig,
  'remoteBuild' | 'rbeHelperPath' | 'rbeServiceAddress' | 'rbeTlsClientCert' | 'rbeTlsClientKey'
> &
  Partial<Pick<SanitizedConfig, 'defaultTarget'>>;

// With a TLS client certificate the backend authenticates the connection itself,
// so the credential helper is neither needed nor consulted.
export function usesTlsClientAuth(config: ConfigLike | undefined): boolean {
  if (config?.remoteBuild !== 'siso') return false;
  if (!config.rbeTlsClientCert !== !config.rbeTlsClientKey) {
    fatal('rbeTlsClientCert and rbeTlsClientKey must be set together');
  }
  return !!config.rbeTlsClientCert;
}

export function downloadAndPrepareRBECredentialHelper(config: ConfigLike): void {
  if (config.remoteBuild === 'none' || usesTlsClientAuth(config)) return;

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
    case 'win32':
      targetPlatform = `windows-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
      break;
    case 'darwin':
      targetPlatform = `darwin-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
      break;
    case 'linux':
      targetPlatform = `linux-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
      break;
    default:
      targetPlatform = null;
  }

  // Not supported
  if (!targetPlatform) return;

  const { tag: credentialHelperTag, sha256: credentialHelperSha256 } = readCredentialHelperPin();

  if (!fs.existsSync(path.dirname(reclientDir))) {
    fs.mkdirSync(path.dirname(reclientDir));
  }

  if (
    fs.existsSync(reclientTagFile) &&
    fs.readFileSync(reclientTagFile, 'utf8') === credentialHelperTag
  )
    return;

  const expectedHash = credentialHelperSha256[targetPlatform];
  if (!expectedHash) {
    fatal(
      `No pinned sha256 for reclient credential helper ${credentialHelperTag} on ${targetPlatform} (see src/utils/rbe-credential-helper.json)`,
    );
  }

  const tmpDownload = path.resolve(reclientDir, '..', 'reclient.tar.gz');
  // Clean Up
  deleteDir(reclientDir);
  deleteDir(tmpDownload);

  const downloadURL = `https://dev-cdn-experimental.electronjs.org/reclient/credential-helper/${credentialHelperTag}/electron-rbe-credential-helper-${targetPlatform}.tar.gz`;
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

  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(tmpDownload)).digest('hex');
  if (actualHash !== expectedHash) {
    deleteDir(tmpDownload);
    fatal(
      `Checksum mismatch for reclient credential helper: expected ${expectedHash}, got ${actualHash}`,
    );
  }

  fs.mkdirSync(reclientDir);

  const extract = childProcess.spawnSync('tar', ['-xzf', tmpDownload, '-C', reclientDir], {
    stdio: 'inherit',
  });
  if (extract.status !== 0) {
    deleteDir(tmpDownload);
    fatal('Failure while extracting reclient archive');
  }

  if (process.platform === 'win32') {
    fs.renameSync(rbeHelperPath.replace(/\.exe$/, ''), rbeHelperPath);
  }

  deleteDir(tmpDownload);
  fs.writeFileSync(reclientTagFile, credentialHelperTag);
}

export function helperFlags(config?: ConfigLike): Record<string, string> {
  const result = childProcess.spawnSync(helperPath(config), ['flags'], {
    stdio: 'pipe',
  });

  if (result.status === 0) {
    try {
      return JSON.parse(result.stdout.toString()) as Record<string, string>;
    } catch {
      console.error(result.stdout.toString());
      fatal('Failure to run reclient credential helper');
    }
  }
  return {};
}

export function env(config: ConfigLike | undefined): Record<string, string | number> {
  if (config?.remoteBuild === 'none' || !usingRemote || usesTlsClientAuth(config)) {
    return {};
  }

  const base: Record<string, string | number> = {
    RBE_service: serviceAddress(config),
    RBE_credentials_helper: helperPath(config),
    RBE_credentials_helper_args: 'print',
    RBE_experimental_credentials_helper: helperPath(config),
    RBE_experimental_credentials_helper_args: 'print',
  };

  // When building Chromium, don't fail early on local fallbacks
  // as they are expected.
  if (config?.defaultTarget === 'chrome') {
    base['RBE_fail_early_min_action_count'] = 0;
    base['RBE_fail_early_min_fallback_ratio'] = 0;
  }

  return Object.assign(base, helperFlags(config));
}

export function auth(config: ConfigLike): boolean {
  if (usesTlsClientAuth(config)) {
    for (const file of [config.rbeTlsClientCert!, config.rbeTlsClientKey!]) {
      if (!fs.existsSync(resolvePath(file))) {
        fatal(`RBE TLS client auth file ${color.path(file)} does not exist`);
      }
    }
    return true;
  }

  const result = childProcess.spawnSync(helperPath(config), ['status'], {
    stdio: 'pipe',
  });
  if (result.status === 0) {
    const flags = helperFlags(config);
    return flags['RBE_exec_strategy'] !== 'local';
  } else {
    console.error(result.stdout.toString());
    console.error(
      `${color.err} You do not have valid auth for Reclient, please run ${color.cmd(
        'e d rbe login',
      )}`,
    );
    process.exit(result.status ?? 1);
  }
}

export function helperPath(config: ConfigLike | undefined): string {
  return config?.rbeHelperPath ?? rbeHelperPath;
}

export function serviceAddress(config: ConfigLike | undefined): string {
  return config?.rbeServiceAddress ?? RBE_SERVICE_ADDRESS;
}
