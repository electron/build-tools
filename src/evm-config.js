const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yml = require('js-yaml');
const { color, fatal } = require('./utils/logging');
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

function testConfigExists(name) {
  if (!fs.existsSync(pathOf(name))) {
    fatal(
      `Build config ${color.config(name)} not found. (Tried ${buildPathCandidates(name)
        .map(f => color.path(f))
        .join(', ')})`,
    );
  }
}

function save(name, o) {
  ensureDir(configRoot);
  const filename = pathOf(name);
  const isJSON = path.extname(filename) === '.json';
  const txt = (isJSON ? JSON.stringify(o, null, 2) : yml.safeDump(o)) + '\n';
  fs.writeFileSync(filename, txt);
}

function setCurrent(name) {
  testConfigExists(name);
  try {
    currentFiles.forEach(filename => fs.writeFileSync(filename, `${name}\n`));
  } catch (e) {
    fatal(`Unable to set config ${color.config(name)}: `, e);
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

  if (name) return name;
  fatal('No current build configuration.');
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
  const configPath = pathOf(name);

  if (!fs.existsSync(configPath)) {
    fatal(`Build config ${color.config(name)} not found.`);
  }

  const configContents = fs.readFileSync(configPath);
  return maybeExtendConfig(yml.safeLoad(configContents));
}

function sanitizeConfig(name, overwrite = false) {
  const config = loadConfigFileRaw(name);
  const changes = [];

  if (!['none', 'cluster', 'cache-only'].includes(config.goma)) {
    config.goma = 'cache-only';
    changes.push(`added missing property ${color.config('goma: cache-only')}`);
  }

  if (
    config.goma !== 'none' &&
    (!config.gen || !config.gen.args || !config.gen.args.find(arg => arg.includes(goma.gnFilePath)))
  ) {
    const str = `import("${goma.gnFilePath}")`;
    config.gen.args.push(str);
    changes.push(`added ${color.cmd(str)} needed by goma`);
  }

  if (config.origin) {
    const oldConfig = color.config(util.inspect({ origin: config.origin }));

    config.remotes = {
      electron: {
        origin: config.origin.electron,
      },
      node: {
        origin: config.origin.node,
      },
    };

    delete config.origin;
    changes.push(`replaced superceded 'origin' property with 'remotes' property`);
  }

  if (
    config.goma !== 'none' &&
    config.gen &&
    config.gen.args &&
    config.gen.args.find(arg => arg.includes('cc_wrapper'))
  ) {
    config.gen.args = config.gen.args.filter(arg => !arg.includes('cc_wrapper'));
    changes.push(`removed ${color.config('cc_wrapper')} definition because goma is enabled`);
  }

  if (!config.env || !config.env.CHROMIUM_BUILDTOOLS_PATH) {
    const toolsPath = path.resolve(config.root, 'src', 'buildtools');
    config.env.CHROMIUM_BUILDTOOLS_PATH = toolsPath;
    changes.push(`defined ${color.config('CHROMIUM_BUILDTOOLS_PATH')}`);
  }

  if (changes.length > 0) {
    if (overwrite) {
      save(name, config);
    } else {
      console.warn(`${color.warn} We've made these temporary changes to your configuration:`);
      console.warn(changes.map(change => ` * ${change}`).join('\n'));
      console.warn(`Run ${color.cmd('e sanitize-config')} to make these changes permanent.`);
    }
  }

  return config;
}

function remove(name) {
  testConfigExists(name);

  let currentConfigName;
  try {
    currentConfigName = currentName();
  } catch {
    currentConfigName = null;
  }
  if (currentConfigName && currentConfigName === name) {
    fatal(`Config is currently in use`);
  }

  const filename = pathOf(name);
  try {
    return fs.unlinkSync(filename);
  } catch (e) {
    fatal(`Unable to remove config ${color.config(name)}: `, e);
  }
}

module.exports = {
  current: () => sanitizeConfig(currentName()),
  currentName,
  execOf,
  fetchByName: name => sanitizeConfig(name),
  names,
  outDir,
  pathOf,
  remove,
  sanitizeConfig,
  save,
  setCurrent,
};
