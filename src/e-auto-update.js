#!/usr/bin/env node

const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const program = require('commander');

const { color, fatal } = require('./utils/logging');

const markerFilePath = path.join(__dirname, '..', '.disable-auto-updates');

program
  .allowUnknownOption()
  .description('Check for build-tools updates or enable/disable automatic updates');

program
  .command('enable')
  .description('enable automatic updates')
  .action(() => {
    try {
      if (fs.existsSync(markerFilePath)) {
        fs.unlinkSync(markerFilePath);
      }
      console.log('Automatic updates enabled');
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('disable')
  .description('disable automatic updates')
  .action(() => {
    try {
      fs.closeSync(fs.openSync(markerFilePath, 'w'));
      console.log('Automatic updates disabled');
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('check')
  .description('check for updates and apply them')
  .action(checkForUpdates);

function checkForUpdates() {
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

    console.log(color.childExec('git', ['pull', '--rebase', '--autostash'], execOpts));
    cp.execSync('git pull --rebase --autostash', execOpts);
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
}

program.parse(process.argv);

if (process.argv.length < 3) {
  checkForUpdates();
}
