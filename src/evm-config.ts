import { Ajv, AnySchema } from 'ajv';
import ajvFormats from 'ajv-formats';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import vscode from 'vscode-uri';

import { color, fatal } from './utils/logging.js';
import { ensureDir } from './utils/paths.js';
import {
  EVMBaseElectronConfiguration,
  EVMConfigurationSchema,
  EVMMaybeOutdatedBaseElectronConfiguration,
  EVMResolvedConfiguration,
} from './evm-config.schema.js';

const { URI } = vscode;

const configRoot = () =>
  process.env.EVM_CONFIG || path.resolve(import.meta.dirname, '..', 'configs');
const schema: AnySchema = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '..', 'evm-config.schema.json'), 'utf8'),
);
const ajv = (ajvFormats as any)(new Ajv());

let warnAboutAutomaticConfigChanges = true;

export const warnAboutNextConfigChange = () => {
  warnAboutAutomaticConfigChanges = true;
};

// If you want your shell sessions to each have different active configs,
// try this in your ~/.profile or ~/.zshrc or ~/.bashrc:
// export EVM_CURRENT_FILE="$(mktemp --tmpdir evm-current.XXXXXXXX.txt)"
const currentFiles: string[] = [path.resolve(configRoot(), 'evm-current.txt')];
if (process.env.EVM_CURRENT_FILE) {
  currentFiles.unshift(process.env.EVM_CURRENT_FILE);
}

export function getDefaultTarget(): string {
  const name = getCurrentFileName();
  const result = name ? sanitizeConfigWithName(name).defaultTarget : null;

  return result || 'electron';
}

function buildPath(name: string, suffix: string): string {
  return path.resolve(configRoot(), `evm.${name}.${suffix}`);
}

function buildPathCandidates(name: string): string[] {
  const suffixes = ['json', 'yml', 'yaml'];
  return suffixes.map((suffix) => buildPath(name, suffix));
}

