#!/usr/bin/env node

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { color, fatal } = require('./utils/logging');
const depot = require('./utils/depot-tools');

program
  .allowUnknownOption()
  .description('Check for build-tools updates')
  .parse(process.argv);

try {
  console.log('Checking for build-tools updates');
  const baseDir = path.resolve(__dirname, '..');

  const headBefore = cp
    .execSync('git rev-parse --verify HEAD')
    .toString('utf8')
    .trim();

  const currentBranch = cp
    .execSync('git rev-parse --abbrev-ref HEAD')
    .toString('utf8')
    .trim();

  if (currentBranch !== 'master') {
    throw new Error(
      `build-tools is checked out on ${currentBranch} and not 'master' - please switch and try again.`,
    );
  }

  console.log(
    color.childExec('git', ['pull'], {
      cwd: baseDir,
    }),
  );
  cp.execSync('git pull', {
    cwd: baseDir,
  });
  const headAfter = cp
    .execSync('git rev-parse --verify HEAD')
    .toString('utf8')
    .trim();
  if (headBefore !== headAfter) {
    console.log(
      color.childExec('npx', ['yarn'], {
        cwd: baseDir,
      }),
    );
    cp.execSync('npx yarn', {
      cwd: baseDir,
    });
    console.log('Updated to Latest Build Tools');
  } else {
    console.log('Already Up To Date');
  }
} catch (e) {
  fatal(e);
}
