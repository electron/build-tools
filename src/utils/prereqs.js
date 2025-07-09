const { execSync } = require('child_process');
const { fatal } = require('./logging');
const semver = require('semver');

const MINIMUM_PYTHON_VERSION = '3.9.0';
const MINIMUM_NODEJS_VERSION = '22.12.0';

/**
 * Check if Python is installed and meets minimum version requirements
 * @returns {Object} Object with isValid boolean and version string
 */
function checkPythonVersion() {
  const pythonCommands = ['python3', 'python'];

  for (const command of pythonCommands) {
    try {
      const versionOutput = execSync(`${command} --version`, {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();

      const versionMatch = versionOutput.match(/Python (\d+\.\d+\.\d+)/);
      if (!versionMatch) continue;

      const version = versionMatch[1];
      return semver.gte(version, MINIMUM_PYTHON_VERSION);
    } catch (error) {
      continue;
    }
  }

  return false;
}

/**
 * Check if Node.js is installed and meets minimum version requirements
 * @returns {Object} Object with isValid boolean and version string
 */
function checkNodeVersion() {
  try {
    const versionOutput = execSync('node --version', {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    const versionMatch = versionOutput.match(/v(\d+\.\d+\.\d+)/);
    if (!versionMatch) return false;

    const version = versionMatch[1];
    return semver.gte(version, MINIMUM_NODEJS_VERSION);
  } catch (error) {
    return false;
  }
}

/**
 * Ensure system prereqs installed and meet minimum version requirements
 */
function ensurePrereqs() {
  const validPythonVersion = checkPythonVersion();
  if (!validPythonVersion) {
    fatal(
      `Python is not installed or does not meet minimum version requirements. ` +
        `Python ${MINIMUM_PYTHON_VERSION} or higher must be installed to use build-tools.`,
    );
  }

  const validNodeVersion = checkNodeVersion();
  if (!validNodeVersion) {
    fatal(
      `Node.js is not installed or does not meet minimum version requirements. ` +
        `Node.js ${MINIMUM_NODEJS_VERSION} or higher must be installed to use build-tools.`,
    );
  }
}

module.exports = {
  ensurePrereqs,
};
