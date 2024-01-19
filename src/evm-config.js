const _ = require('lodash');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Ajv = require('ajv');
const yml = require('js-yaml');
const { URI } = require('vscode-uri');
const { color, fatal } = require('./utils/logging');
const { ensureDir } = require('./utils/paths');
const goma = require('./utils/goma');

const preferredFormat = process.env.EVM_FORMAT || 'json'; // yaml yml json
const configRoot = process.env.EVM_CONFIG || path.resolve(__dirname, '..', 'configs');
const schema = require('../evm-config.schema.json');
const ajv = require('ajv-formats')(new Ajv());

// If you want your shell sessions to each have different active configs,
// try this in your ~/.profile or ~/.zshrc or ~/.bashrc:
// export EVM_CURRENT_FILE="$(mktemp --tmpdir evm-current.XXXXXXXX.txt)"
const currentFiles = _.compact([
  process.env.EVM_CURRENT_FILE,
  path.resolve(configRoot, 'evm-current.txt'),
]);

const getDefaultTarget = () => {
  const name = getCurrentFileName();
  const result = name ? sanitizeConfigWithName(name).defaultTarget : null;

  return result || 'electron';
};

const buildTargets = () => ({
  breakpad: 'third_party/breakpad:dump_syms',
  chromedriver: 'electron:electron_chromedriver_zip',
  electron: 'electron',
  chromium: 'chrome',
  'electron:dist': 'electron:electron_dist_zip',
  mksnapshot: 'electron:electron_mksnapshot_zip',
  'node:headers': 'electron:node_headers',
  default: getDefaultTarget(),
});

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

function validateConfig(config) {
  if (config.configValidationLevel === 'none') {
    return;
  }

  const validate = ajv.compile(schema);

  if (!validate(config)) {
    return validate.errors;
  }
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

  if (!['none', 'cluster', 'cache-only'].includes(config.goma)) {
    config.goma = 'cache-only';
    changes.push(`added missing property ${color.config('goma: cache-only')}`);
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

  if (config.reclient !== 'none' && config.goma !== 'none') {
    config.goma = 'none';
    changes.push(`disabled ${color.config('goma')} as ${color.config('reclient')} is enabled`);
  }

  if (!('preserveXcode' in config)) {
    config.preserveXcode = 5;
    changes.push(`defined ${color.config('preserveXcode')} to default value of 5`);
  }

  const gomaGnArg = `import("${goma.gnFilePath}")`;
  const hasGomaImport = !(
    !config.gen ||
    !config.gen.args ||
    !config.gen.args.find(arg => arg.includes(goma.gnFilePath))
  );
  if (config.goma !== 'none' && !hasGomaImport) {
    config.gen = config.gen || {};
    config.gen.args = config.gen.args || [];
    config.gen.args.push(gomaGnArg);
    changes.push(`added ${color.cmd(gomaGnArg)} needed by goma`);
  } else if (config.goma === 'none' && hasGomaImport) {
    config.gen.args = config.gen.args.filter(arg => !arg.includes(goma.gnFilePath));
    changes.push(`removed gn arg ${color.cmd(gomaGnArg)} as goma is disabled`);
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
    } else {
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
  buildTargets,
  current: () => sanitizeConfigWithName(currentName()),
  currentName,
  execOf,
  fetchByName: name => sanitizeConfigWithName(name),
  names,
  outDir,
  pathOf,
  remove,
  sanitizeConfig,
  sanitizeConfigWithName,
  save,
  setCurrent,
  validateConfig,
};
