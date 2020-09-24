#!/usr/bin/env node

const cp = require('child_process');
const path = require('path');
const program = require('commander');

const { color, fatal } = require('./utils/logging');

program
  .allowUnknownOption()
  .description('Check for build-tools updates')
  .parse(process.argv);

try {
  console.log('Checking for build-tools updates');

  const execOpts = {
    cwd: path.resolve(__dirname, '..'),
  };

  const headBefore = cp
    .execSync('git rev-parse --verify HEAD', execOpts)
    .toString('utf8')
    .trim();

  const currentBranch = cp
    .execSync('git rev-parse --abbrev-ref HEAD', execOpts)
    .toString('utf8')
    .trim();

  if (currentBranch !== 'master') {
    fatal(
      `build-tools is checked out on ${currentBranch} and not 'master' - please switch and try again.`,
    );
  }

  console.log(color.childExec('git', ['pull'], execOpts));
  cp.execSync('git pull', execOpts);
  const headAfter = cp
    .execSync('git rev-parse --verify HEAD', execOpts)
    .toString('utf8')
    .trim();
  if (headBefore !== headAfter) {
    console.log(color.childExec('npx', ['yarn'], execOpts));
    cp.execSync('npx yarn', execOpts);
    console.log('Updated to Latest Build Tools');
  } else {
    console.log('Already Up To Date');
  }
} catch (e) {
  fatal(e);
}
