const fs = require('fs');
const os = require('os');
const path = require('path');
const Ajv = require('ajv');
const YAML = require('yaml');
const { URI } = require('vscode-uri');
const { color, fatal } = require('./utils/logging');
const { ensureDir } = require('./utils/paths');

const configRoot = () => process.env.EVM_CONFIG || path.resolve(__dirname, '..', 'configs');
const schema = require('../evm-config.schema.json');
const ajv = require('ajv-formats')(new Ajv());

let shouldWarn = true;

const resetShouldWarn = () => {
  shouldWarn = true;
};

// If you want your shell sessions to each have different active configs,
// try this in your ~/.profile or ~/.zshrc or ~/.bashrc:
// export EVM_CURRENT_FILE="$(mktemp --tmpdir evm-current.XXXXXXXX.txt)"
const currentFiles = [
  process.env.EVM_CURRENT_FILE,
  path.resolve(configRoot(), 'evm-current.txt'),
].filter(Boolean);

const getDefaultTarget = () => {
  const name = getCurrentFileName();
  const result = name ? sanitizeConfigWithName(name).defaultTarget : null;

  return result || 'electron';
};

function buildPath(name, suffix) {
  return path.resolve(configRoot(), `evm.${name}.${suffix}`);
}

function buildPathCandidates(name) {
  const suffixes = ['json', 'yml', 'yaml'];
  return suffixes.map(suffix => buildPath(name, suffix));
}

