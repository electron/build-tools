#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { color, fatal } = require('./utils/logging');
const depot = require('./utils/depot-tools');
const { ensureDir } = require('./utils/paths');
const reclient = require('./utils/reclient');
const { loadXcode } = require('./utils/load-xcode');
const { ensureSDK } = require('./utils/sdk');

function getGNArgs(config) {
  const configArgs = config.gen.args;

  // GN_EXTRA_ARGS is a list of GN args to append to the default args.
  const { GN_EXTRA_ARGS } = process.env;
  if (process.env.CI && GN_EXTRA_ARGS) {
    const envArgs = GN_EXTRA_ARGS.split(' ').map(s => s.trim());
    return [...configArgs, ...envArgs].join(os.EOL);
  }

  return configArgs.join(os.EOL);
}

function runGNGen(config) {
  depot.ensure();
  const gnBasename = os.platform() === 'win32' ? 'gn.bat' : 'gn';
  const gnPath = path.resolve(depot.path, gnBasename);
  const gnArgs = getGNArgs(config);
  const argsFile = path.resolve(evmConfig.outDir(config), 'args.gn');
  ensureDir(evmConfig.outDir(config));
  fs.writeFileSync(argsFile, gnArgs, { encoding: 'utf8' });
  const execArgs = ['gen', `out/${config.gen.out}`];
  const execOpts = { cwd: path.resolve(config.root, 'src') };
  depot.execFileSync(config, gnPath, execArgs, execOpts);
}

function ensureGNGen(config) {
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

function runNinja(config, target, useRemote, ninjaArgs) {
  if (useRemote && config.reclient !== 'none') {
    reclient.downloadAndPrepare(config);
    reclient.auth(config);

    // Autoninja sets this absurdly high, we take it down a notch
    if (!ninjaArgs.includes('-j') && !ninjaArgs.find(arg => /^-j[0-9]+$/.test(arg.trim()))) {
      ninjaArgs.push('-j', 200);
    }
  } else {
    console.info(`${color.info} Building ${target} with remote execution disabled`);
  }

  depot.ensure(config);
  ensureGNGen(config);

  // Using remoteexec means that we need autoninja so that reproxy is started + stopped
  // correctly
  const ninjaName = config.reclient !== 'none' ? 'autoninja' : 'ninja';

  const exec = os.platform() === 'win32' ? `${ninjaName}.bat` : ninjaName;
  const args = [...ninjaArgs, target];
  const opts = {
    cwd: evmConfig.outDir(config),
  };
  if (!useRemote && config.reclient !== 'none') {
    opts.env = { RBE_remote_disabled: true };
  }
  depot.execFileSync(config, exec, args, opts);
}

program
  .arguments('[target] [ninjaArgs...]')
  .description('Build Electron and other targets.')
  .option('--list-targets', 'Show all supported build targets', false)
  .option('--gen', 'Force a re-run of `gn gen` before building', false)
  .option('-t|--target [target]', 'Forces a specific ninja target')
  .option('--no-remote', 'Build without remote execution (entirely locally)')
  .option(
    '--use-sdk',
    'Use macOS SDKs instead of downloading full XCode versions when necessary',
    false,
  )
  .allowUnknownOption()
  .action((target, ninjaArgs, options) => {
    try {
      const config = evmConfig.current();
      const targets = evmConfig.buildTargets();

      if (options.listTargets) {
        Object.keys(targets)
          .sort()
          .forEach(target => console.log(`${target} --> ${color.config(targets[target])}`));
        return;
      }

      if (process.platform === 'darwin') {
        if (process.env.CI || options.useSdk) {
          ensureSDK();
        } else {
          loadXcode({ target, quiet: true });
        }
      }

      if (options.gen) {
        runGNGen(config);
      }

      if (options.target) {
        // User forced a target, so any arguments are ninjaArgs
        if (target) {
          ninjaArgs.unshift(target);
        }
        target = options.target;
      } else if (Object.keys(targets).includes(target)) {
        target = targets[target];
      } else {
        // No forced target and no target matched, so use the
        // default target and assume any arguments are ninjaArgs
        if (target) {
          ninjaArgs.unshift(target);
        }
        target = targets['default'];
      }

      try {
        runNinja(config, target, options.remote, ninjaArgs);
      } catch (ex) {
        if (target === targets['node:headers']) {
          // Older versions of electron use a different target for node headers so try that if the new one fails.
          const olderTarget = 'third_party/electron_node:headers';
          console.info(
            `${color.info} Error building ${target}; trying older ${olderTarget} target`,
          );
          runNinja(config, olderTarget, options.remote, ninjaArgs);
        } else {
          throw ex;
        }
      }
    } catch (e) {
      fatal(e);
    }
  })
  .parse(process.argv);
