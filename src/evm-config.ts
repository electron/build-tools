import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import * as YAML from 'yaml';
import type { z } from 'zod';

import { color, fatal } from './utils/logging.js';
import { ensureDir } from './utils/paths.js';
import { evmConfigSchema, type EvmConfig, type SanitizedConfig } from './types.js';

const configRoot = (): string =>
  process.env['EVM_CONFIG'] ?? path.resolve(import.meta.dirname, '..', 'configs');

let shouldWarn = true;

export function resetShouldWarn(): void {
  shouldWarn = true;
}

// If you want your shell sessions to each have different active configs,
// try this in your ~/.profile or ~/.zshrc or ~/.bashrc:
// export EVM_CURRENT_FILE="$(mktemp --tmpdir evm-current.XXXXXXXX.txt)"
const currentFiles = (): string[] =>
  [process.env['EVM_CURRENT_FILE'], path.resolve(configRoot(), 'evm-current.txt')].filter(
    (f): f is string => Boolean(f),
  );

function buildPath(name: string, suffix: string): string {
  return path.resolve(configRoot(), `evm.${name}.${suffix}`);
}

function buildPathCandidates(name: string): string[] {
  const suffixes = ['json', 'yml', 'yaml'];
  return suffixes.map((suffix) => buildPath(name, suffix));
}

/** Deep-merge two config objects. Arrays concat, objects recurse. Exported for testing. */
export function mergeConfigs<T extends Record<string, unknown>>(target: T, source: T): T {
  for (const key of Object.keys(source)) {
    const tVal = target[key];
    const sVal = source[key];
    if (Array.isArray(tVal) && Array.isArray(sVal)) {
      (target as Record<string, unknown>)[key] = tVal.concat(sVal);
    } else if (
      tVal &&
      sVal &&
      typeof tVal === 'object' &&
      typeof sVal === 'object' &&
      !Array.isArray(tVal) &&
      !Array.isArray(sVal)
    ) {
      (target as Record<string, unknown>)[key] = mergeConfigs(
        tVal as Record<string, unknown>,
        sVal as Record<string, unknown>,
      );
    } else {
      (target as Record<string, unknown>)[key] = sVal;
    }
  }
  return target;
}

// get the existing filename if it exists; otherwise the preferred name
export function pathOf(name: string): string {
  const files = buildPathCandidates(name).filter((file) => fs.existsSync(file));
  const preferredFormat = process.env['EVM_FORMAT'] ?? 'json'; // yaml yml json
  return files[0] ?? buildPath(name, preferredFormat);
}

/** Convert a stored config filename back to its config name. Exported for testing. */
export function filenameToConfigName(filename: string): string | null {
  const match = filename.match(/^evm\.(.*)\.(?:json|yml|yaml)$/);
  return match?.[1] ?? null;
}

function testConfigExists(name: string): void {
  if (!fs.existsSync(pathOf(name))) {
    fatal(
      `Build config ${color.config(name)} not found. (Tried ${buildPathCandidates(name)
        .map((f) => color.path(f))
        .join(', ')})`,
    );
  }
}

export function save(name: string, o: EvmConfig): void {
  ensureDir(configRoot());
  const filename = pathOf(name);
  const isJSON = path.extname(filename) === '.json';
  const txt = (isJSON ? JSON.stringify(o, null, 2) : YAML.stringify(o)) + '\n';
  fs.writeFileSync(filename, txt);
}

export function setCurrent(name: string): void {
  testConfigExists(name);
  try {
    currentFiles().forEach((filename) => fs.writeFileSync(filename, `${name}\n`));
  } catch (e) {
    fatal(`Unable to set config ${color.config(name)}: ${String(e)}`);
  }
}

export function names(): string[] {
  if (!fs.existsSync(configRoot())) return [];
  return fs
    .readdirSync(configRoot())
    .map((filename) => filenameToConfigName(filename))
    .filter((name): name is string => name !== null)
    .sort();
}

function getCurrentFileName(): string | null {
  // One-off override from `e --config=<name> ...`.
  const override = process.env['EVM_CURRENT'];
  if (override) return override;

  return currentFiles().reduce<string | null>((name, filename) => {
    try {
      // `||` (not `??`) is deliberate: an empty file — e.g. the fresh
      // mktemp file created by the documented EVM_CURRENT_FILE workflow —
      // must fall through to the next candidate.
      return name || fs.readFileSync(filename, { encoding: 'utf8' }).trim();
    } catch {
      return name;
    }
  }, null);
}

export function currentName(): string {
  // Return the contents of the first nonempty file in currentFiles.
  const name = getCurrentFileName();

  if (name) return name;
  fatal('No current build configuration.');
}

export function outDir(config: Pick<SanitizedConfig, 'root' | 'gen'>): string {
  return path.resolve(config.root, 'src', 'out', config.gen.out);
}

export function execOf(config: SanitizedConfig): string {
  const execName = (config.execName ?? 'electron').toLowerCase();
  const builddir = outDir(config);
  switch (os.type()) {
    case 'Linux':
      return path.resolve(builddir, execName);
    case 'Darwin': {
      const upperExecName = execName.charAt(0).toUpperCase() + execName.slice(1);
      return path.resolve(builddir, `${upperExecName}.app`, 'Contents', 'MacOS', upperExecName);
    }
    default:
      return path.resolve(builddir, `${execName}.exe`);
  }
}

