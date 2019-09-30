#!/usr/bin/env node

const childProcess = require('child_process');
const open = require('open');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { fatal } = require('./util');

function guessPRTarget(config) {
  const package = require(path.resolve(config.root, 'src', 'electron', 'package.json'));
  if (package.version.includes('nightly')) {
    return 'master';
  }
  const match = /^([0-9]+)\.([0-9]+)\.[0-9]+.*$/.exec(package.version);
  if (match) {
    return `${match[1]}-${match[2]}-x`;
  }
  throw `Failed to determine target PR branch`;
}

function guessHead(config) {
  const cmd = 'git rev-parse --abbrev-ref HEAD';
  const cwd = path.resolve(config.root, 'src', 'electron');
  const opts = { cwd, encoding: 'utf8' };
  return childProcess.execSync(cmd, opts).trim();
}

function getCompareURL(config) {
  const base = guessPRTarget(config);
  const head = guessHead(config);
  return `https://github.com/electron/electron/compare/${base}...${head}?expand=1`;
}

program.description('Open a GitHub URL where you can PR your changes').parse(process.argv);

try {
  open(getCompareURL(evmConfig.current()));
} catch (e) {
  fatal(e);
}
