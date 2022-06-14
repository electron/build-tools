#!/usr/bin/env node

const { Octokit } = require('@octokit/rest');
const chalk = require('chalk').default;
const { execFileSync } = require('child_process');
const program = require('commander');
const got = require('got');
const path = require('path');

const colorForStatus = status => {
  switch (status) {
    case 'success':
      return chalk.green(status);
    case 'infrastructure_fail':
    case 'failed':
    case 'terminated-unknown':
    case 'unauthorized':
    case 'timedout':
    case 'canceled':
      return chalk.redBright(status);
    case 'running':
    case 'not_run':
    case 'retried':
    case 'queued':
    case 'not_running':
    case 'on_hold':
    case 'blocked':
      return chalk.yellow(status);
  }
};

const { current } = require('../evm-config');
const { getGitHubAuthToken } = require('../utils/github-auth');
const { fatal } = require('../utils/logging');

const CIRCLECI_APP_ID = 18001;
const APPVEYOR_BOT_ID = 40616121;

const printChecks = checks => {
  let result = '';
  for (const [name, check] of Object.entries(checks)) {
    if (!check) {
      result += `  ⦿ ${name} - ${chalk.blue('Missing')}\n`;
      continue;
    }
    const status =
      check.status === 'completed'
        ? check.conclusion === 'success'
          ? chalk.green('Success')
          : chalk.redBright('Failed')
        : chalk.yellow('Running');
    const url = new URL(check.details_url);
    url.search = '';
    result += `  ⦿ ${name} - ${status} - ${url}\n`;
    if (check.jobs) {
      for (const job of check.jobs) {
        const { id, status } = job;
        result += `   ⦿ ${colorForStatus(status)} - ${id}\n`;
      }
    }
  }

  return result;
};

const printStatuses = statuses => {
  let result = '';
  for (const [name, check_status] of Object.entries(statuses)) {
    if (!check_status) {
      result += `  ⦿ ${name} - ${chalk.blue('Missing')}\n`;
      continue;
    }
    const state =
      check_status.state === 'pending'
        ? chalk.yellow('Running')
        : check_status.state === 'success'
        ? chalk.green('Success')
        : chalk.redBright('Failed');
    const url = new URL(check_status.target_url);
    url.search = '';
    result += `  ⦿ ${name} - ${state} - ${url}\n`;
  }

  return result;
};

const parseRef = ref => {
  const pullPattern = /^#?\d{1,7}$/;
  if (pullPattern.test(ref)) {
    const pullNum = ref.startsWith('#') ? ref.substring(1) : ref;
    return `refs/pull/${pullNum}/head`;
  }

  return ref;
};

program
  .description('Show information about CI job statuses')
  .option('-r|--ref <ref>', 'The ref to check CI job status for')
  .option('-s|--show-jobs', 'Whether to also list the jobs for each workflow')
  .action(async options => {
    const electronDir = path.resolve(current().root, 'src', 'electron');
    const currentRef = execFileSync('git', ['branch', '--show-current'], { cwd: electronDir })
      .toString()
      .trim();

    const octokit = new Octokit({
      auth: process.env.ELECTRON_BUILD_TOOLS_GH_AUTH || (await getGitHubAuthToken(['repo'])),
    });

    const ref = options.ref ? parseRef(options.ref) : currentRef;
    try {
      const {
        data: { check_runs },
      } = await octokit.checks.listForRef({
        repo: 'electron',
        owner: 'electron',
        ref,
      });

      const checks = {};
      checks['macOS'] = check_runs.find(
        ({ app, name }) => app.id === CIRCLECI_APP_ID && name === 'build-mac',
      );
      checks['Linux'] = check_runs.find(
        ({ app, name }) => app.id === CIRCLECI_APP_ID && name === 'build-linux',
      );
      checks['Lint'] = check_runs.find(
        ({ app, name }) => app.id === CIRCLECI_APP_ID && name === 'lint',
      );

      const { data } = await octokit.repos.listCommitStatusesForRef({
        repo: 'electron',
        owner: 'electron',
        ref,
      });

      const statuses = {};
      statuses['Windows x64'] = data.find(
        ({ creator, context }) =>
          creator.id === APPVEYOR_BOT_ID && context === 'appveyor: win-x64-testing',
      );
      statuses['Windows x64 (PR)'] = data.find(
        ({ creator, context }) =>
          creator.id === APPVEYOR_BOT_ID && context === 'appveyor: win-x64-testing-pr',
      );
      statuses['Windows ia32'] = data.find(
        ({ creator, context }) =>
          creator.id === APPVEYOR_BOT_ID && context === 'appveyor: win-ia32-testing',
      );
      statuses['Windows ia32 (PR)'] = data.find(
        ({ creator, context }) =>
          creator.id === APPVEYOR_BOT_ID && context === 'appveyor: win-ia32-testing-pr',
      );
      statuses['Windows Arm'] = data.find(
        ({ creator, context }) =>
          creator.id === APPVEYOR_BOT_ID && context === 'appveyor: win-woa-testing',
      );

      if (options.showJobs) {
        for (const [name, check] of Object.entries(checks)) {
          const workflowID = new URL(check.details_url).pathname.replace('/workflow-run/', '');
          const { items: jobs } = await got(
            `https://circleci.com/api/v2/workflow/${workflowID}/job`,
            {
              username: process.env.CIRCLE_TOKEN,
              password: '',
            },
          ).json();
          checks[name].jobs = jobs;
        }
      }

      console.log(`${chalk.bold('Electron CI Status')}
  ${chalk.bold('Ref')}: ${chalk.cyan(ref)}

  ${chalk.bold(chalk.bgMagenta(chalk.white('Circle CI')))}
${printChecks(checks)}

  ${chalk.bold(chalk.bgBlue(chalk.white('Appveyor')))}
${printStatuses(statuses)}`);
    } catch (e) {
      fatal(e.message);
    }
  });

program.parse(process.argv);
