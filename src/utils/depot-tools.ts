import childProcess, { ExecFileSyncOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { EVMBaseElectronConfiguration } from '../evm-config.schema.js';
import { color, fatal } from './logging.js';
import { reclientEnv } from './reclient.js';
import { sisoEnv } from './siso.js';

const defaultDepotPath = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'third_party',
  'depot_tools',
);
const DEPOT_TOOLS_DIR = process.env.DEPOT_TOOLS_DIR || defaultDepotPath;

const markerFilePath = path.join(DEPOT_TOOLS_DIR, '.disable_auto_update');

function updateDepotTools(): void {
  const depot_dir = DEPOT_TOOLS_DIR;
  console.log(`Updating ${color.path(depot_dir)}`);
  if (os.platform() === 'win32') {
    depotExecFileSync(null, 'cmd.exe', ['/c', path.resolve(depot_dir, 'update_depot_tools.bat')]);
  } else {
    depotExecFileSync(null, path.resolve(depot_dir, 'update_depot_tools'));
  }
}

export function ensureDepotTools(): void {
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

function platformOpts() {
  let opts = {};

  const winToolchainOverride = process.env.ELECTRON_DEPOT_TOOLS_WIN_TOOLCHAIN;
  if ((os.platform() === 'win32' && winToolchainOverride !== '0') || winToolchainOverride === '1') {
    opts = {
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
    };
  }

  return opts;
}

export function depotOpts(
  config: EVMBaseElectronConfiguration | null,
  opts: ExecFileSyncOptions = {},
): ExecFileSyncOptions {
  // some defaults
  opts = {
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  };

  opts.env = {
    // set these defaults that can be overridden via process.env
    PYTHONDONTWRITEBYTECODE: '1', // depot needs it
    DEPOT_TOOLS_METRICS: '0', // disable depot metrics
    // Circular reference so we have to delay load
    ...process.env,
    ...platformOpts(),
    ...config?.env,
    ...opts.env,
    // Circular reference so we have to delay load
    ...reclientEnv(config),
    ...sisoEnv(config),
  };

  // put depot tools at the front of the path
  const paths = [DEPOT_TOOLS_DIR];

  // Remove any duplicates on path so that DEPOT_TOOLS_DIR isn't added if it is already there
  const currentPath = process.env.PATH?.split(path.delimiter) || [];
  opts.env!.PATH = Array.from(new Set([...paths, ...currentPath])).join(path.delimiter);

  return opts;
}

export function depotSpawnSync(
  config: EVMBaseElectronConfiguration | null,
  cmd: string,
  args: string[],
  opts_in: ExecFileSyncOptions & { msg?: string },
  fatalMessage?: string,
) {
  const opts = depotOpts(config, opts_in);
  if (os.platform() === 'win32' && ['python', 'python3'].includes(cmd)) {
    cmd = `${cmd}.bat`;
  }
  if (!process.env.ELECTRON_DEPOT_TOOLS_DISABLE_LOG) {
    if (opts_in.msg) {
      console.log(opts_in.msg);
    } else {
      console.log(color.childExec(cmd, args, opts));
    }
  }
  const result = childProcess.spawnSync(cmd, args, opts);
  if (fatalMessage !== undefined && result.status !== 0) {
    fatal(fatalMessage);
  }

  return result;
}

export function depotExecFileSync(
  config: EVMBaseElectronConfiguration | null,
  exec: string,
  args: string[] = [],
  opts_in?: ExecFileSyncOptions,
) {
  const opts = depotOpts(config, opts_in);
  if (['python', 'python3'].includes(exec) && !opts.cwd && !path.isAbsolute(args[0])) {
    args[0] = path.resolve(DEPOT_TOOLS_DIR, args[0]);
  }
  if (os.platform() === 'win32' && ['python', 'python3'].includes(exec)) {
    exec = `${exec}.bat`;
  }
  console.log(color.childExec(exec, args, opts));
  return childProcess.execFileSync(exec, args, opts);
}

export function setDepotToolsAutoUpdate(enable: boolean) {
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
    fatal(`${e}`);
  }
}

export const depotPath = DEPOT_TOOLS_DIR;
