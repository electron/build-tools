import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { styleText } from 'node:util';

import * as semver from 'semver';

import { ensureDir, deleteDir } from './paths.js';
import * as evmConfig from '../evm-config.js';
import type { SanitizedConfig } from '../types.js';
import { color, fatal } from './logging.js';
import SDKs from './sdks.json' with { type: 'json' };

const SDKDir = path.resolve(import.meta.dirname, '..', '..', 'third_party', 'SDKs');
const SDKZip = path.resolve(SDKDir, 'MacOSX.sdk.zip');

const XcodeBaseURL = 'https://dev-cdn-experimental.electronjs.org/xcode/';

type SDKMap = Record<string, { fileName: string; sha256: string }>;
const sdks = SDKs as SDKMap;

/** Pick the highest known SDK version as a fallback. Exported for testing. */
export function fallbackSDK(knownSDKs: SDKMap = sdks): string {
  const semverFallback = Object.keys(knownSDKs)
    .map((v) => semver.valid(semver.coerce(v)))
    .filter((v): v is string => v !== null)
    .sort(semver.rcompare)[0];
  if (!semverFallback) fatal('No known SDK versions');
  return semverFallback.slice(0, semverFallback.length - 2);
}

function getSDKVersion(): string {
  const { SDKROOT } = evmConfig.current().env;

  if (!SDKROOT || !fs.existsSync(SDKROOT)) {
    return 'unknown';
  }

  const settingsPath = path.resolve(SDKROOT, 'SDKSettings.json');
  const data = fs.readFileSync(settingsPath, 'utf8');
  const json = JSON.parse(data) as { MinimalDisplayName: string };

  return json.MinimalDisplayName;
}

function removeUnusedSDKs(): void {
  const recent = fs
    .readdirSync(SDKDir)
    .map((sdk) => {
      const sdkPath = path.join(SDKDir, sdk);
      const { atime } = fs.statSync(sdkPath);
      return { name: sdkPath, atime };
    })
    .sort((a, b) => b.atime.getTime() - a.atime.getTime());

  const { preserveSDK } = evmConfig.current();
  for (const { name } of recent.slice(preserveSDK)) {
    deleteDir(name);
  }
}

// Potentially remove unused Xcode versions.
function maybeRemoveOldXcodes(): void {
  const XcodeDir = path.resolve(import.meta.dirname, '..', '..', 'third_party', 'Xcode');
  if (fs.existsSync(XcodeDir)) {
    deleteDir(XcodeDir);
  }
}

/**
 * Extract the SDK version from the toolchain file and normalize it.
 * Exported for testing.
 */
export function extractSDKVersion(toolchainFile: string): string | null {
  const contents = fs.readFileSync(toolchainFile, 'utf8');
  // Join all comments as single line to allow matching with line breaks
  const commentsSingleLine = contents
    .split('\n')
    .filter((line) => line.startsWith('#'))
    .map((line) => line.substring(1))
    .join('');
  // e.g. macOS 26.0 SDK
  const match = /macOS\s+(?:(\d+(?:\.\d+)?)\s+SDK|SDK\s+(\d+(?:\.\d+)?))/.exec(commentsSingleLine);

  if (match?.[1]) return match[1].includes('.') ? match[1] : `${match[1]}.0`;
  if (match?.[2]) return match[2].includes('.') ? match[2] : `${match[2]}.0`;

  return null;
}

function expectedSDKVersion(): string {
  const { root } = evmConfig.current();

  // The current Xcode version and associated SDK can be found in build/mac_toolchain.py.
  const macToolchainPy = path.resolve(root, 'src', 'build', 'mac_toolchain.py');
  if (!fs.existsSync(macToolchainPy)) {
    console.warn(
      color.warn,
      `Could not find ${color.path(macToolchainPy)} - falling back to default of`,
      fallbackSDK(),
    );
    return fallbackSDK();
  }

  const version = extractSDKVersion(macToolchainPy);
  if (!version || isNaN(Number(version)) || !sdks[version]) {
    console.warn(
      color.warn,
      `Automatically detected an unknown macOS SDK ${color.path(
        version ? `${version} ` : '',
      )}- falling back to default of`,
      fallbackSDK(),
    );
    return fallbackSDK();
  }

  return version;
}

// Ensure that the user has a version of Xcode installed and usable.
function ensureViableXCode(): void {
  const xcodeBuildExec = '/usr/bin/xcodebuild';
  if (fs.existsSync(xcodeBuildExec)) {
    const result = cp.spawnSync(xcodeBuildExec, ['-version']);
    if (result.status === 0) {
      const match = result.stdout
        .toString()
        .trim()
        .match(/Xcode (\d+\.\d+)/);
      if (match?.[1]) {
        if (!semver.satisfies(semver.coerce(match[1]) ?? '0.0.0', '>14')) {
          fatal(`Xcode version ${match[1]} is not supported, please upgrade to Xcode 15 or newer`);
        } else {
          return;
        }
      }
    }
  }

  fatal(`Xcode appears to be missing, you may have Command Line Tools installed but not a full Xcode. Please install Xcode now...

You can get Xcode from the app store: ${styleText(
    'cyan',
    'https://apps.apple.com/us/app/xcode/id497799835',
  )}
Or directly from Apple Developer: ${styleText('cyan', 'https://developer.apple.com/xcode')}

If you have Xcode downloaded and are still seeing this make sure you have:
  1. Opened Xcode at least once and gotten to the "Create new project" screen
  2. Switched to your installed Xcode with ${styleText(
    'green',
    'sudo xcode-select -s /Applications/Xcode.app',
  )}

You can validate your install with "${styleText(
    'green',
    '/usr/bin/xcodebuild -version',
  )}" once you are ready or just run this command again`);
}

