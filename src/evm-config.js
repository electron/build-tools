const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yml = require('js-yaml');
const { color } = require('./utils/logging');
const { ensureDir } = require('./utils/paths');
const goma = require('./utils/goma');

const configRoot = process.env.EVM_CONFIG || path.resolve(__dirname, '..', 'configs');
const currentFile = path.resolve(configRoot, 'evm-current.txt');
const preferredFormat = process.env.EVM_FORMAT || 'json'; // yaml yml json

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

function save(name, o) {
  ensureDir(configRoot);
  const filename = pathOf(name);
  const txt =
    (path.extname(filename) === '.json' ? JSON.stringify(o, null, 2) : yml.safeDump(o)) + '\n';
  fs.writeFileSync(filename, txt);
}

function setCurrent(name) {
  const filename = pathOf(name);
  if (!fs.existsSync(filename)) {
    throw Error(
      `Build config ${color.config(name)} not found. (Tried ${buildPathCandidates(name)
        .map(f => color.path(f))
        .join(', ')})`,
    );
  }
  try {
    fs.writeFileSync(currentFile, `${name}\n`);
  } catch (e) {
    throw Error(`Unable to set evm config ${color.config(name)} (${e})`);
  }
}

function names() {
  return fs
    .readdirSync(configRoot)
    .map(filename => filenameToConfigName(filename))
    .filter(name => name)
    .sort();
}

function currentName() {
  if (process.env.EVM_CURRENT) return process.env.EVM_CURRENT;
  if (!fs.existsSync(currentFile)) throw Error('No current build configuration');
  return fs.readFileSync(currentFile, { encoding: 'utf8' }).trim();
}

function outDir(config) {
  return path.resolve(config.root, 'src', 'out', config.gen.out);
}

function execOf(config) {
  const builddir = outDir(config);
  switch (os.type()) {
    case 'Linux':
      return path.resolve(builddir, 'electron');
    case 'Darwin':
      return path.resolve(builddir, 'Electron.app', 'Contents', 'MacOS', 'Electron');
    default:
      return path.resolve(builddir, 'electron.exe');
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

module.exports = {
  current: () => sanitizeConfig(loadConfigFileRaw(currentName())),
  currentName,
  execOf,
  names,
  outDir,
  pathOf,
  save,
  setCurrent,
};
