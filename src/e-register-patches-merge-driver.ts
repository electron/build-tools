#!/usr/bin/env node

import * as cp from 'node:child_process';
import * as path from 'node:path';

import { Command } from 'commander';

import * as evmConfig from './evm-config.js';
import { color, fatal } from './utils/logging.js';
import {
  installPatchesMergeDriver,
  PATCHES_MERGE_ATTRIBUTE,
  PATCHES_MERGE_DRIVER_NAME,
} from './utils/patches-merge-driver.js';

// Resolve the checkout to register the driver in: an explicit path, else the
// active build config's electron checkout, else the git repo containing cwd.
function resolveCheckout(checkout: string | undefined): string {
  let candidate: string;
  if (checkout !== undefined) {
    candidate = path.resolve(checkout);
  } else {
    const config = evmConfig.maybeCurrent();
    candidate = config.root ? path.resolve(config.root, 'src', 'electron') : process.cwd();
  }

  const toplevel = cp.spawnSync('git', ['-C', candidate, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (toplevel.error) throw toplevel.error;
  if (toplevel.status !== 0) {
    const hint =
      checkout === undefined
        ? 'pass the path to an electron checkout, e.g. `e register-patches-merge-driver ~/electron/src/electron`'
        : 'expected the path to an electron checkout';
    throw new Error(`${candidate} is not a git checkout; ${hint}`);
  }
  return path.resolve(toplevel.stdout.trim());
}

const program = new Command();

program
  .argument(
    '[checkout]',
    'path to the electron checkout (default: the current build config, or the git repo containing cwd)',
  )
  .description(
    "Register the `.patches` list merge driver (`e patch-merge-driver`) in an electron checkout's git config",
  )
  .action((checkout: string | undefined) => {
    try {
      const dir = resolveCheckout(checkout);
      const { changed, driverCommand, attributesPath } = installPatchesMergeDriver(dir);
      console.log(
        changed
          ? `${color.success} Registered the .patches list merge driver in ${color.path(dir)}`
          : `${color.info} The .patches list merge driver is already registered in ${color.path(dir)}`,
      );
      console.log(`  merge.${PATCHES_MERGE_DRIVER_NAME}.name = electron .patches list merge`);
      console.log(`  merge.${PATCHES_MERGE_DRIVER_NAME}.driver = ${driverCommand}`);
      console.log(`  ${color.path(attributesPath)}: ${PATCHES_MERGE_ATTRIBUTE}`);
    } catch (e) {
      fatal(e);
    }
  })
  .on('--help', () => {
    console.log('');
    console.log('`e sync` does this for you on every sync. Use this command to register the');
    console.log('driver in a checkout that build-tools does not manage, for example from a bot');
    console.log('or a CI job that cherry-picks between electron branches.');
    console.log('');
    console.log('Examples:');
    console.log('');
    console.log('  $ e register-patches-merge-driver');
    console.log('  $ e register-patches-merge-driver ~/electron/src/electron');
  });

program.parse(process.argv);
