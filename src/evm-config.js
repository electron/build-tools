const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yml = require('yaml-js');
const { color, ensureDir } = require('./util');

const configRoot = process.env.EVM_CONFIG || path.resolve(__dirname, '..', 'configs');
const currentFile = path.resolve(configRoot, 'evm-current.txt');

function pathOf(name) {
  const jsonPath = path.resolve(configRoot, `evm.${name}.json`);
  if (fs.existsSync(jsonPath)) {
    return jsonPath;
  }
  return path.resolve(configRoot, `evm.${name}.yml`);
}

function filenameToConfigName(filename) {
  const jsonMatch = filename.match(/^evm\.(.*)\.json$/);
  if (jsonMatch) return jsonMatch[1];
  const ymlMatch = filename.match(/^evm\.(.*)\.yml$/);
  return ymlMatch ? ymlMatch[1] : null;
}

function save(name, o) {
  ensureDir(configRoot);
  const filename = pathOf(name);
  const txt = JSON.stringify(o, null, 2) + '\n';
  fs.writeFileSync(filename, txt);
}

function setCurrent(name) {
  const filename = pathOf(name);
  if (!fs.existsSync(filename)) {
    throw Error(`Build config ${color.config(name)} not found. (Tried ${color.path(filename)}.)`);
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
  if (path.extname(configFile) === '.yml') {
    return maybeExtendConfig(yml.load(configContents));
  }
  return maybeExtendConfig(JSON.parse(configContents));
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
