#!/usr/bin/env node

const cp = require('child_process');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { fatal } = require('./utils/logging');
const { ensureDir } = require('./utils/paths');
const depot = require('./utils/depot-tools');
const { configureReclient } = require('./utils/setup-reclient-chromium');

function setRemotes(cwd, repo) {
  // Confirm that cwd is the git root
  const gitRoot = path.normalize(
    cp
      .execSync('git rev-parse --show-toplevel', { cwd })
      .toString()
      .trim(),
  );

  if (gitRoot !== cwd) {
    fatal(`Expected git root to be ${cwd} but found ${gitRoot}`);
  }

  for (const remote in repo) {
    // First check that the fork remote exists.
    if (remote === 'fork') {
      const remotes = cp
        .execSync('git remote', { cwd })
        .toString()
        .trim()
        .split('\n');

      // If we've not added the fork remote, add it instead of updating the url.
      if (!remotes.includes('fork')) {
        cp.execSync(`git remote add ${remote} ${repo[remote]}`, { cwd });
        break;
      }
    }

    cp.execSync(`git remote set-url ${remote} ${repo[remote]}`, { cwd });
    cp.execSync(`git remote set-url --push ${remote} ${repo[remote]}`, { cwd });
  }
}

function runGClientSync(syncArgs, syncOpts) {
  const config = evmConfig.current();
  const srcdir = path.resolve(config.root, 'src');
  ensureDir(srcdir);

  if (config.env.GIT_CACHE_PATH) {
    ensureDir(config.env.GIT_CACHE_PATH);
  }

  depot.ensure();

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
  const { status } = depot.spawnSync(config, exec, args, opts);

  if (status !== 0) {
    fatal('gclient sync failed');
  }

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
  .action((gclientArgs, options) => {
    try {
      const { threeWay } = options;
      runGClientSync(gclientArgs, { threeWay });
    } catch (e) {
      fatal(e);
    }
  })
  .parse(process.argv);
