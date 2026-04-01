#!/usr/bin/env node

import * as cp from 'node:child_process';
import * as path from 'node:path';

import { program } from 'commander';

import * as evmConfig from './evm-config';
import { fatal } from './utils/logging';
import { ensureDir } from './utils/paths';
import * as depot from './utils/depot-tools';
import { configureReclient } from './utils/setup-reclient-chromium';
import { ensureSDK } from './utils/sdk';
import { ensurePrereqs } from './utils/prereqs';
import type { ElectronRemotes } from './types';

function setRemotes(cwd: string, repo: ElectronRemotes): void {
  // Confirm that cwd is the git root
  const gitRoot = path.normalize(
    cp.execSync('git rev-parse --show-toplevel', { cwd }).toString().trim(),
  );

  if (gitRoot !== cwd) {
    fatal(`Expected git root to be ${cwd} but found ${gitRoot}`);
  }

  const entries: Array<[keyof ElectronRemotes, string | undefined]> = [
    ['origin', repo.origin],
    ['fork', repo.fork],
  ];

  for (const [remote, url] of entries) {
    if (!url) continue;

    // First check that the fork remote exists.
    if (remote === 'fork') {
      const remotes = cp.execSync('git remote', { cwd }).toString().trim().split('\n');

      // If we've not added the fork remote, add it instead of updating the url.
      if (!remotes.includes('fork')) {
        cp.execSync(`git remote add ${remote} ${url}`, { cwd });
        break;
      }
    }

    cp.execSync(`git remote set-url ${remote} ${url}`, { cwd });
    cp.execSync(`git remote set-url --push ${remote} ${url}`, { cwd });
  }
}

function runGClientSync(syncArgs: string[], syncOpts: { threeWay?: boolean }): void {
  ensurePrereqs();

  const config = evmConfig.current();
  const srcdir = path.resolve(config.root, 'src');
  ensureDir(srcdir);

  if (config.env.GIT_CACHE_PATH) {
    ensureDir(config.env.GIT_CACHE_PATH);
  }

  depot.ensure();

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
  depot.spawnSync(config, exec, args, opts, 'gclient sync failed');

  // Only set remotes if we're building an Electron target.
  if (config.defaultTarget !== 'chrome') {
    const electronPath = path.resolve(srcdir, 'electron');
    setRemotes(electronPath, config.remotes.electron);
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
  .action((gclientArgs: string[], options: { threeWay?: boolean }) => {
    try {
      const { threeWay } = options;
      runGClientSync(gclientArgs, { threeWay: threeWay ?? false });
    } catch (e) {
      fatal(e);
    }
  })
  .parse(process.argv);
