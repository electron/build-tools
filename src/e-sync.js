#!/usr/bin/env node

const cp = require('child_process');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { fatal } = require('./utils/logging');
const { ensureDir } = require('./utils/paths');
const depot = require('./utils/depot-tools');

function setRemotes(cwd, repo) {
  for (const remote in repo) {
    // First check that the fork remote exists.
    if (remote === 'fork') {
      const remotes = cp
        .execSync('git remote')
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

function runGClientSync(config, syncArgs) {
  const srcdir = path.resolve(config.root, 'src');
  ensureDir(srcdir);

  if (config.env.GIT_CACHE_PATH) {
    ensureDir(config.env.GIT_CACHE_PATH);
  }

  depot.ensure();

  const exec = 'python';
  const args = ['gclient.py', 'sync', '--with_branch_heads', '--with_tags', '-vv', ...syncArgs];
  const opts = {
    cwd: srcdir,
  };
  depot.execFileSync(config, exec, args, opts);

  const electronPath = path.resolve(srcdir, 'electron');
  const nodejsPath = path.resolve(srcdir, 'third_party', 'electron_node');

  setRemotes(electronPath, config.remotes.electron);
  setRemotes(nodejsPath, config.remotes.node);
}

program
  .arguments('[gclientArgs...]')
  .allowUnknownOption()
  .description('Fetch source / synchronize repository checkouts')
  .parse(process.argv);

try {
  const syncArgs = program.parseOptions(process.argv).unknown;
  runGClientSync(evmConfig.current(), syncArgs);
} catch (e) {
  fatal(e);
}