function mergeConfigs<T extends object>(target: T, source: T): T {
  for (const key in source) {
    if (Array.isArray(target[key]) && Array.isArray(source[key])) {
      target[key] = target[key].concat(source[key]) as any;
    } else if (
      typeof target[key] === 'object' &&
      typeof source[key] === 'object' &&
      target[key] !== null &&
      source[key] !== null
    ) {
      target[key] = mergeConfigs(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// get the existing filename if it exists; otherwise the preferred name
export function pathOf(name: string): string {
  const files = buildPathCandidates(name).filter((file) => fs.existsSync(file));
  const preferredFormat = process.env.EVM_FORMAT || 'json'; // yaml yml json
  return files[0] || buildPath(name, preferredFormat);
}

function filenameToConfigName(filename: string): string | null {
  const match = filename.match(/^evm\.(.*)\.(?:json|yml|yaml)$/);
  return match ? match[1] : null;
}

function testConfigExists(name: string): void | never {
  if (!fs.existsSync(pathOf(name))) {
    fatal(
      `Build config ${color.config(name)} not found. (Tried ${buildPathCandidates(name)
        .map((f) => color.path(f))
        .join(', ')})`,
    );
  }
}

export function saveConfig(name: string, o: EVMConfigurationSchema): void {
  ensureDir(configRoot());
  const filename = pathOf(name);
  const isJSON = path.extname(filename) === '.json';
  const txt = (isJSON ? JSON.stringify(o, null, 2) : YAML.stringify(o)) + '\n';
  fs.writeFileSync(filename, txt);
}

export function setCurrentConfig(name: string): void {
  testConfigExists(name);
  try {
    for (const filename of currentFiles) {
      fs.writeFileSync(filename, `${name}\n`);
    }
  } catch (e) {
    fatal(`Unable to set config ${color.config(name)}: ${e}`);
  }
}

export function possibleNames(): string[] {
  if (!fs.existsSync(configRoot())) return [];
  return fs
    .readdirSync(configRoot())
    .map((filename) => filenameToConfigName(filename))
    .filter((name): name is string => name !== null)
    .sort();
}

function getCurrentFileName(): string | null {
  for (const filename of currentFiles) {
    try {
      return fs.readFileSync(filename, 'utf-8').trim();
    } catch {
      // Ignore
    }
  }
  return null;
}

export function currentName(): string {
  // Return the contents of the first nonempty file in currentFiles.
  const name = getCurrentFileName();

  if (name) return name;
  fatal('No current build configuration.');
}

export function outDir(config: EVMResolvedConfiguration): string {
  return path.resolve(config.root, 'src', 'out', config.gen.out);
}

export function execOf(config: EVMResolvedConfiguration): string {
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

function maybeExtendConfig(config: EVMConfigurationSchema): EVMConfigurationSchema {
  if ('extends' in config) {
    const deeperConfig = maybeExtendConfig(loadConfigFileRaw(config.extends));
    const { extends: _, ...restConfig } = config;
    return mergeConfigs(restConfig, deeperConfig) as EVMConfigurationSchema;
  }
  return config;
}

function loadConfigFileRaw(name: string): EVMConfigurationSchema {
  const configPath = pathOf(name);

  if (!fs.existsSync(configPath)) {
    fatal(`Build config ${color.config(name)} not found.`);
  }

  const configContents = fs.readFileSync(configPath, { encoding: 'utf8' });
  return maybeExtendConfig(YAML.parse(configContents));
}

export function validateConfig(config: Partial<EVMConfigurationSchema>) {
  if (config.configValidationLevel === 'none') {
    return;
  }

  const validate = ajv.compile(schema);

  if (!validate(config)) {
    return validate.errors;
  }
  return null;
}

export function setEnvVar(name: string, key: string, value: string): void {
  const config = sanitizeConfigWithName(name);

  config.env[key] = value;

  saveConfig(name, config);
}

export function sanitizeConfig(
  name: string,
  config: Partial<EVMMaybeOutdatedBaseElectronConfiguration>,
  overwrite = false,
): EVMBaseElectronConfiguration {
  const changes: string[] = [];

  if (!config.configValidationLevel) {
    config.configValidationLevel = 'strict';
  }

  if (!('$schema' in config)) {
    config.$schema = URI.file(
      path.resolve(import.meta.dirname, '..', 'evm-config.schema.json'),
    ).toString();
    changes.push(`added missing property ${color.config('$schema')}`);
  }

  if (!('preserveSDK' in config)) {
    config.preserveSDK = config.preserveXcode ?? 5;
    changes.push(`added ${color.config('preserveSDK')} property`);
  }

  if (config.preserveXcode) {
    delete config.preserveXcode;
    changes.push(`removed ${color.config('preserveXcode')} property`);
  }

  if (config.onlySdk) {
    delete config.onlySdk;
    changes.push(`removed ${color.config('onlySdk')} property`);
  }

  const remoteExecGnArg = 'use_remoteexec = true';
  const useSisoGnArg = 'use_siso = true';
  const hasRemoteExecGN = !(
    !config.gen ||
    !config.gen.args ||
    !config.gen.args.find((arg) => /^use_remoteexec ?= ?true$/.test(arg))
  );
  const hasUseSisoGN = !(
    !config.gen ||
    !config.gen.args ||
    !config.gen.args.find((arg) => /^use_siso ?= ?true$/.test(arg))
  );

  if (!config.remoteBuild) {
    if (config.reclient) {
      config.remoteBuild = config.reclient === 'none' ? 'none' : 'reclient';
      changes.push(
        `converted ${color.config('reclient')} setting ${color.config('remoteBuild')} property`,
      );
      delete config.reclient;
    } else {
      config.remoteBuild = 'none';
      changes.push(`added missing explicit ${color.config('remoteBuild')} property`);
    }
  }

  config.gen ??= { args: [], out: 'Default' };
  config.gen.args ??= [];

  if (config.remoteBuild !== 'none' && !hasRemoteExecGN) {
    config.gen.args.push(remoteExecGnArg);
    changes.push(`added gn arg ${color.cmd(remoteExecGnArg)} needed by remoteexec`);
  } else if (config.remoteBuild === 'none' && hasRemoteExecGN) {
    config.gen.args = config.gen.args.filter((arg) => !/^use_remoteexec ?= ?true$/.test(arg));
    changes.push(`removed gn arg ${color.cmd(remoteExecGnArg)} as remoteexec is disabled`);
  }

  if (config.remoteBuild === 'siso' && !hasUseSisoGN) {
    config.gen.args.push(useSisoGnArg);
    changes.push(
      `added gn arg ${color.cmd(useSisoGnArg)} needed by ${color.config('remoteBuild')} siso`,
    );
  } else if (config.remoteBuild !== 'siso' && hasUseSisoGN) {
    config.gen.args = config.gen.args.filter((arg) => !/^use_siso ?= ?true$/.test(arg));
    changes.push(`removed gn arg ${color.cmd(useSisoGnArg)} as siso is disabled`);
  }

  if (!config.rbeHelperPath && config.reclientHelperPath) {
    config.rbeHelperPath = config.reclientHelperPath;
    changes.push(
      `renamed ${color.config('reclientHelperPath')} to ${color.config('rbeHelperPath')}`,
    );
    delete config.reclientHelperPath;
  }

  if (!config.rbeServiceAddress && config.reclientServiceAddress) {
    config.rbeServiceAddress = config.reclientServiceAddress;
    changes.push(
      `renamed ${color.config('reclientServiceAddress')} to ${color.config('rbeServiceAddress')}`,
    );
    delete config.reclientServiceAddress;
  }

  if (!config.root) {
    fatal(`Config ${color.config(name)} is missing the required property ${color.config('root')}`);
  }

  const toolsPath = path.resolve(config.root, 'src', 'buildtools');
  config.env ??= { CHROMIUM_BUILDTOOLS_PATH: toolsPath };

  if (!config.env.CHROMIUM_BUILDTOOLS_PATH) {
    config.env.CHROMIUM_BUILDTOOLS_PATH = toolsPath;
    changes.push(`defined ${color.config('CHROMIUM_BUILDTOOLS_PATH')}`);
  }

  if (changes.length > 0) {
    if (overwrite) {
      saveConfig(name, config as EVMBaseElectronConfiguration);
    } else if (warnAboutAutomaticConfigChanges) {
      warnAboutAutomaticConfigChanges = false;
      console.warn(`${color.warn} We've made these temporary changes to your configuration:`);
      console.warn(changes.map((change) => ` * ${change}`).join('\n'));
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

  return config as EVMBaseElectronConfiguration;
}

export function sanitizeConfigWithName(name: string, overwrite = false) {
  return sanitizeConfig(name, loadConfigFileRaw(name), overwrite);
}

export function removeConfig(name: string): void {
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
    fatal(`Unable to remove config ${color.config(name)}: ${e}`);
  }
}

export function current(): EVMBaseElectronConfiguration {
  return sanitizeConfigWithName(currentName());
}

export function maybeCurrent(): EVMBaseElectronConfiguration | null {
  const currentFileName = getCurrentFileName();
  return currentFileName ? sanitizeConfigWithName(currentFileName) : null;
}

export function fetchByName(name: string): EVMBaseElectronConfiguration {
  return sanitizeConfigWithName(name);
}
