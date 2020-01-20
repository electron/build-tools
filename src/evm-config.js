const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yml = require('js-yaml');
const { color, ensureDir } = require('./utils/e-utils');

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

module.exports = {
  current: () => loadConfigFileRaw(currentName()),
  currentName,
  execOf,
  names,
  outDir,
  pathOf,
  save,
  setCurrent,
};
