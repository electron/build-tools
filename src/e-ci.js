#!/usr/bin/env node

const { Octokit } = require('@octokit/rest');
const chalk = require('chalk').default;
const cp = require('child_process');
const program = require('commander');
const path = require('path');

const evmConfig = require('./evm-config');
const { getGitHubAuthToken } = require('./utils/github-auth');
const { fatal } = require('./utils/logging');

const CIRCLECI_APP_ID = 18001;
const APPVEYOR_BOT_ID = 40616121;

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

program
  .description('Show information about CI job statuses')
  .argument('<status>', 'Show CI status')
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

    try {
      const {
        data: { check_runs: checks },
      } = await octokit.checks.listForRef({
        repo: 'electron',
        owner: 'electron',
        ref: currentSha,
      });

      const macOS = checks.find(
        ({ app, name }) => app.id === CIRCLECI_APP_ID && name === 'build-mac',
      );
      const linux = checks.find(
        ({ app, name }) => app.id === CIRCLECI_APP_ID && name === 'build-linux',
      );
      const lint = checks.find(({ app, name }) => app.id === CIRCLECI_APP_ID && name === 'lint');

      const { data: statuses } = await octokit.repos.listCommitStatusesForRef({
        repo: 'electron',
        owner: 'electron',
        ref: currentSha,
      });

      const win64 = statuses.find(
        ({ creator, context }) =>
          creator.id === APPVEYOR_BOT_ID && context === 'appveyor: win-x64-testing',
      );
      const win32 = statuses.find(
        ({ creator, context }) =>
          creator.id === APPVEYOR_BOT_ID && context === 'appveyor: win-ia32-testing',
      );
      const woa = statuses.find(
        ({ creator, context }) =>
          creator.id === APPVEYOR_BOT_ID && context === 'appveyor: win-woa-testing',
      );

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
    } catch (e) {
      fatal(e.message);
    }
  });

program.parse(process.argv);
