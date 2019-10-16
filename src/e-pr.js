#!/usr/bin/env node

const childProcess = require('child_process');
const open = require('open');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { fatal } = require('./util');

function guessPRTarget(config) {
  const filename = path.resolve(config.root, 'src', 'electron', 'package.json');
  const package = require(filename);
  if (package.version.includes('nightly')) {
    return 'master';
  }
  const pattern = /^([0-9]+)\.([0-9]+)\.[0-9]+.*$/;
  const match = pattern.exec(package.version);
  if (match) {
    return `${match[1]}-${match[2]}-x`;
  }
  throw Error(`Failed to determine target PR branch! ${filename}'s version '${package.version}' should include 'nightly' or match ${pattern}`)
}

function guessHead(config) {
  const command = 'git rev-parse --abbrev-ref HEAD';
  const cwd = path.resolve(config.root, 'src', 'electron');
  const options = { cwd, encoding: 'utf8' };
  return childProcess.execSync(command, options).trim();
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
