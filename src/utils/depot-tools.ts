import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as childProcess from 'node:child_process';

import { color, fatal } from './logging';
import { pathKey } from './path-key';
import * as reclient from './reclient';
import * as siso from './siso';
import type { SanitizedConfig, SpawnResult } from '../types';

const defaultDepotPath = path.resolve(__dirname, '..', '..', 'third_party', 'depot_tools');
export const DEPOT_TOOLS_DIR = process.env['DEPOT_TOOLS_DIR'] ?? defaultDepotPath;

const markerFilePath = path.join(DEPOT_TOOLS_DIR, '.disable_auto_update');

interface ConfigLike {
  env?: SanitizedConfig['env'] | undefined;
  remoteBuild?: SanitizedConfig['remoteBuild'] | undefined;
  rbeHelperPath?: string | undefined;
  rbeServiceAddress?: string | undefined;
  defaultTarget?: string | undefined;
  root?: string | undefined;
}

export interface DepotOpts extends childProcess.SpawnSyncOptions {
  env: NodeJS.ProcessEnv;
  msg?: string;
}

function updateDepotTools(): void {
  const depot_dir = DEPOT_TOOLS_DIR;
  console.log(`Updating ${color.path(depot_dir)}`);
  if (os.platform() === 'win32') {
    execFileSync({}, 'cmd.exe', ['/c', path.resolve(depot_dir, 'update_depot_tools.bat')]);
  } else {
    execFileSync({}, path.resolve(depot_dir, 'update_depot_tools'));
  }
}

export function ensure(): void {
  const depot_dir = DEPOT_TOOLS_DIR;

  // If it doesn't exist, create it.
  if (!fs.existsSync(depot_dir)) {
    console.log(`Cloning ${color.cmd('depot_tools')} into ${color.path(depot_dir)}`);
    const url = 'https://chromium.googlesource.com/chromium/tools/depot_tools.git';
    childProcess.execFileSync('git', ['clone', '-q', url, depot_dir], { stdio: 'inherit' });
    updateDepotTools();
  }

  if (fs.existsSync(markerFilePath)) {
    // NB: send updater's stdout to stderr so its log messages are visible
    // but don't pollute stdout. For example, calling `FOO="$(e show exec)"`
    // should not get a FOO that includes "Checking for build-tools updates".
    console.error(
      `${color.info} Automatic depot_tools updates disabled, skipping check for updates`,
    );
    return;
  }

  // If it's been awhile, update it.
  const now = new Date();
  const msec_per_day = 86400000;
  const days_before_pull = 14;
  const days_untouched = (now.getTime() - fs.statSync(depot_dir).mtimeMs) / msec_per_day;
  if (days_untouched >= days_before_pull) {
    updateDepotTools();
    fs.utimesSync(depot_dir, now, now);
  }
}

function platformOpts(): Record<string, string> {
  let result: Record<string, string> = {};

  const winToolchainOverride = process.env['ELECTRON_DEPOT_TOOLS_WIN_TOOLCHAIN'];
  if ((os.platform() === 'win32' && winToolchainOverride !== '0') || winToolchainOverride === '1') {
    result = {
      DEPOT_TOOLS_WIN_TOOLCHAIN: '1',
      DEPOT_TOOLS_WIN_TOOLCHAIN_BASE_URL:
        'https://dev-cdn-experimental.electronjs.org/windows-toolchains/_',
      GYP_MSVS_HASH_9ff60e43ba91947baca460d0ca3b1b980c3a2c23:
        '6d205e765a23d3cbe0fcc8d1191ae406d8bf9c04',
      GYP_MSVS_HASH_a687d8e2e4114d9015eb550e1b156af21381faac:
        'b1bdbc45421e4e0ff0584c4dbe583e93b046a411',
      GYP_MSVS_HASH_20d5f2553f: 'e146e01913',
      GYP_MSVS_HASH_3bda71a11e: 'e146e01913',
      GYP_MSVS_HASH_e41785f09f: 'e146e01913',
      GYP_MSVS_HASH_1023ce2e82: '3a908a0f94',
      GYP_MSVS_HASH_27370823e7: '28622d16b1',
      GYP_MSVS_HASH_7393122652: '3ba76c5c20',
      GYP_MSVS_HASH_698eb5635a: 'e2bf90edff',
      GYP_MSVS_HASH_e4305f407e: 'efe71370d5',
    };
  }

  return result;
}

