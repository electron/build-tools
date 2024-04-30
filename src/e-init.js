#!/usr/bin/env node

const childProcess = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { program, Option } = require('commander');
const { URI } = require('vscode-uri');

const evmConfig = require('./evm-config');
const { color, fatal } = require('./utils/logging');
const { resolvePath, ensureDir } = require('./utils/paths');
const reclient = require('./utils/reclient');
const depot = require('./utils/depot-tools');
const { checkGlobalGitConfig } = require('./utils/git');
const { loadXcode } = require('./utils/load-xcode');

// https://gn.googlesource.com/gn/+/main/docs/reference.md?pli=1#var_target_cpu
const archOption = new Option(
  '--target-cpu <arch>',
  'Set the desired architecture for the build',
).choices(['x86', 'x64', 'arm', 'arm64']);

function createConfig(options) {
  const root = resolvePath(options.root);
  const homedir = os.homedir();

  // build the `gn gen` args
  const gn_args = [`import("//electron/build/args/${options.import}.gn")`];

  if (options.reclient !== 'none') {
    gn_args.push('use_remoteexec = true');
  }

  if (options.asan) gn_args.push('is_asan=true');
  if (options.lsan) gn_args.push('is_lsan=true');
  if (options.msan) gn_args.push('is_msan=true');
  if (options.tsan) gn_args.push('is_tsan=true');

  if (options.mas) {
    if (process.platform !== 'darwin') {
      fatal('macOS App Store builds are only supported on macOS');
    }
    gn_args.push('is_mas_build = true');
  }

  if (options.targetCpu) gn_args.push(`target_cpu="${options.targetCpu}"`);

  const electron = {
    origin: options.useHttps
      ? 'https://github.com/electron/electron.git'
      : 'git@github.com:electron/electron.git',
    ...(options.fork && {
      fork: options.useHttps
        ? `https://github.com/${options.fork}.git`
        : `git@github.com:${options.fork}.git`,
    }),
  };

  return {
    $schema: URI.file(path.resolve(__dirname, '..', 'evm-config.schema.json')).toString(),
    goma: 'none',
    reclient: options.reclient,
    root,
    remotes: {
      electron,
    },
    gen: {
      args: gn_args,
      out: options.out,
    },
    preserveXcode: 5,
    env: {
      CHROMIUM_BUILDTOOLS_PATH: path.resolve(root, 'src', 'buildtools'),
      GIT_CACHE_PATH: process.env.GIT_CACHE_PATH
        ? resolvePath(process.env.GIT_CACHE_PATH)
        : path.resolve(homedir, '.git_cache'),
    },
  };
}

function runGClientConfig(config) {
  const { root } = config;
  depot.ensure();
  const exec = 'gclient';
  const args = [
    'config',
    '--name',
    'src/electron',
    '--unmanaged',
    'https://github.com/electron/electron',
  ];
  const opts = {
    cwd: root,
    shell: true,
  };
  const { status } = depot.spawnSync(config, exec, args, opts);

  if (status !== 0) {
    fatal('gclient config failed');
  }
}

function ensureRoot(config, force) {
  const { root } = config;

  ensureDir(root);

  const hasOtherFiles = fs.readdirSync(root).some(file => file !== '.gclient');
  if (hasOtherFiles && !force) {
    fatal(`Root ${color.path(root)} is not empty. Please choose a different root directory.`);
  }

  if (fs.existsSync(path.resolve(root, '.gclient'))) {
    console.info(`${color.info} Root ${color.path(root)} already exists.`);
    console.info(`${color.info} (OK if you are sharing ${root} between multiple build configs)`);
  } else {
    runGClientConfig(config);
  }
}

program
  .argument('<name>')
  .description('Create a new build configuration')
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
  .option('-f, --force', 'Overwrite existing build config', false)
  .option('--asan', `When building, enable clang's address sanitizer`, false)
  .option('--tsan', `When building, enable clang's thread sanitizer`, false)
  .option('--msan', `When building, enable clang's memory sanitizer`, false)
  .option('--lsan', `When building, enable clang's leak sanitizer`, false)
  .option('--mas', 'Build for the macOS App Store', false)
  .addOption(archOption)
  .option('--bootstrap', 'Run `e sync` and `e build` after creating the build config.')
  .addOption(
    new Option(
      '--reclient <target>',
      `Use Electron's RBE backend. The "remote_exec" mode will fall back to cache-only depending on the auth provided`,
    )
      .choices(['remote_exec', 'none'])
      .default('remote_exec'),
  )
  .option(
    '--use-https',
    'During `e sync`, set remote origins with https://github... URLs instead of git@github...',
    false,
  )
  .option(
    '--fork <username/electron>',
    `Add a remote fork of Electron with the name 'fork'. This should take the format 'username/electron'`,
  )
  .action((name, options) => {
    if (options.import && !options.out) {
      // e.g. the default out dir for a testing build is 'Testing'
      options.out = options.import.charAt(0).toUpperCase() + options.import.substring(1);
    }

    try {
      // Check global git settings that need to be enabled on Windows.
      if (os.platform() === 'win32') {
        checkGlobalGitConfig();
      }

      const config = createConfig(options);

      // make sure the config name is new
      const filename = evmConfig.pathOf(name);
      if (!options.force && fs.existsSync(filename)) {
        const existing = evmConfig.fetchByName(name);
        if (existing.root !== config.root) {
          fatal(
            `Build config ${color.config(
              name,
            )} already exists and points at a different root folder! (${color.path(filename)})`,
          );
        }
      }

      // save the new config
      evmConfig.save(name, config);
      console.log(`New build config ${color.config(name)} created in ${color.path(filename)}`);

      // `e use` the new config
      const e = path.resolve(__dirname, 'e');
      const opts = { stdio: 'inherit' };
      childProcess.execFileSync(process.execPath, [e, 'use', name], opts);

      // ensure xcode is loaded
      if (process.platform === 'darwin') {
        loadXcode(true);
      }

      ensureRoot(config, !!options.force);

      // (maybe) run sync to ensure external binaries are downloaded
      if (options.bootstrap) {
        childProcess.execFileSync(process.execPath, [e, 'sync', '-v'], opts);
      }

      // maybe authenticate with RBE
      if (process.env.NODE_ENV !== 'test' && config.reclient === 'remote_exec') {
        childProcess.execFileSync(process.execPath, [e, 'd', 'rbe', 'login'], opts);
      }

      // (maybe) build Electron
      if (options.bootstrap) {
        childProcess.execFileSync(process.execPath, [e, 'build'], opts);
      }
    } catch (e) {
      fatal(e);
    }
  })
  .parse(process.argv);
