const { execSync } = require('child_process');
const { color, fatal } = require('./logging');
const semver = require('semver');

const MINIMUM_PYTHON_VERSION = '3.9.0';
const MINIMUM_NODEJS_VERSION = '22.12.0';

/**
 * Required Python modules for running Electron tests on Linux.
 * These modules are needed for D-Bus mocking in the test suite.
 * @see https://github.com/electron/build-tools/issues/790
 */
const LINUX_TEST_PYTHON_MODULES = [
  {
    name: 'dbusmock',
    packageName: 'python-dbusmock',
    description: 'D-Bus mock library for testing',
  },
  {
    name: 'gi',
    packageName: 'PyGObject',
    description: 'Python GObject introspection bindings',
  },
];

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
 * Get the available Python command
 * @returns {string|null} The Python command or null if not found
 */
function getPythonCommand() {
  const pythonCommands = ['python3', 'python'];

  for (const command of pythonCommands) {
    try {
      execSync(`${command} --version`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return command;
    } catch (error) {
      continue;
    }
  }

  return null;
}

/**
 * Check if a Python module is installed
 * @param {string} moduleName - The name of the Python module to check
 * @returns {boolean} True if the module is installed, false otherwise
 */
function checkPythonModule(moduleName) {
  const pythonCmd = getPythonCommand();
  if (!pythonCmd) return false;

  try {
    execSync(`${pythonCmd} -c "import ${moduleName}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return true;
  } catch (error) {
    return false;
  }
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

/**
 * Ensure Python modules required for running Electron tests are installed.
 * This check is only performed on Linux, as D-Bus mocking is Linux-specific.
 * @see https://github.com/electron/build-tools/issues/790
 */
function ensureTestPrereqs() {
  // D-Bus mocking is only required on Linux
  if (process.platform !== 'linux') {
    return;
  }

  const missingModules = [];

  for (const module of LINUX_TEST_PYTHON_MODULES) {
    if (!checkPythonModule(module.name)) {
      missingModules.push(module);
    }
  }

  if (missingModules.length > 0) {
    const moduleList = missingModules
      .map((m) => `  - ${color.cmd(m.packageName)} (${m.description})`)
      .join('\n');

    const installCmd = missingModules.map((m) => m.packageName).join(' ');

    fatal(
      `Missing Python modules required for running Electron tests on Linux:\n${moduleList}\n\n` +
        `To install these modules, run:\n` +
        `  ${color.cmd(`pip install ${installCmd}`)}\n\n` +
        `Note: ${color.cmd('PyGObject')} may require system dependencies. On Fedora/RHEL:\n` +
        `  ${color.cmd('sudo dnf install python3-devel gobject-introspection-devel cairo-gobject-devel')}\n` +
        `On Ubuntu/Debian:\n` +
        `  ${color.cmd('sudo apt install python3-dev libgirepository1.0-dev libcairo2-dev')}`,
    );
  }
}

module.exports = {
  ensurePrereqs,
  ensureTestPrereqs,
};
