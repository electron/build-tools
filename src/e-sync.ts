#!/usr/bin/env node

import { execSync } from 'node:child_process';
import path from 'node:path';
import { program } from 'commander';

import * as evmConfig from './evm-config.js';
import { fatal } from './utils/logging.js';
import { ensureDir } from './utils/paths.js';
import { ensureDepotTools, depotSpawnSync } from './utils/depot-tools.js';
import { configureReclient } from './utils/setup-reclient-chromium.js';
import { ensureSDK } from './utils/sdk.js';

function setRemotes(cwd: string, repo: Record<string, string>): void {
  // Confirm that cwd is the git root
  const gitRoot = path.normalize(
    execSync('git rev-parse --show-toplevel', { cwd }).toString().trim(),
  );

  if (gitRoot !== cwd) {
    fatal(`Expected git root to be ${cwd} but found ${gitRoot}`);
  }

  for (const remote in repo) {
    // First check that the fork remote exists.
    if (remote === 'fork') {
      const remotes = execSync('git remote', { cwd }).toString().trim().split('\n');

      // If we've not added the fork remote, add it instead of updating the url.
      if (!remotes.includes('fork')) {
        execSync(`git remote add ${remote} ${repo[remote]}`, { cwd });
        break;
      }
    }

    execSync(`git remote set-url ${remote} ${repo[remote]}`, { cwd });
    execSync(`git remote set-url --push ${remote} ${repo[remote]}`, { cwd });
  }
}

function runGClientSync(syncArgs: string[], syncOpts: { threeWay: boolean }): void {
  const config = evmConfig.current();
  const srcdir = path.resolve(config.root, 'src');
  ensureDir(srcdir);

  if (config.env.GIT_CACHE_PATH) {
    ensureDir(config.env.GIT_CACHE_PATH);
  }

  ensureDepotTools();

  if (process.platform === 'darwin') {
    ensureSDK();
  }

  if (config.defaultTarget === 'chrome') {
    configureReclient();
  }

  const exec = 'gclient';
  const args = ['sync', '--with_branch_heads', '--with_tags', '-vv', ...syncArgs];
  const opts = {
    cwd: srcdir,
    shell: true,
    env: syncOpts.threeWay
      ? {
          ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES: 'true',
        }
      : {},
  };
  depotSpawnSync(config, exec, args, opts, 'gclient sync failed');

  // Only set remotes if we're building an Electron target.
  if (config.defaultTarget !== 'chrome') {
    const electronPath = path.resolve(srcdir, 'electron');
    if (config.remotes?.electron) {
      setRemotes(electronPath, config.remotes.electron);
    }
  }
}

program
  .option(
    '--3|--three-way',
    'Apply Electron patches using a three-way merge, useful when upgrading Chromium',
  )
  .arguments('[gclientArgs...]')
  .allowUnknownOption()
  .description('Fetch source / synchronize repository checkouts')
  .action((gclientArgs, options) => {
    try {
      const { threeWay } = options;
      runGClientSync(gclientArgs, { threeWay });
    } catch (e) {
      fatal(e as Error);
    }
  })
  .parse(process.argv);
