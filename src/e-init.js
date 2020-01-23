#!/usr/bin/env node

const childProcess = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { color, fatal } = require('./utils/logging');
const { resolvePath, ensureDir } = require('./utils/paths');
const goma = require('./utils/goma');
const sccache = require('./utils/sccache');
const depot = require('./utils/depot-tools');

function getVSReleaseLine() {
  const exec = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  const args = ['-latest', '-property', 'catalog_productLineVersion'];
  const opts = { encoding: 'utf8' };
  return childProcess.execFileSync(exec, args, opts).trim();
}

function createConfig(options) {
  const root = resolvePath(options.root);
  const homedir = os.homedir();

  // build the `gn gen` args
  const gn_args = [`import("//electron/build/args/${options.import}.gn")`];

  if (options.useGoma) {
    if (goma.exists(root)) {
      gn_args.push('import("//electron/build/args/goma.gn")');
    }
  } else {
    gn_args.push(`cc_wrapper="${sccache.exec(root)}"`);
  }

  if (options.asan) gn_args.push('is_asan=true');
  if (options.lsan) gn_args.push('is_lsan=true');
  if (options.msan) gn_args.push('is_msan=true');
  if (options.tsan) gn_args.push('is_tsan=true');

  // os-specific environment variables
  const platform_env = {};
  if (os.platform() === 'win32') {
    platform_env.DEPOT_TOOLS_WIN_TOOLCHAIN = '0';
    platform_env.GYP_MSVS_VERSION = getVSReleaseLine();
  }

  // sccache-specific environment variables
  const sccacheEnv = {
    SCCACHE_BUCKET: process.env.SCCACHE_BUCKET || 'electronjs-sccache-ci',
    SCCACHE_CACHE_SIZE: process.env.SCCACHE_CACHE_SIZE || '20G',
    SCCACHE_DIR: process.env.SCCACHE_DIR
      ? resolvePath(process.env.SCCACHE_DIR)
      : path.resolve(homedir, '.sccache'),
    SCCACHE_TWO_TIER: process.env.SCCACHE_TWO_TIER || 'true',
  };

  return {
    goma: options.useGoma,
    root,
    origin: {
      electron: options.useHttps
        ? 'https://github.com/electron/electron.git'
        : 'git@github.com:electron/electron.git',
      node: options.useHttps
        ? 'https://github.com/electron/node.git'
        : 'git@github.com:electron/node.git',
    },
    gen: {
      args: gn_args,
      out: options.out,
    },
    env: {
      CHROMIUM_BUILDTOOLS_PATH: path.resolve(root, 'src', 'buildtools'),
      GIT_CACHE_PATH: process.env.GIT_CACHE_PATH
        ? resolvePath(process.env.GIT_CACHE_PATH)
        : path.resolve(homedir, '.git_cache'),
      ...platform_env,
      ...(!options.useGoma && sccacheEnv),
    },
  };
}

function runGClientConfig(config) {
  const { root } = config;
  depot.ensure();
  const exec = 'python';
  const args = [
    'gclient.py',
    'config',
    '--name',
    'src/electron',
    '--unmanaged',
    'https://github.com/electron/electron',
  ];
  const opts = {
    cwd: root,
  };
  depot.execFileSync(config, exec, args, opts);
}

function ensureRoot(config) {
  const { root } = config;

  if (!fs.existsSync(root)) {
    ensureDir(root);
    runGClientConfig(config);
  } else if (fs.existsSync(path.resolve(root, '.gclient'))) {
    console.info(`${color.info} Root ${color.path(root)} already exists.`);
    console.info(`${color.info} (OK if you are sharing $root between multiple build configs)`);
  } else if (fs.readdirSync(root).length > 0) {
    throw Error(
      `Root ${color.path(root)} exists and is not empty. Please choose a different root directory.`,
    );
  }
}

let name;
let options;

program
  .arguments('<name>')
  .description('Create a new build configuration')
  .action((name_in, options_in) => {
    name = name_in;
    options = options_in;
  })
  .option(
    '-r, --root <path>',
    'Source and build files will be stored in this new directory',
    path.resolve(process.cwd(), 'electron'),
  )
  .option(
    '-i, --import <name>',
    'Import build settings from $root/src/electron/build/args/$import.gn',
    'testing',
  )
  .option('-o, --out <name>', 'Built files will be placed in $root/src/out/$out')
  .option('-f, --force', 'Overwrite existing build config with that name', false)
  .option('--asan', `When building, enable clang's address sanitizer`, false)
  .option('--tsan', `When building, enable clang's thread sanitizer`, false)
  .option('--msan', `When building, enable clang's memory sanitizer`, false)
  .option('--lsan', `When building, enable clang's leak sanitizer`, false)
  .option('--bootstrap', 'Run `e sync` and `e build` after creating the build config.')
  .option(
    '--use-goma',
    `Use Electron's custom deployment of Goma (only available to maintainers).`,
    false,
  )
  .option(
    '--use-https',
    'During `e sync`, set remote origins with https://github... URLs instead of git@github...',
    false,
  )
  .parse(process.argv);

if (!name) {
  program.outputHelp();
  process.exit(1);
}

if (options.import && !options.out) {
  // e.g. the default out dir for a testing build is 'Testing'
  options.out = options.import.charAt(0).toUpperCase() + options.import.substring(1);
}

try {
  // make sure the config name is new
  const filename = evmConfig.pathOf(name);
  if (!options.force && fs.existsSync(filename)) {
    throw Error(`Build config ${color.config(name)} already exists! (${color.path(filename)})`);
  }

  // save the new config
  const config = createConfig(options);
  ensureRoot(config);
  evmConfig.save(name, config);
  console.log(`New build config ${color.config(name)} created in ${color.path(filename)}`);

  // `e use` the new config
  const e = path.resolve(__dirname, 'e');
  const opts = { stdio: 'inherit' };
  childProcess.execFileSync('node', [e, 'use', name], opts);

  // (maybe) run sync to ensure external binaries are downloaded
  if (program.bootstrap) {
    childProcess.execFileSync('node', [e, 'sync', '-v'], opts);
  }

  // maybe authenticate with Goma
  if (config.goma) goma.auth(config.root);

  // (maybe) build Electron
  if (program.bootstrap) {
    childProcess.execFileSync('node', [e, 'build'], opts);
  }
} catch (e) {
  fatal(e);
}
