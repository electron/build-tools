const fs = require('fs');
const os = require('os');
const path = require('path');
const { color, ensureDir } = require('./util');

const configRoot = process.env.EVM_CONFIG || path.resolve(__dirname, '..');
const currentFile = path.resolve(configRoot, 'evm-current.json');

function pathOf(name) {
  return path.resolve(configRoot, `evm.${name}.json`);
}

function filenameToConfigName(filename) {
  const match = filename.match(/^evm\.(.*)\.json$/);
  return match ? match[1] : null;
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
    throw `Build config ${color.config(name)} not found. (Tried ${color.path(filename)}.)`;
  }
  try {
    fs.writeFileSync(currentFile, `${name}\n`);
  } catch (e) {
    throw `Unable to set evm config ${color.config(name)} (${e})`;
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
  if (!fs.existsSync(currentFile)) throw `No current build configuration`;
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

module.exports = {
  current: () => JSON.parse(fs.readFileSync(pathOf(currentName()))),
  currentName,
  execOf,
  names,
  outDir,
  pathOf,
  save,
  setCurrent,
};
