#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { fatal } = require('./utils/logging');
const { ensureDir } = require('./utils/paths');
const depot = require('./utils/depot-tools');

function setRemotes(cwd, repo) {
  for (const remote in repo) {
    const cmd = 'git';
    let args = ['remote', 'set-url', remote, repo[remote]];
    const opts = { cwd };
    childProcess.execFileSync(cmd, args, opts);

    args.splice(-1, 0, '--push');
    childProcess.execFileSync(cmd, args, opts);
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
  setRemotes(electronPath, config.remotes.electron);

  const nodejsPath = path.resolve(srcdir, 'third_party', 'electron_node');
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
