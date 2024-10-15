#!/usr/bin/env node

const { Octokit } = require('@octokit/rest');
const chalk = require('chalk').default;
const program = require('commander');
const inquirer = require('inquirer');
const path = require('path');

const evmConfig = require('./evm-config');
const { spawnSync } = require('./utils/depot-tools');
const { getGitHubAuthToken } = require('./utils/github-auth');
const { fatal } = require('./utils/logging');

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
      .filter((label) => label.name.startsWith('needs-manual-bp/'))
      .map((label) => label.name.substring(16));
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
    };
    const result = spawnSync(config, 'git', ['status', '--porcelain'], gitOpts);
    if (result.status !== 0 || result.stdout.toString().trim().length !== 0) {
      fatal(
        "Your current git working directory is not clean, we won't erase your local changes. Clean it up and try again",
      );
      return;
    }

    const checkoutResult = spawnSync(config, 'git', ['checkout', targetBranch], gitOpts);
    if (checkoutResult.status !== 0) {
      fatal('Failed to checkout base branch');
      return;
    }

    const ensureLatestResult = spawnSync(config, 'git', ['pull', 'origin', targetBranch], gitOpts);
    if (ensureLatestResult.status !== 0) {
      fatal('Failed to update base branch');
      return;
    }

    const ensureMergeRefLocal = spawnSync(config, 'git', ['fetch', 'origin', pr.base.ref], gitOpts);
    if (ensureMergeRefLocal.status !== 0) {
      fatal('Failed to fetch latest upstream');
      return;
    }

    const manualBpBranch = `manual-bp/${user.login}/pr/${prNumber}/branch/${targetBranch}`;
    spawnSync(config, 'git', ['branch', '-D', manualBpBranch], gitOpts);
    const backportBranchResult = spawnSync(
      config,
      'git',
      ['checkout', '-b', manualBpBranch],
      gitOpts,
    );
    if (backportBranchResult.status !== 0) {
      fatal(`Failed to checkout new branch "${manualBpBranch}"`);
      return;
    }

    const yarnInstallResult = spawnSync(config, 'yarn', ['install'], gitOpts);
    if (yarnInstallResult.status !== 0) {
      fatal(`Failed to do "yarn install" on new branch`);
      return;
    }

    const cherryPickResult = spawnSync(config, 'git', ['cherry-pick', pr.merge_commit_sha], {
      cwd: gitOpts.cwd,
    });

    const pushCommand = chalk.yellow(!!config.remotes.electron.fork ? 'git push fork' : 'git push');
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