export function opts(config: ConfigLike, options: Partial<DepotOpts> = {}): DepotOpts {
  // some defaults
  const merged: DepotOpts = {
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
    env: {} as NodeJS.ProcessEnv,
  };

  merged.env = {
    // set these defaults that can be overridden via process.env
    PYTHONDONTWRITEBYTECODE: '1', // depot needs it
    DEPOT_TOOLS_METRICS: '0', // disable depot metrics
    ...process.env,
    ...platformOpts(),
    ...config.env,
    ...options.env,
    ...(reclient.env(config as SanitizedConfig) as Record<string, string>),
    ...siso.env(config as SanitizedConfig),
  };

  // put depot tools at the front of the path
  const key = pathKey();
  const paths = [DEPOT_TOOLS_DIR];

  // Remove any duplicates on path so that DEPOT_TOOLS_DIR isn't added if it is already there
  const currentPath = (process.env[key] ?? '').split(path.delimiter);
  merged.env[key] = Array.from(new Set([...paths, ...currentPath])).join(path.delimiter);

  return merged;
}

export function spawnSync(
  config: ConfigLike,
  cmd: string,
  args: string[],
  opts_in: Partial<DepotOpts>,
  fatalMessage?: string,
): childProcess.SpawnSyncReturns<string> {
  const mergedOpts = opts(config, opts_in);
  let execCmd = cmd;
  if (os.platform() === 'win32' && ['python', 'python3'].includes(cmd)) {
    execCmd = `${cmd}.bat`;
  }
  if (!process.env['ELECTRON_DEPOT_TOOLS_DISABLE_LOG']) {
    if (opts_in.msg) {
      console.log(opts_in.msg);
    } else {
      console.log(color.childExec(execCmd, args, mergedOpts));
    }
  }
  const result = childProcess.spawnSync(
    execCmd,
    args,
    mergedOpts,
  ) as childProcess.SpawnSyncReturns<string>;
  if (fatalMessage !== undefined && result.status !== 0) {
    fatal(fatalMessage);
  }

  return result;
}

export function spawn(
  config: ConfigLike,
  cmd: string,
  args: string[],
  opts_in: Partial<DepotOpts>,
  fatalMessage?: string,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const mergedOpts = opts(config, opts_in);
    let execCmd = cmd;
    if (os.platform() === 'win32' && ['python', 'python3'].includes(cmd)) {
      execCmd = `${cmd}.bat`;
    }
    if (!process.env['ELECTRON_DEPOT_TOOLS_DISABLE_LOG']) {
      if (opts_in.msg) {
        console.log(opts_in.msg);
      } else {
        console.log(color.childExec(execCmd, args, mergedOpts));
      }
    }

    const child = childProcess.spawn(execCmd, args, mergedOpts);
    let stdout = '';
    let stderr = '';

    // Collect stdout and stderr if not inheriting stdio
    if (mergedOpts.stdio !== 'inherit') {
      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      }
    }

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code, signal) => {
      const result: SpawnResult = {
        status: code,
        signal,
        stdout: mergedOpts.stdio === 'inherit' ? null : stdout,
        stderr: mergedOpts.stdio === 'inherit' ? null : stderr,
        pid: child.pid,
        output: mergedOpts.stdio === 'inherit' ? null : [null, stdout, stderr],
      };

      if (fatalMessage !== undefined && result.status !== 0) {
        fatal(fatalMessage);
      }

      resolve(result);
    });
  });
}

export function execFileSync(
  config: ConfigLike,
  exec: string,
  args: string[] = [],
  opts_in?: Partial<DepotOpts>,
): Buffer | string {
  const mergedOpts = opts(config, opts_in);
  let execCmd = exec;
  const execArgs = [...args];
  if (
    ['python', 'python3'].includes(exec) &&
    !mergedOpts.cwd &&
    execArgs[0] &&
    !path.isAbsolute(execArgs[0])
  ) {
    execArgs[0] = path.resolve(DEPOT_TOOLS_DIR, execArgs[0]);
  }
  if (os.platform() === 'win32' && ['python', 'python3'].includes(exec)) {
    execCmd = `${exec}.bat`;
  }
  console.log(color.childExec(execCmd, execArgs, mergedOpts));
  return childProcess.execFileSync(execCmd, execArgs, mergedOpts);
}

export function setAutoUpdate(enable: boolean): void {
  try {
    if (enable) {
      if (fs.existsSync(markerFilePath)) {
        fs.unlinkSync(markerFilePath);
      }
      console.info(`${color.info} Automatic depot_tools updates enabled`);
    } else {
      fs.closeSync(fs.openSync(markerFilePath, 'w'));
      console.info(`${color.info} Automatic depot_tools updates disabled`);
    }
  } catch (e) {
    fatal(e);
  }
}

export { DEPOT_TOOLS_DIR as path };
