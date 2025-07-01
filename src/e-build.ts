#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { program } from 'commander';

import * as evmConfig from './evm-config.js';
import { color, fatal } from './utils/logging.js';
import { depotExecFileSync, depotPath, ensureDepotTools } from './utils/depot-tools.js';
import { downloadAndPrepareRBECredentialHelper, ensureHelperAuth } from './utils/reclient.js';
import { ensureBackendStarlark, sisoFlags } from './utils/siso.js';
import { ensureSDK, ensureSDKAndSymlink } from './utils/sdk.js';
import { EVMBaseElectronConfiguration } from './evm-config.schema.js';
import { ensureDir } from './utils/paths.js';
import { ExecFileSyncOptions } from 'node:child_process';

function getGNArgs(config: EVMBaseElectronConfiguration): string {
  const configArgs = config.gen.args;

  if (process.platform === 'darwin') {
    const sdkArg = `mac_sdk_path = "${ensureSDKAndSymlink(config)}"`;
    if (!configArgs.includes(sdkArg)) {
      configArgs.push(sdkArg);
    }
  }

  // GN_EXTRA_ARGS is a list of GN args to append to the default args.
  const { GN_EXTRA_ARGS } = process.env;
  if (process.env.CI && GN_EXTRA_ARGS) {
    const envArgs = GN_EXTRA_ARGS.split(' ').map((s) => s.trim());
    return [...configArgs, ...envArgs].join(os.EOL);
  }

  return configArgs.join(os.EOL);
}

function runGNGen(config: EVMBaseElectronConfiguration): void {
  ensureDepotTools();
  const gnBasename = os.platform() === 'win32' ? 'gn.bat' : 'gn';
  const gnPath = path.resolve(depotPath, gnBasename);
  const gnArgs = getGNArgs(config);
  const argsFile = path.resolve(evmConfig.outDir(config), 'args.gn');
  ensureDir(evmConfig.outDir(config));
  fs.writeFileSync(argsFile, gnArgs, { encoding: 'utf8' });
  const execArgs = ['gen', `out/${config.gen.out}`];
  const execOpts = { cwd: path.resolve(config.root, 'src') };
  depotExecFileSync(config, gnPath, execArgs, execOpts);
}

function ensureGNGen(config: EVMBaseElectronConfiguration): void {
  const buildfile = path.resolve(evmConfig.outDir(config), 'build.ninja');
  if (!fs.existsSync(buildfile)) return runGNGen(config);
  const argsFile = path.resolve(evmConfig.outDir(config), 'args.gn');
  if (!fs.existsSync(argsFile)) return runGNGen(config);
  const contents = fs.readFileSync(argsFile, 'utf8');
  // If the current args do not match the args file, re-run gen
  if (contents.trim() !== getGNArgs(config)) {
    return runGNGen(config);
  }
}

function runNinja(config: EVMBaseElectronConfiguration, target: string, ninjaArgs: string[]) {
  if (config.remoteBuild !== 'none') {
    ensureHelperAuth(config);

    // Autoninja sets this absurdly high, we take it down a notch
    if (
      !ninjaArgs.includes('-j') &&
      !ninjaArgs.find((arg) => /^-j[0-9]+$/.test(arg.trim())) &&
      config.remoteBuild === 'reclient'
    ) {
      ninjaArgs.push('-j', '200');
    }

    if (config.remoteBuild === 'siso') {
      ninjaArgs.push(...sisoFlags(config));
    }
  } else {
    console.info(`${color.info} Building ${target} with remote execution disabled`);
  }

  ensureDepotTools();
  ensureGNGen(config);

  // Using remoteexec means that we need autoninja so that reproxy is started + stopped
  // correctly
  const ninjaName = config.remoteBuild !== 'none' ? 'autoninja' : 'ninja';

  const exec = os.platform() === 'win32' ? `${ninjaName}.bat` : ninjaName;
  const args = [...ninjaArgs, target];
  const opts: ExecFileSyncOptions = {
    cwd: evmConfig.outDir(config),
  };
  if (config.remoteBuild !== 'none') {
    opts.env = { RBE_remote_disabled: 'true' };
  }
  depotExecFileSync(config, exec, args, opts);
}

program
  .arguments('[ninjaArgs...]')
  .description('Build Electron and other targets.')
  .option('--only-gen', 'Only run `gn gen`', false)
  .option('-t|--target [target]', 'Build a specific ninja target')
  .option('--no-remote', 'Build without remote execution (entirely locally)')
  .allowUnknownOption()
  .action(async (ninjaArgs, options) => {
    try {
      const config = evmConfig.current();

      if (!options.remote) {
        // If --no-remote is set, we disable remote execution
        config.remoteBuild = 'none';
      }

      const winToolchainOverride = process.env.ELECTRON_DEPOT_TOOLS_WIN_TOOLCHAIN;
      if (os.platform() === 'win32' && winToolchainOverride === '0') {
        config.remoteBuild = 'none';
        console.warn(
          `${color.warn} Build without remote execution when defined ${color.config('ELECTRON_DEPOT_TOOLS_WIN_TOOLCHAIN=0')} in environment variables.`,
        );
      }

      downloadAndPrepareRBECredentialHelper(config);
      await ensureBackendStarlark(config);

      if (process.platform === 'darwin') {
        ensureSDK();
      }

      if (options.onlyGen) {
        runGNGen(config);
        return;
      }

      const buildTarget = options.target || evmConfig.getDefaultTarget();
      runNinja(config, buildTarget, ninjaArgs);
    } catch (e) {
      fatal(e as Error);
    }
  })
  .parse(process.argv);
