import { execSync } from 'node:child_process';

import * as semver from 'semver';

import { fatal } from './logging.js';

const MINIMUM_PYTHON_VERSION = '3.9.0';
const MINIMUM_NODEJS_VERSION = '22.18.0';

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
