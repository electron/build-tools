#!/usr/bin/env node

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { program } from 'commander';

import * as evmConfig from './evm-config.js';
import { color, fatal } from './utils/logging.js';
import * as depot from './utils/depot-tools.js';
import { ensureDir } from './utils/paths.js';
import * as reclient from './utils/reclient.js';
import * as siso from './utils/siso.js';
import { ensureSDK, ensureSDKAndSymlink } from './utils/sdk.js';
import type { SanitizedConfig } from './types.js';

function getGNArgs(config: SanitizedConfig): string {
  const configArgs = config.gen.args;

  if (process.platform === 'darwin') {
    const sdkArg = `mac_sdk_path = "${ensureSDKAndSymlink(config)}"`;
    if (!configArgs.includes(sdkArg)) {
      configArgs.push(sdkArg);
    }
  }

  // GN_EXTRA_ARGS is a list of GN args to append to the default args.
  const extra = process.env['GN_EXTRA_ARGS'];
  if (process.env['CI'] && extra) {
    const envArgs = extra.split(' ').map((s) => s.trim());
    return [...configArgs, ...envArgs].join(os.EOL);
  }

  return configArgs.join(os.EOL);
}

async function runGNGen(config: SanitizedConfig): Promise<void> {
  depot.ensure();
  const gnBasename = os.platform() === 'win32' ? 'gn.bat' : 'gn';
  const gnPath = path.resolve(depot.DEPOT_TOOLS_DIR, gnBasename);
  const gnArgs = getGNArgs(config);
  const argsFile = path.resolve(evmConfig.outDir(config), 'args.gn');
  ensureDir(evmConfig.outDir(config));
  fs.writeFileSync(argsFile, gnArgs, { encoding: 'utf8' });
  const execArgs = ['gen', `out/${config.gen.out}`];
  const execOpts = { cwd: path.resolve(config.root, 'src') };
  await depot.spawn(config, gnPath, execArgs, execOpts);
}

type GenMode = 'skip' | 'include' | 'only';

async function ensureGNGen(config: SanitizedConfig, genMode: GenMode): Promise<void> {
  const buildfile = path.resolve(evmConfig.outDir(config), 'build.ninja');

  if (genMode === 'only') {
    return runGNGen(config);
  }

  if (genMode === 'skip') {
    if (!fs.existsSync(buildfile)) {
      fatal(
        `Cannot skip \`gn gen\` because ${color.path(buildfile)} does not exist. Run ${color.cmd(
          'e build',
        )} with ${color.cmd('--gen include')} or ${color.cmd('--gen only')} first.`,
      );
    }
    console.info(`${color.info} Reusing existing generated build files in ${color.path(buildfile)}`);
    return;
  }

  if (!fs.existsSync(buildfile)) return runGNGen(config);
  const argsFile = path.resolve(evmConfig.outDir(config), 'args.gn');
  if (!fs.existsSync(argsFile)) return runGNGen(config);
  const contents = fs.readFileSync(argsFile, 'utf8');
  // If the current args do not match the args file, re-run gen
  if (contents.trim() !== getGNArgs(config)) {
    return runGNGen(config);
  }
}

async function runNinja(
  config: SanitizedConfig,
  target: string,
  ninjaArgs: string[],
  genMode: GenMode,
): Promise<number> {
  if (reclient.usingRemote && config.remoteBuild !== 'none') {
    const hasExecute = reclient.auth(config);

    // Autoninja sets this absurdly high, we take it down a notch
    if (
      !ninjaArgs.includes('-j') &&
      !ninjaArgs.find((arg) => /^-j[0-9]+$/.test(arg.trim())) &&
      config.remoteBuild === 'reclient'
    ) {
      ninjaArgs.push('-j', '200');
    }

    if (config.remoteBuild === 'siso') {
      ninjaArgs.push(...siso.flags(config, hasExecute).map(String));
    }
  } else {
    console.info(`${color.info} Building ${target} with remote execution disabled`);
  }

  depot.ensure();
  await ensureGNGen(config, genMode);

  // Using remoteexec means that we need autoninja so that reproxy is started + stopped
  // correctly
  const ninjaName = config.reclient !== 'none' ? 'autoninja' : 'ninja';

  const exec = os.platform() === 'win32' ? `${ninjaName}.bat` : ninjaName;
  const args = [...ninjaArgs, target];
  const opts: Partial<depot.DepotOpts> = {
    cwd: evmConfig.outDir(config),
  };
  if (!reclient.usingRemote && config.reclient !== 'none') {
    opts.env = { RBE_remote_disabled: 'true' };
  }
  const result = await depot.spawn(config, exec, args, opts);
  return result.status ?? 1;
}

interface BuildOptions {
  gen: GenMode;
  onlyGen: boolean;
  skipGnGen: boolean;
  target?: string;
  remote: boolean;
}

program
  .arguments('[ninjaArgs...]')
  .description('Build Electron and other targets.')
  .option('--gen <mode>', 'Control when to run `gn gen`: include (default), skip, or only', 'include')
  .option('--only-gen', 'Alias for `--gen only`', false)
  .option('--skip-gn-gen', 'Alias for `--gen skip`', false)
  .option('-t|--target [target]', 'Build a specific ninja target')
  .option('--no-remote', 'Build without remote execution (entirely locally)')
  .allowUnknownOption()
  .action(async (ninjaArgs: string[], options: BuildOptions) => {
    try {
      const config = evmConfig.current();

      reclient.setUsingRemote(options.remote);

      const winToolchainOverride = process.env['ELECTRON_DEPOT_TOOLS_WIN_TOOLCHAIN'];
      if (os.platform() === 'win32' && winToolchainOverride === '0') {
        config.reclient = 'none';
        reclient.setUsingRemote(false);
        console.warn(
          `${color.warn} Build without remote execution when defined ${color.config('ELECTRON_DEPOT_TOOLS_WIN_TOOLCHAIN=0')} in environment variables.`,
        );
      }

      reclient.downloadAndPrepareRBECredentialHelper(config);
      await siso.ensureBackendStarlark(config);

      if (process.platform === 'darwin') {
        ensureSDK();
      }

      const genMode = (() => {
        const fromOption = options.gen as GenMode;
        if (!['skip', 'include', 'only'].includes(fromOption)) {
          fatal(
            `Invalid value for ${color.cmd('--gen')}: ${fromOption}. Expected one of skip, include, or only.`,
          );
        }

        if (options.onlyGen && fromOption === 'skip') {
          fatal(`Cannot combine ${color.cmd('--only-gen')} with ${color.cmd('--gen skip')}`);
        }
        if (options.skipGnGen && fromOption === 'only') {
          fatal(`Cannot combine ${color.cmd('--skip-gn-gen')} with ${color.cmd('--gen only')}`);
        }

        if (options.onlyGen) return 'only';
        if (options.skipGnGen) return 'skip';
        return fromOption;
      })();

      if (genMode === 'only') {
        await runGNGen(config);
        return;
      }

      const buildTarget = options.target ?? evmConfig.getDefaultTarget();
      const exitCode = await runNinja(config, buildTarget, ninjaArgs, genMode);
      process.exit(exitCode);
    } catch (e) {
      fatal(e);
    }
  })
  .parse(process.argv);
