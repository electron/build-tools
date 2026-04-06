#!/usr/bin/env node

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { styleText } from 'node:util';

import { program } from 'commander';
import * as semver from 'semver';

import { color, fatal } from './utils/logging';

const BUILD_TOOLS_INSTALLER_MIN_VERSION = '1.1.0';

const markerFilePath = path.join(__dirname, '..', '.disable-auto-updates');
const yarnPath = path.join(__dirname, '..', '.yarn', 'releases', 'yarn-4.10.3.cjs');

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

function checkForUpdates(): void {
  try {
    console.log('Checking for build-tools updates');

    // Check if @electron/build-tools needs to be updated
    const globalNodeModulesPaths: string[] = [];

    try {
      globalNodeModulesPaths.push(cp.execSync('npm root -g').toString('utf8').trim());
    } catch {
      // ignore
    }

    try {
      globalNodeModulesPaths.push(
        path.join(cp.execSync('yarn global dir').toString('utf8').trim(), 'node_modules'),
      );
    } catch {
      // ignore
    }

    for (const globalNodeModules of globalNodeModulesPaths) {
      let packageJson: { version: string };
      const buildToolsInstallerPackage = path.resolve(
        globalNodeModules,
        '@electron',
        'build-tools',
        'package.json',
      );

      try {
        packageJson = JSON.parse(fs.readFileSync(buildToolsInstallerPackage, 'utf8')) as {
          version: string;
        };
      } catch {
        continue;
      }

      if (semver.lt(packageJson.version, BUILD_TOOLS_INSTALLER_MIN_VERSION)) {
        console.log(
          `\n${styleText(['bgWhite', 'black'], 'NOTE')} Please update ${styleText(
            'greenBright',
            '@electron/build-tools',
          )}\n`,
        );
      }
      break;
    }

    const execOpts = { cwd: path.resolve(__dirname, '..') };
    const git = (args: string): string =>
      cp.execSync(`git ${args}`, execOpts).toString('utf8').trim();

    const headCmd = 'rev-parse --verify HEAD';
    const headBefore = git(headCmd);

    const getCurrentCheckout = (): string => {
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
      console.log(color.childExec(process.execPath, [yarnPath, '--immutable'], execOpts));
      const installResult = cp.spawnSync(process.execPath, [yarnPath, '--immutable'], execOpts);
      if (installResult.status !== 0) {
        fatal(`yarn install failed with exit code ${installResult.status}`);
      }
      // Yarn Berry does not run `prepare` on install, so dist/ will not
      // recompile on its own after a pull. Run the build explicitly.
      console.log(color.childExec(process.execPath, [yarnPath, 'build'], execOpts));
      const buildResult = cp.spawnSync(process.execPath, [yarnPath, 'build'], execOpts);
      if (buildResult.status !== 0) {
        fatal(`yarn build failed with exit code ${buildResult.status}`);
      }
      console.log('build-tools updated to latest version!');
    }
  } catch (e) {
    fatal(e);
  }
}

program.parse(process.argv);
