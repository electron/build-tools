#!/usr/bin/env node

import childProcess from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { program, Option } from 'commander';
import vscode from 'vscode-uri';

import * as evmConfig from './evm-config.js';
import { color, fatal } from './utils/logging.js';
import { resolvePath, ensureDir } from './utils/paths.js';
import { depotSpawnSync, ensureDepotTools } from './utils/depot-tools.js';
import { checkGlobalGitConfig } from './utils/git.js';
import { ensureSDK } from './utils/sdk.js';
import { EVMBaseElectronConfiguration } from './evm-config.schema.js';

const { URI } = vscode;

// https://gn.googlesource.com/gn/+/main/docs/reference.md?pli=1#var_target_cpu
const archOption = new Option(
  '--target-cpu <arch>',
  'Set the desired architecture for the build',
).choices(['x86', 'x64', 'arm', 'arm64']);

function createConfig(options: Record<string, any>): EVMBaseElectronConfiguration {
  const root = resolvePath(options.root);
  const homedir = os.homedir();

  // build the `gn gen` args
  const gn_args = [`import("//electron/build/args/${options.import}.gn")`];

  if (options.remoteBuild !== 'none') {
    gn_args.push('use_remoteexec=true');
  }

  if (options.asan) gn_args.push('is_asan=true');
  if (options.lsan) gn_args.push('is_lsan=true');
  if (options.msan) gn_args.push('is_msan=true');
  if (options.tsan) gn_args.push('is_tsan=true');

  if (options.mas) {
    if (process.platform !== 'darwin') {
      fatal('macOS App Store builds are only supported on macOS');
    }
    gn_args.push('is_mas_build=true');
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
    $schema: URI.file(path.resolve(import.meta.dirname, '..', 'evm-config.schema.json')).toString(),
    remoteBuild: options.remoteBuild,
    root,
    remotes: {
      electron,
    },
    gen: {
      args: gn_args,
      out: options.out,
    },
    preserveSDK: 5,
    env: {
      CHROMIUM_BUILDTOOLS_PATH: path.resolve(root, 'src', 'buildtools'),
      GIT_CACHE_PATH: process.env.GIT_CACHE_PATH
        ? resolvePath(process.env.GIT_CACHE_PATH)
        : path.resolve(homedir, '.git_cache'),
    },
  };
}

function runGClientConfig(config: EVMBaseElectronConfiguration) {
  const { root } = config;
  ensureDepotTools();
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
  depotSpawnSync(config, exec, args, opts, 'gclient config failed');
}

function ensureRoot(config: EVMBaseElectronConfiguration, force: boolean) {
  const { root } = config;

  ensureDir(root);

  const hasOtherFiles = fs.readdirSync(root).some((file) => file !== '.gclient');
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
      '--remote-build <target>',
      `Use Electron's RBE backend. The "reclient" and "siso" modes will fall back to cache-only depending on the auth provided`,
    )
      .choices(['reclient', 'siso', 'none'])
      .default('reclient'),
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
      evmConfig.saveConfig(name, config);
      console.log(`New build config ${color.config(name)} created in ${color.path(filename)}`);

      // `e use` the new config
      const e = path.resolve(import.meta.dirname, 'e');
      const opts = { stdio: 'inherit' } as const;
      childProcess.execFileSync(process.execPath, [e, 'use', name], opts);

      // ensure macOS SDKs are loaded
      if (process.platform === 'darwin') {
        ensureSDK();
      }

      ensureRoot(config, !!options.force);

      // (maybe) run sync to ensure external binaries are downloaded
      if (options.bootstrap) {
        childProcess.execFileSync(process.execPath, [e, 'sync', '-v'], opts);
      }

      // maybe authenticate with RBE
      if (
        process.env.NODE_ENV !== 'test' &&
        (config.remoteBuild === 'reclient' || config.remoteBuild === 'siso')
      ) {
        childProcess.execFileSync(process.execPath, [e, 'd', 'rbe', 'login'], opts);
      }

      // (maybe) build Electron
      if (options.bootstrap) {
        childProcess.execFileSync(process.execPath, [e, 'build'], opts);
      }
    } catch (e) {
      fatal(e as Error);
    }
  })
  .parse(process.argv);
