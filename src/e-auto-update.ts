#!/usr/bin/env node

import chalk from 'chalk';
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { program } from 'commander';
import semver from 'semver';

import { color, fatal } from './utils/logging.js';

const BUILD_TOOLS_INSTALLER_MIN_VERSION = '1.1.0';

const markerFilePath = path.join(import.meta.dirname, '..', '.disable-auto-updates');

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
      fatal(e as Error);
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
      fatal(e as Error);
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
        packageJson = JSON.parse(fs.readFileSync(buildToolsInstallerPackage, 'utf-8'));
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

    const execOpts = { cwd: path.resolve(import.meta.dirname, '..') };
    const git = (args: string) => cp.execSync(`git ${args}`, execOpts).toString('utf8').trim();

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
    fatal(e as Error);
  }
}

program.parse(process.argv);
