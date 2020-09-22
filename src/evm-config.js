const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yml = require('js-yaml');
const { color } = require('./utils/logging');
const { ensureDir } = require('./utils/paths');
const goma = require('./utils/goma');
const util = require('util');

const preferredFormat = process.env.EVM_FORMAT || 'json'; // yaml yml json
const configRoot = process.env.EVM_CONFIG || path.resolve(__dirname, '..', 'configs');

// If you want your shell sessions to each have different active configs,
// try this in your ~/.profile or ~/.zshrc or ~/.bashrc:
// export EVM_CURRENT_FILE="$(mktemp --tmpdir evm-current.XXXXXXXX.txt)"
const currentFiles = _.compact([
  process.env.EVM_CURRENT_FILE,
  path.resolve(configRoot, 'evm-current.txt'),
]);

function buildPath(name, suffix) {
  return path.resolve(configRoot, `evm.${name}.${suffix}`);
}

function buildPathCandidates(name) {
  const suffixes = ['json', 'yml', 'yaml'];
  return suffixes.map(suffix => buildPath(name, suffix));
}

// get the existing filename if it exists; otherwise the preferred name
function pathOf(name) {
  const files = buildPathCandidates(name).filter(file => fs.existsSync(file));
  return files[0] || buildPath(name, preferredFormat);
}

function filenameToConfigName(filename) {
  const match = filename.match(/^evm\.(.*)\.(?:json|yml|yaml)$/);
  return match ? match[1] : null;
}

function ensureConfigExists(name) {
  if (!fs.existsSync(pathOf(name))) {
    throw Error(
      `Build config ${color.config(name)} not found. (Tried ${buildPathCandidates(name)
        .map(f => color.path(f))
        .join(', ')})`,
    );
  }
}

function save(name, o) {
  ensureDir(configRoot);
  const filename = pathOf(name);
  const txt =
    (path.extname(filename) === '.json' ? JSON.stringify(o, null, 2) : yml.safeDump(o)) + '\n';
  fs.writeFileSync(filename, txt);
}

function setCurrent(name) {
  ensureConfigExists(name);
  try {
    currentFiles.forEach(filename => fs.writeFileSync(filename, `${name}\n`));
  } catch (e) {
    throw Error(`Unable to set evm config ${color.config(name)} (${e})`);
  }
}

function names() {
  if (!fs.existsSync(configRoot)) return [];
  return fs
    .readdirSync(configRoot)
    .map(filename => filenameToConfigName(filename))
    .filter(name => name)
    .sort();
}

function currentName() {
  // return the contents of the first nonempty file in currentFiles
  const name = currentFiles.reduce((name, filename) => {
    try {
      return name || fs.readFileSync(filename, { encoding: 'utf8' }).trim();
    } catch (e) {
      return;
    }
  }, null);
  if (name) {
    return name;
  }
  throw Error('No current build configuration');
}

function outDir(config) {
  return path.resolve(config.root, 'src', 'out', config.gen.out);
}

function execOf(config) {
  const execName = (config.execName || 'electron').toLowerCase();
  const builddir = outDir(config);
  switch (os.type()) {
    case 'Linux':
      return path.resolve(builddir, execName);
    case 'Darwin':
      const upperExecName = execName[0].toUpperCase() + execName.slice(1);
      return path.resolve(builddir, `${upperExecName}.app`, 'Contents', 'MacOS', upperExecName);
    default:
      return path.resolve(builddir, `${execName}.exe`);
  }
}

function maybeExtendConfig(config) {
  if (config.extends) {
    const deeperConfig = maybeExtendConfig(loadConfigFileRaw(config.extends));
    delete config.extends;
    return _.mergeWith(config, deeperConfig, (objValue, srcValue) => {
      if (Array.isArray(objValue)) {
        return objValue.concat(srcValue);
      }
    });
  }
  return config;
}

function loadConfigFileRaw(name) {
  const configFile = pathOf(name);
  const configContents = fs.readFileSync(configFile);
  return maybeExtendConfig(yml.safeLoad(configContents));
}

function sanitizeConfig(config) {
  const configName = color.config(currentName());

  if (!['none', 'cluster', 'cache-only'].includes(config.goma)) {
    config.goma = 'cache-only';
    console.warn(
      `${color.warn} Your evm config ${configName} does not define the ${color.config(
        'goma',
      )} property as one of "none", "cluster" or "cache-only" - we are defaulting to ${color.config(
        'cache-only',
      )} for you`,
    );
  }

  if (
    config.goma !== 'none' &&
    (!config.gen || !config.gen.args || !config.gen.args.find(arg => arg.includes(goma.gnFilePath)))
  ) {
    config.gen.args.push(`import("${goma.gnFilePath}")`);
    console.warn(
      `${
        color.warn
      } Your evm config ${configName} has goma enabled but did not include the goma gn file "${color.path(
        goma.gnFilePath,
      )}" in the gen args - we've put it there for you`,
    );
  }

  if (config.origin) {
    const oldConfig = color.config(util.inspect({ origin: config.origin }));
    console.warn(
      `${color.warn} Your evm config ${configName} is using an old remote configuration "${oldConfig}" - we've updated it for you`,
    );

    config.remotes = {
      electron: {
        origin: config.origin.electron,
      },
      node: {
        origin: config.origin.node,
      },
    };

    delete config.origin;
  }

  if (
    config.goma !== 'none' &&
    config.gen &&
    config.gen.args &&
    config.gen.args.find(arg => arg.includes('cc_wrapper'))
  ) {
    config.gen.args = config.gen.args.filter(arg => !arg.includes('cc_wrapper'));
    console.warn(
      `${
        color.warn
      } Your evm config ${configName} has goma enabled but also defines a ${color.config(
        'cc_wrapper',
      )} argument - we have removed it for you`,
    );
  }

  if (!config.env || !config.env.CHROMIUM_BUILDTOOLS_PATH) {
    const toolsPath = path.resolve(config.root, 'src', 'buildtools');
    config.env.CHROMIUM_BUILDTOOLS_PATH = toolsPath;
    console.warn(
      `${color.warn} Your evm config ${configName} has not defined ${color.config(
        'CHROMIUM_BUILDTOOLS_PATH',
      )} - we have added it for you`,
    );
  }

  return config;
}

function remove(name) {
  let currentConfigName;
  try {
    currentConfigName = currentName();
  } catch (_) {
    currentConfigName = null;
  }
  if (currentConfigName && currentConfigName === name) {
    throw Error(`Config is currently in use`);
  }

  ensureConfigExists(name);
  const filename = pathOf(name);
  try {
    return fs.unlinkSync(filename);
  } catch (e) {
    throw Error(`Unable to remove config ${color.config(name)} (${e})`);
  }
}

module.exports = {
  current: () => sanitizeConfig(loadConfigFileRaw(currentName())),
  currentName,
  execOf,
  names,
  outDir,
  pathOf,
  save,
  setCurrent,
  fetchByName: name => sanitizeConfig(loadConfigFileRaw(name)),
  remove,
};