function mergeConfigs(target, source) {
  for (const key in source) {
    if (Array.isArray(target[key]) && Array.isArray(source[key])) {
      target[key] = target[key].concat(source[key]);
    } else if (typeof target[key] === 'object' && typeof source[key] === 'object') {
      target[key] = mergeConfigs(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// get the existing filename if it exists; otherwise the preferred name
function pathOf(name) {
  const files = buildPathCandidates(name).filter(file => fs.existsSync(file));
  const preferredFormat = process.env.EVM_FORMAT || 'json'; // yaml yml json
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
  ensureDir(configRoot());
  const filename = pathOf(name);
  const isJSON = path.extname(filename) === '.json';
  const txt = (isJSON ? JSON.stringify(o, null, 2) : YAML.stringify(o)) + '\n';
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
  if (!fs.existsSync(configRoot())) return [];
  return fs
    .readdirSync(configRoot())
    .map(filename => filenameToConfigName(filename))
    .filter(name => name)
    .sort();
}

function getCurrentFileName() {
  return currentFiles.reduce((name, filename) => {
    try {
      return name || fs.readFileSync(filename, { encoding: 'utf8' }).trim();
    } catch (e) {
      return;
    }
  }, null);
}

function currentName() {
  // Return the contents of the first nonempty file in currentFiles.
  const name = getCurrentFileName();

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
    return mergeConfigs(config, deeperConfig);
  }
  return config;
}

function loadConfigFileRaw(name) {
  const configPath = pathOf(name);

  if (!fs.existsSync(configPath)) {
    fatal(`Build config ${color.config(name)} not found.`);
  }

  const configContents = fs.readFileSync(configPath, { encoding: 'utf8' });
  return maybeExtendConfig(YAML.parse(configContents));
}

function validateConfig(config) {
  if (config.configValidationLevel === 'none') {
    return;
  }

  const validate = ajv.compile(schema);

  if (!validate(config)) {
    return validate.errors;
  }
}

function setEnvVar(name, key, value) {
  const config = loadConfigFileRaw(name);

  config.env = config.env || {};
  config.env[key] = value;

  save(name, config);
}

function sanitizeConfig(name, config, overwrite = false) {
  const changes = [];

  if (!config.configValidationLevel) {
    config.configValidationLevel = 'strict';
  }

  if (!('$schema' in config)) {
    config.$schema = URI.file(path.resolve(__dirname, '..', 'evm-config.schema.json')).toString();
    changes.push(`added missing property ${color.config('$schema')}`);
  }

  if (config.origin) {
    config.remotes = {
      electron: {
        origin: config.origin.electron,
      },
    };

    delete config.origin;
    changes.push(`replaced superceded 'origin' property with 'remotes' property`);
  } else if (config.remotes && config.remotes.node) {
    delete config.remotes.node;
    changes.push(`removed deprecated ${color.config('remotes.node')} property`);
  }

  if (!config.reclient) {
    config.reclient = 'none';
    changes.push(`defined ${color.config('reclient')} to default value of none`);
  }

  if (!['none', 'remote_exec'].includes(config.reclient)) {
    config.reclient = 'none';
    changes.push(`fixed invalid property ${color.config('reclient: none')}`);
  }

  if (!('preserveXcode' in config)) {
    config.preserveXcode = 5;
    changes.push(`defined ${color.config('preserveXcode')} to default value of 5`);
  }

  if (config.goma) {
    delete config.goma;
    changes.push(`removed deprecated ${color.config('goma')} property`);
  }

  if (config.gomaSource) {
    delete config.gomaSource;
    changes.push(`removed deprecated ${color.config('gomaSource')} property`);
  }

  const remoteExecGnArg = 'use_remoteexec = true';
  const hasRemoteExecGN = !(
    !config.gen ||
    !config.gen.args ||
    !config.gen.args.find(arg => /^use_remoteexec ?= ?true$/.test(arg))
  );
  if (config.reclient !== 'none' && !hasRemoteExecGN) {
    config.gen = config.gen || {};
    config.gen.args = config.gen.args || [];
    config.gen.args.push(remoteExecGnArg);
    changes.push(`added gn arg ${color.cmd(remoteExecGnArg)} needed by remoteexec`);
  } else if (config.reclient === 'none' && hasRemoteExecGN) {
    config.gen.args = config.gen.args.filter(arg => !/^use_remoteexec ?= ?true$/.test(arg));
    changes.push(`removed gn arg ${color.cmd(remoteExecGnArg)} as remoteexec is disabled`);
  }

  if (!config.env) config.env = {};

  if (!config.env.CHROMIUM_BUILDTOOLS_PATH) {
    const toolsPath = path.resolve(config.root, 'src', 'buildtools');
    config.env.CHROMIUM_BUILDTOOLS_PATH = toolsPath;
    changes.push(`defined ${color.config('CHROMIUM_BUILDTOOLS_PATH')}`);
  }

  if (changes.length > 0) {
    if (overwrite) {
      save(name, config);
    } else if (shouldWarn) {
      shouldWarn = false;
      console.warn(`${color.warn} We've made these temporary changes to your configuration:`);
      console.warn(changes.map(change => ` * ${change}`).join('\n'));
      console.warn(`Run ${color.cmd('e sanitize-config')} to make these changes permanent.`);
    }
  }

  const validationErrors = validateConfig(config);

  if (validationErrors) {
    const log = config.configValidationLevel === 'strict' ? console.error : console.warn;
    const logColor = config.configValidationLevel === 'strict' ? color.err : color.warn;

    log(`${logColor} Config file ${color.config(`${name}`)} had the following validation errors:`);
    log(JSON.stringify(validationErrors, undefined, 2));

    if (config.configValidationLevel === 'strict') {
      process.exit(1);
    }
  }

  return config;
}

function sanitizeConfigWithName(name, overwrite = false) {
  return sanitizeConfig(name, loadConfigFileRaw(name), overwrite);
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
  getDefaultTarget,
  current: () => sanitizeConfigWithName(currentName()),
  maybeCurrent: () => (getCurrentFileName() ? sanitizeConfigWithName(currentName()) : {}),
  currentName,
  execOf,
  fetchByName: name => sanitizeConfigWithName(name),
  names,
  outDir,
  pathOf,
  remove,
  resetShouldWarn,
  sanitizeConfig,
  sanitizeConfigWithName,
  save,
  setCurrent,
  setEnvVar,
  validateConfig,
};
