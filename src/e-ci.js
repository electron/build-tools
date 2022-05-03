#!/usr/bin/env node

const { Octokit } = require('@octokit/rest');
const chalk = require('chalk').default;
const cp = require('child_process');
const program = require('commander');
const path = require('path');

const evmConfig = require('./evm-config');
const { getGitHubAuthToken } = require('./utils/github-auth');

const CIRCLECI_APP_ID = 18001;
const APPVEYOR_BOT_ID = 40616121;

program.description('Show information about CI jobs');

program
  .command('status')
  .description('Show the current CI job status for the current checkout')
  .action(async () => {
    const electronDir = path.resolve(evmConfig.current().root, 'src', 'electron');
    const currentSha = cp
      .execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: electronDir,
      })
      .toString()
      .trim();
    const currentRef = cp
      .execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: electronDir,
      })
      .toString()
      .trim();

    const octokit = new Octokit({
      auth: process.env.ELECTRON_BUILD_TOOLS_GH_AUTH || (await getGitHubAuthToken(['repo'])),
    });

    const {
      data: { check_runs: checks },
    } = await octokit.checks.listForRef({
      repo: 'electron',
      owner: 'electron',
      ref: currentSha,
    });
    const macOS = checks.find(
      check => check.app.id === CIRCLECI_APP_ID && check.name === 'build-mac',
    );
    const linux = checks.find(
      check => check.app.id === CIRCLECI_APP_ID && check.name === 'build-linux',
    );
    const lint = checks.find(check => check.app.id === CIRCLECI_APP_ID && check.name === 'lint');

    const { data: statuses } = await octokit.repos.listCommitStatusesForRef({
      repo: 'electron',
      owner: 'electron',
      ref: currentSha,
    });

    const win64 = statuses.find(
      status =>
        status.creator.id === APPVEYOR_BOT_ID && status.context === 'appveyor: win-x64-testing',
    );
    const win32 = statuses.find(
      status =>
        status.creator.id === APPVEYOR_BOT_ID && status.context === 'appveyor: win-ia32-testing',
    );
    const woa = statuses.find(
      status =>
        status.creator.id === APPVEYOR_BOT_ID && status.context === 'appveyor: win-woa-testing',
    );

    const checkLine = (check, name) => {
      if (!check) return `⦿ ${name} - ${chalk.blue('Missing')}`;
      const status =
        check.status === 'completed'
          ? check.conclusion === 'success'
            ? chalk.green('Success')
            : chalk.red('Failed')
          : chalk.yellow('Running');
      const url = new URL(check.details_url);
      url.search = '';
      return `⦿ ${name} - ${status} - ${url}`;
    };

    const statusLine = (_status, name) => {
      if (!_status) return `⦿ ${name} - ${chalk.blue('Missing')}`;
      const status =
        _status.state === 'pending'
          ? chalk.yellow('Running')
          : _status.state === 'success'
          ? chalk.green('Success')
          : chalk.red('Failed');
      const url = new URL(_status.target_url);
      url.search = '';
      return `⦿ ${name} - ${status} - ${url}`;
    };

    console.log(`${chalk.bold('Electron CI Status')}
${chalk.bold('SHA')}: ${chalk.cyan(currentSha)}
${chalk.bold('Ref')}: ${chalk.cyan(currentRef)}

${chalk.bold(chalk.bgYellow(chalk.black('Circle CI')))}
${checkLine(macOS, 'macOS')}
${checkLine(linux, 'Linux')}
${checkLine(lint, 'Lint')}

${chalk.bold(chalk.bgBlue(chalk.white('Appveyor')))}
${statusLine(win32, 'Windows ia32')}
${statusLine(win64, 'Windows x64')}
${statusLine(woa, 'Windows Arm')}`);
  });

program.parse(process.argv);
