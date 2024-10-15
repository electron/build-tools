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
const { ensureSDK, ensureSDKAndSymlink } = require('./utils/sdk');

function getGNArgs(config) {
  const configArgs = config.gen.args;

  if (process.platform === 'darwin') {
    configArgs.push(`mac_sdk_path = "${ensureSDKAndSymlink(config)}"`);
  }

  // GN_EXTRA_ARGS is a list of GN args to append to the default args.
  const { GN_EXTRA_ARGS } = process.env;
  if (process.env.CI && GN_EXTRA_ARGS) {
    const envArgs = GN_EXTRA_ARGS.split(' ').map((s) => s.trim());
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

function runNinja(config, target, ninjaArgs) {
  if (reclient.usingRemote && config.reclient !== 'none') {
    reclient.auth(config);

    // Autoninja sets this absurdly high, we take it down a notch
    if (!ninjaArgs.includes('-j') && !ninjaArgs.find((arg) => /^-j[0-9]+$/.test(arg.trim()))) {
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
  if (!reclient.usingRemote && config.reclient !== 'none') {
    opts.env = { RBE_remote_disabled: true };
  }
  depot.execFileSync(config, exec, args, opts);
}

program
  .arguments('[ninjaArgs...]')
  .description('Build Electron and other targets.')
  .option('--only-gen', 'Only run `gn gen`', false)
  .option('-t|--target [target]', 'Build a specific ninja target')
  .option('--no-remote', 'Build without remote execution (entirely locally)')
  .allowUnknownOption()
  .action((ninjaArgs, options) => {
    try {
      const config = evmConfig.current();

      reclient.usingRemote = options.remote;

      reclient.downloadAndPrepare(config);

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
      fatal(e);
    }
  })
  .parse(process.argv);
