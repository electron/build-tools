#!/usr/bin/env node

const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const program = require('commander');

const { color, fatal } = require('./utils/logging');

const markerFilePath = path.join(__dirname, '..', '.disable-auto-updates');

program
  .description('Check for build-tools updates or enable/disable automatic updates')
  .action(() => {
    checkForUpdates();
  });

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

    const execOpts = { cwd: path.resolve(__dirname, '..') };
    const git = args =>
      cp
        .execSync(`git ${args}`, execOpts)
        .toString('utf8')
        .trim();

    const headCmd = 'rev-parse --verify HEAD';
    const headBefore = git(headCmd);

    const originUrl = git('remote get-url origin');
    const mainExists = !!git(`ls-remote --heads ${originUrl} main`);
    const desiredBranch = mainExists ? 'main' : 'master';

    const currentBranch = git('branch --show-current');
    if (currentBranch !== desiredBranch) {
      fatal(
        `build-tools is checked out on ${currentBranch} and not '${desiredBranch}' - please switch and try again.`,
      );
    }

    console.log(color.childExec('git', ['pull', '--rebase', '--autostash'], execOpts));
    git('pull --rebase --autostash');

    if (headBefore === git(headCmd)) {
      console.log('build-tools is up-to-date');
    } else {
      console.log(color.childExec('npx', ['yarn'], execOpts));
      cp.execSync('npx yarn', execOpts);
      console.log('build-tools updated to latest version!');
    }
  } catch (e) {
    fatal(e);
  }
}

program.parse(process.argv);
