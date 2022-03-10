#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { color, fatal } = require('./utils/logging');
const depot = require('./utils/depot-tools');
const goma = require('./utils/goma');

function runGNGen(config) {
  depot.ensure();
  const gnBasename = os.platform() === 'win32' ? 'gn.bat' : 'gn';
  const gnPath = path.resolve(depot.path, gnBasename);
  const gnArgs = config.gen.args.join(' ');
  const execArgs = ['gen', `out/${config.gen.out}`, `--args=${gnArgs}`];
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
  if (contents.trim() !== config.gen.args.join(process.platform === 'win32' ? '\r\n' : '\n').trim())
    return runGNGen(config);
}

function runNinja(config, target, useGoma, ninjaArgs) {
  if (useGoma && config.goma !== 'none') {
    goma.downloadAndPrepare(config);

    if (config.goma === 'cluster') {
      const authenticated = goma.isAuthenticated(config.root);
      if (!authenticated) {
        console.log('Not Authenticated - Triggering Goma Login');
        const { status, error } = depot.spawnSync(
          evmConfig.current(),
          'python',
          ['goma_auth.py', 'login'],
          {
            cwd: goma.dir,
            stdio: 'inherit',
            env: {
              ...process.env,
              AGREE_NOTGOMA_TOS: '1',
            },
          },
        );

        if (status !== 0) {
          console.error(
            `${color.err} Failed to run command, exit code was "${status}", error was '${error}'`,
          );
          process.exit(status);
        }

        goma.recordGomaLoginTime();
      }
    }

    goma.ensure(config);
    if (!ninjaArgs.includes('-j') && !ninjaArgs.find(arg => /^-j[0-9]+$/.test(arg.trim()))) {
      ninjaArgs.push('-j', 200);
    }
  } else {
    console.info(`${color.info} Building ${target} with Goma disabled`);
  }

  depot.ensure(config);
  ensureGNGen(config);

  const exec = os.platform() === 'win32' ? 'ninja.exe' : 'ninja';
  const args = [...ninjaArgs, target];
  const opts = {
    cwd: evmConfig.outDir(config),
    ...(useGoma ? {} : { env: { GOMA_DISABLED: true } }),
  };
  depot.execFileSync(config, exec, args, opts);
}

program
  .allowUnknownOption()
  .arguments('[target] [ninjaArgs...]')
  .description('Build Electron and other targets.')
  .option('--list-targets', 'Show all supported build targets', false)
  .option('--gen', 'Force a re-run of `gn gen` before building', false)
  .option('-t|--target [target]', 'Forces a specific ninja target')
  .option('--no-goma', 'Build without goma', false)
  .parse(process.argv);

try {
  const config = evmConfig.current();
  const targets = evmConfig.buildTargets;

  if (program.listTargets) {
    Object.keys(targets)
      .sort()
      .forEach(target => console.log(`${target} --> ${color.config(targets[target])}`));
    return;
  }

  // Only ensure Xcode version if we're building an Electron target.
  const isChromium = program.target
    ? program.target === targets.chromium
    : targets.default === targets.chromium;
  if (process.platform === 'darwin' && !isChromium) {
    const result = depot.spawnSync(
      config,
      process.execPath,
      [path.resolve(__dirname, 'e-load-xcode.js'), '--quiet'],
      {
        stdio: 'inherit',
        msg: `Running ${color.cmd('e load-xcode --quiet')}`,
      },
    );
    if (result.status !== 0) process.exit(result.status);
  }

  if (program.gen) {
    runGNGen(config);
  }

  // collect all the unrecognized args that aren't a target
  const pretty = Object.keys(targets).find(p => program.rawArgs.includes(p)) || 'default';
  const { unknown: args } = program.parseOptions(process.argv);
  const index = args.indexOf(pretty);
  if (index != -1) {
    args.splice(index, 1);
  }

  runNinja(config, program.target || targets[pretty], program.goma, args);
} catch (e) {
  fatal(e);
}
