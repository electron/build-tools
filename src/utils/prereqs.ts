import { execSync } from 'node:child_process';

import * as semver from 'semver';

import { fatal } from './logging.js';

const MINIMUM_PYTHON_VERSION = '3.9.0';
const MINIMUM_NODEJS_VERSION = '22.18.0';

/**
 * Check if Python is installed and meets minimum version requirements
 * @returns {boolean} True if Python is installed and meets minimum version requirements, false otherwise
 */
function checkPythonVersion(): boolean {
  const pythonCommands = ['python3', 'python'];

  for (const command of pythonCommands) {
    try {
      const versionOutput = execSync(`${command} --version`, {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();

      const versionMatch = versionOutput.match(/Python (\d+\.\d+\.\d+)/);
      if (!versionMatch?.[1]) continue;

      return semver.gte(versionMatch[1], MINIMUM_PYTHON_VERSION);
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Check if Node.js is installed and meets minimum version requirements
 * @returns {boolean} True if Node.js is installed and meets minimum version requirements, false otherwise
 */
function checkNodeVersion(): boolean {
  try {
    const versionOutput = execSync('node --version', {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    const versionMatch = versionOutput.match(/v(\d+\.\d+\.\d+)/);
    if (!versionMatch?.[1]) return false;

    return semver.gte(versionMatch[1], MINIMUM_NODEJS_VERSION);
  } catch {
    return false;
  }
}

/**
 * Check if the Metal toolchain is usable
 *
 * Xcode 26 unbundled the Metal toolchain into a separately installed component,
 * but Xcode still ships a `metal` stub that fails at execution time when the
 * component is missing - so probe by running the tool rather than looking for it.
 * @returns {boolean} True if the Metal toolchain can be executed, false otherwise
 */
function checkMetalToolchain(): boolean {
  try {
    execSync('xcrun metal --version', {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the Metal toolchain is installed, as ANGLE's shader targets need it.
 * Only relevant on macOS, and only for builds - syncing does not use it.
 */
export function ensureMetalToolchain(): void {
  if (process.platform !== 'darwin') return;

  if (!checkMetalToolchain()) {
    fatal(
      `The Metal toolchain is not installed, and ANGLE's shader targets need it to build. ` +
        `Xcode 26 unbundled it from Xcode itself, so it has to be installed separately:\n` +
        `  xcodebuild -runFirstLaunch\n` +
        `  xcodebuild -downloadComponent MetalToolchain`,
    );
  }
}

/**
 * Ensure system prereqs installed and meet minimum version requirements
 */
export function ensurePrereqs(): void {
  if (!checkPythonVersion()) {
    fatal(
      `Python is not installed or does not meet minimum version requirements. ` +
        `Python ${MINIMUM_PYTHON_VERSION} or higher must be installed to use build-tools.`,
    );
  }

  if (!checkNodeVersion()) {
    fatal(
      `Node.js is not installed or does not meet minimum version requirements. ` +
        `Node.js ${MINIMUM_NODEJS_VERSION} or higher must be installed to use build-tools.`,
    );
  }
}