function maybeExtendConfig(config: EvmConfig): EvmConfig {
  if (config.extends) {
    const deeperConfig = maybeExtendConfig(loadConfigFileRaw(config.extends));
    delete config.extends;
    return mergeConfigs(config, deeperConfig);
  }
  return config;
}

function loadConfigFileRaw(name: string): EvmConfig {
  const configPath = pathOf(name);

  if (!fs.existsSync(configPath)) {
    fatal(`Build config ${color.config(name)} not found.`);
  }

  const configContents = fs.readFileSync(configPath, { encoding: 'utf8' });
  return maybeExtendConfig(YAML.parse(configContents) as EvmConfig);
}

export type ValidationError = z.core.$ZodIssue;

export function validateConfig(config: EvmConfig): ValidationError[] | undefined {
  if (config.configValidationLevel === 'none') {
    return undefined;
  }

  const result = evmConfigSchema.safeParse(config);
  if (!result.success) {
    return result.error.issues;
  }
  return undefined;
}

export function setEnvVar(name: string, key: string, value: string): void {
  const config = loadConfigFileRaw(name);

  config.env ??= { CHROMIUM_BUILDTOOLS_PATH: '' };
  config.env[key] = value;

  save(name, config);
}

export function sanitizeConfig(
  name: string,
  config: EvmConfig,
  overwrite = false,
): SanitizedConfig {
  const changes: string[] = [];

  if (!config.configValidationLevel) {
    config.configValidationLevel = 'strict';
  }

  if (!('$schema' in config)) {
    config.$schema = pathToFileURL(
      path.resolve(import.meta.dirname, '..', 'evm-config.schema.json'),
    ).href;
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
  const hasRemoteExecGN = Boolean(
    config.gen?.args?.find((arg) => /^use_remoteexec ?= ?true$/.test(arg)),
  );
  const hasUseSisoGN = Boolean(config.gen?.args?.find((arg) => /^use_siso ?= ?true$/.test(arg)));

  if (!config.remoteBuild) {
    if (config.reclient) {
      config.remoteBuild = config.reclient === 'none' ? 'none' : 'siso';
      changes.push(
        `migrated unsupported ${color.config('reclient')} to ${color.config('remoteBuild')} (${config.remoteBuild})`,
      );
      delete config.reclient;
    } else {
      config.remoteBuild = 'none';
      changes.push(`added missing explicit ${color.config('remoteBuild')} property`);
    }
  } else if (config.remoteBuild === 'reclient') {
    config.remoteBuild = 'siso';
    changes.push(`migrated ${color.config('remoteBuild')} from unsupported 'reclient' to 'siso'`);
  }

  if (config.remoteBuild !== 'none' && !hasRemoteExecGN) {
    config.gen ??= { args: [], out: '' };
    config.gen.args ??= [];
    config.gen.args.push(remoteExecGnArg);
    changes.push(`added gn arg ${color.cmd(remoteExecGnArg)} needed by remoteexec`);
  } else if (config.remoteBuild === 'none' && hasRemoteExecGN && config.gen) {
    config.gen.args = config.gen.args.filter((arg) => !/^use_remoteexec ?= ?true$/.test(arg));
    changes.push(`removed gn arg ${color.cmd(remoteExecGnArg)} as remoteexec is disabled`);
  }

  if (config.remoteBuild === 'siso' && !hasUseSisoGN) {
    config.gen ??= { args: [], out: '' };
    config.gen.args ??= [];
    config.gen.args.push(useSisoGnArg);
    changes.push(
      `added gn arg ${color.cmd(useSisoGnArg)} needed by ${color.config('remoteBuild')} siso`,
    );
  } else if (config.remoteBuild !== 'siso' && hasUseSisoGN && config.gen) {
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

  config.env ??= { CHROMIUM_BUILDTOOLS_PATH: '' };

  if (!config.env.CHROMIUM_BUILDTOOLS_PATH && config.root) {
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

  return config as SanitizedConfig;
}

export function sanitizeConfigWithName(name: string, overwrite = false): SanitizedConfig {
  return sanitizeConfig(name, loadConfigFileRaw(name), overwrite);
}

export function remove(name: string): void {
  testConfigExists(name);

  let currentConfigName: string | null;
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
    fs.unlinkSync(filename);
  } catch (e) {
    fatal(`Unable to remove config ${color.config(name)}: ${String(e)}`);
  }
}

export function getDefaultTarget(): string {
  const name = getCurrentFileName();
  const result = name ? sanitizeConfigWithName(name).defaultTarget : null;
  return result ?? 'electron';
}

export function current(): SanitizedConfig {
  return sanitizeConfigWithName(currentName());
}

export function maybeCurrent(): SanitizedConfig | Record<string, never> {
  return getCurrentFileName() ? sanitizeConfigWithName(currentName()) : {};
}

export function fetchByName(name: string): SanitizedConfig {
  return sanitizeConfigWithName(name);
}