export function ensureSDKAndSymlink(config: SanitizedConfig): string {
  const localPath = ensureSDK();

  const outDir = evmConfig.outDir(config);

  const outRelative = path.join('xcode_links', 'electron', path.basename(localPath));
  const xcodeLink = path.resolve(outDir, outRelative);
  if (!fs.existsSync(xcodeLink)) {
    fs.mkdirSync(path.dirname(xcodeLink), {
      recursive: true,
    });
    fs.symlinkSync(localPath, xcodeLink);
  }

  return `//out/${path.basename(outDir)}/${outRelative}`;
}

export function ensureSDK(version?: string): string {
  // For testing purposes
  if (process.env['__VITEST__']) {
    console.log('TEST: ensureSDK called');
    return '';
  }

  ensureViableXCode();

  if (version && !sdks[version]) {
    const availableVersions = Object.keys(sdks).join(', ');
    fatal(
      `SDK version ${version} is invalid or unsupported - please use one of the following: ${availableVersions}`,
    );
  }

  const expected = version ?? expectedSDKVersion();
  const eventualVersionedPath = path.resolve(SDKDir, `MacOSX${expected}.sdk`);

  const shouldEnsureSDK = !fs.existsSync(eventualVersionedPath) || getSDKVersion() !== expected;

  if (shouldEnsureSDK) {
    ensureDir(SDKDir);
    const sdkEntry = sdks[expected];
    if (!sdkEntry) fatal(`SDK entry missing for ${expected}`);
    const expectedSDKHash = sdkEntry.sha256;

    if (!fs.existsSync(eventualVersionedPath)) {
      let shouldDownload = true;
      if (fs.existsSync(SDKZip)) {
        const existingHash = hashFile(SDKZip);
        if (existingHash === expectedSDKHash) {
          shouldDownload = false;
        } else {
          console.log(
            `${color.warn} Got existing hash ${color.cmd(
              existingHash,
            )} which did not match ${color.cmd(expectedSDKHash)} so redownloading SDK`,
          );
          deleteDir(SDKZip);
        }
      }

      if (shouldDownload) {
        const sdkURL = `${XcodeBaseURL}${sdkEntry.fileName}`;
        console.log(`Downloading ${color.cmd(sdkURL)} into ${color.path(SDKZip)}`);
        const { status } = cp.spawnSync(
          process.execPath,
          [path.resolve(import.meta.dirname, '..', 'download.js'), sdkURL, SDKZip],
          {
            stdio: 'inherit',
          },
        );

        if (status !== 0) {
          deleteDir(SDKZip);
          fatal(`Failure while downloading SDK zip`);
        }

        const newHash = hashFile(SDKZip);
        if (newHash !== expectedSDKHash) {
          deleteDir(SDKZip);
          fatal(
            `Downloaded SDK zip had hash "${newHash}" which does not match expected hash "${expectedSDKHash}"`,
          );
        }
      }

      console.log(`Extracting ${color.cmd(SDKZip)} into ${color.path(eventualVersionedPath)}`);
      const unzipPath = path.resolve(SDKDir, 'tmp_unzip');

      // Ensure the unzip path is clean before extracting the SDK.
      deleteDir(unzipPath);

      try {
        const { status } = cp.spawnSync('unzip', ['-q', '-o', SDKZip, '-d', unzipPath], {
          stdio: 'inherit',
        });
        if (status !== 0) {
          fatal('Failure while extracting SDK zip');
        }
      } catch (error) {
        deleteDir(SDKZip);
        deleteDir(unzipPath);
        fatal(error);
      }

      fs.renameSync(path.resolve(unzipPath, 'MacOSX.sdk'), eventualVersionedPath);
      deleteDir(SDKZip);
      deleteDir(unzipPath);
    }

    evmConfig.setEnvVar(evmConfig.currentName(), 'SDKROOT', eventualVersionedPath);

    console.log(`${color.info} Now using SDK version ${color.path(getSDKVersion())}`);
  }

  deleteDir(SDKZip);

  removeUnusedSDKs();
  maybeRemoveOldXcodes();

  return eventualVersionedPath;
}

// Hash MacOSX.sdk directory zip with sha256.
function hashFile(file: string): string {
  console.log(`Calculating hash for ${color.path(file)}`);
  return cp.spawnSync('shasum', ['-a', '256', file]).stdout.toString().split(' ')[0]?.trim() ?? '';
}
