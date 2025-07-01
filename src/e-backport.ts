#!/usr/bin/env node

import { Octokit } from '@octokit/rest';
import chalk from 'chalk';
import { program } from 'commander';
import inquirer from 'inquirer';
import path from 'node:path';

import * as evmConfig from './evm-config.js';
import { depotSpawnSync } from './utils/depot-tools.js';
import { getGitHubAuthToken } from './utils/github-auth.js';
import { fatal } from './utils/logging.js';

program
  .arguments('[pr]')
  .description('Assists with manual backport processes')
  .action(async (prNumberStr) => {
    const prNumber = parseInt(prNumberStr, 10);
    if (isNaN(prNumber) || `${prNumber}` !== prNumberStr) {
      fatal(`backport requires a number, "${prNumberStr}" was provided`);
      return;
    }

    const octokit = new Octokit({
      auth: await getGitHubAuthToken(['repo']),
    });
    const { data: user } = await octokit.users.getAuthenticated();
    const { data: pr } = await octokit.pulls.get({
      owner: 'electron',
      repo: 'electron',
      pull_number: prNumber,
    });
    if (!pr.merge_commit_sha) {
      fatal('No merge SHA available on PR');
      return;
    }

    const targetBranches = pr.labels
      .filter((label) => label.name?.startsWith('needs-manual-bp/'))
      .map((label) => label.name!.substring(16));
    if (targetBranches.length === 0) {
      fatal('The given pull request is not needing any manual backports yet');
      return;
    }

    const { branch: targetBranch } = await inquirer.prompt([
      {
        type: 'list',
        name: 'branch',
        message: 'Which branch do you want to backport this PR to?',
        choices: targetBranches,
      },
    ]);

    const config = evmConfig.current();
    const gitOpts = {
      cwd: path.resolve(config.root, 'src', 'electron'),
      stdio: 'pipe',
    } as const;
    const result = depotSpawnSync(config, 'git', ['status', '--porcelain'], gitOpts);
    if (result.status !== 0 || result.stdout.toString().trim().length !== 0) {
      fatal(
        "Your current git working directory is not clean, we won't erase your local changes. Clean it up and try again",
      );
      return;
    }

    depotSpawnSync(
      config,
      'git',
      ['checkout', targetBranch],
      gitOpts,
      'Failed to checkout base branch',
    );
    depotSpawnSync(
      config,
      'git',
      ['pull', 'origin', targetBranch],
      gitOpts,
      'Failed to update base branch',
    );
    depotSpawnSync(
      config,
      'git',
      ['fetch', 'origin', pr.base.ref],
      gitOpts,
      'Failed to fetch latest upstream',
    );

    const manualBpBranch = `manual-bp/${user.login}/pr/${prNumber}/branch/${targetBranch}`;
    depotSpawnSync(config, 'git', ['branch', '-D', manualBpBranch], gitOpts);
    depotSpawnSync(
      config,
      'git',
      ['checkout', '-b', manualBpBranch],
      gitOpts,
      `Failed to checkout new branch "${manualBpBranch}"`,
    );

    depotSpawnSync(
      config,
      'yarn',
      ['install'],
      gitOpts,
      `Failed to do "yarn install" on new branch`,
    );

    const cherryPickResult = depotSpawnSync(config, 'git', ['cherry-pick', pr.merge_commit_sha], {
      cwd: gitOpts.cwd,
    });

    const pushCommand = chalk.yellow(
      !!config.remotes?.electron.fork ? 'git push fork' : 'git push',
    );
    const cherryPickCommand = chalk.yellow('git cherry-pick --continue');
    const prCommand = chalk.yellow(`e pr --backport ${prNumber}`);

    const followupMessage =
      cherryPickResult.status !== 0
        ? `Cherry pick complete, fix conflicts locally and then run the following commands: "${cherryPickCommand}", "${pushCommand}"`
        : `Cherry pick succeeded, run "${pushCommand}"`;

    console.info(
      '\n',
      chalk.cyan(`${followupMessage} and finally "${prCommand}" to create your new pull request`),
    );
  });

program.parse(process.argv);
