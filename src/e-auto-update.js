#!/usr/bin/env node

const chalk = require('chalk');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const program = require('commander');
const semver = require('semver');

const { color, fatal } = require('./utils/logging');

const BUILD_TOOLS_INSTALLER_MIN_VERSION = '1.1.0';

const markerFilePath = path.join(__dirname, '..', '.disable-auto-updates');

program
  .description('Check for build-tools updates or enable/disable automatic updates')
  .action(checkForUpdates);

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

program.command('check').description('check for updates and apply them').action(checkForUpdates);

function checkForUpdates() {
  try {
    console.log('Checking for build-tools updates');

    // Check if @electron/build-tools needs to be updated
    const globalNodeModulesPaths = [];

    try {
      globalNodeModulesPaths.push(cp.execSync('npm root -g').toString('utf8').trim());
    } catch {}

    try {
      globalNodeModulesPaths.push(
        path.join(cp.execSync('npx yarn global dir').toString('utf8').trim(), 'node_modules'),
      );
    } catch {}

    for (const globalNodeModules of globalNodeModulesPaths) {
      let packageJson;
      const buildToolsInstallerPackage = path.resolve(
        globalNodeModules,
        '@electron',
        'build-tools',
        'package.json',
      );

      try {
        packageJson = JSON.parse(fs.readFileSync(buildToolsInstallerPackage));
      } catch {
        continue;
      }

      if (semver.lt(packageJson.version, BUILD_TOOLS_INSTALLER_MIN_VERSION)) {
        console.log(
          `\n${chalk.bgWhite.black('NOTE')} Please update ${chalk.greenBright(
            '@electron/build-tools',
          )}\n`,
        );
      }
      break;
    }

    const execOpts = { cwd: path.resolve(__dirname, '..') };
    const git = (args) => cp.execSync(`git ${args}`, execOpts).toString('utf8').trim();

    const headCmd = 'rev-parse --verify HEAD';
    const headBefore = git(headCmd);

    const getCurrentCheckout = () => {
      const branch = git('branch --show-current');
      const sha = git('rev-parse --short HEAD');
      return branch === '' ? sha : branch;
    };

    const originUrl = git('remote get-url origin');
    const mainExists = !!git(`ls-remote --heads ${originUrl} main`);
    const desiredBranch = mainExists ? 'main' : 'master';

    const current = getCurrentCheckout();
    if (current !== desiredBranch) {
      fatal(
        `build-tools is checked out on ${current} and not '${desiredBranch}' - please switch and try again.`,
      );
    }

    console.log(
      color.childExec(
        'git',
        ['pull', 'origin', desiredBranch, '--rebase', '--autostash'],
        execOpts,
      ),
    );
    git(`pull origin ${desiredBranch} --rebase --autostash`);

    if (headBefore === git(headCmd)) {
      console.log('build-tools is up-to-date');
    } else {
      console.log(color.childExec('npx', ['yarn', '--prod'], execOpts));
      cp.execSync('npx yarn --prod', execOpts);
      console.log('build-tools updated to latest version!');
    }
  } catch (e) {
    fatal(e);
  }
}

program.parse(process.argv);
