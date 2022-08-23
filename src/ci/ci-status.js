#!/usr/bin/env node

const { Octokit } = require('@octokit/rest');
const { default: chalk } = require('chalk');
const { execFileSync } = require('child_process');
const program = require('commander');
const got = require('got');
const path = require('path');
const { current } = require('../evm-config');
const { getGitHubAuthToken } = require('../utils/github-auth');
const { fatal } = require('../utils/logging');

const { CIRCLE_TOKEN } = process.env;

const CIRCLECI_APP_ID = 18001;
const APPVEYOR_BOT_ID = 40616121;

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

const getStatusString = check => {
  return check.status === 'completed'
    ? check.conclusion === 'success'
      ? chalk.green('success')
      : chalk.redBright('failed')
    : chalk.yellow('running');
};

const formatLink = (name, url) => `\x1B]8;;${url}\x1B\\${name}\x1B]8;;\x1B\\`;

const getWorkflowID = url => url.pathname.replace('/workflow-run/', '');
const getBuildID = ({ pathname }) => {
  const index = pathname.lastIndexOf('/builds/') + 8;
  return pathname.substring(index, pathname.length);
};

const printChecks = (checks, link) => {
  let result = '';
  for (const [name, check] of Object.entries(checks)) {
    if (!check) {
      result += `  ⦿ ${name} - ${chalk.blue('Missing')}\n`;
      continue;
    }
    const status = getStatusString(check);
    const url = new URL(check.details_url);

    if (link) {
      result += `  ⦿ ${chalk.bold(name)} - ${formatLink(status, url)} - ${getWorkflowID(url)}\n`;
    } else {
      result += ` ⦿ ${chalk.bold(name)} - ${status} - ${url}\n`;
    }

    if (check.jobs) {
      const failed = [];
      const succeeded = check.jobs.filter(j => {
        const passed = j.status === 'success';
        if (!passed) failed.push(j);
        return passed;
      });

      if (succeeded.length) {
        const names = succeeded.map(s => s.name);
        result +=
          succeeded.length === check.jobs.length
            ? '     ⦿ all jobs succeeded\n'
            : `     ⦿ ${colorForStatus('success')} ${names.join(', ')}\n`;
      }
      for (const job of failed) {
        const { id, name, status } = job;
        result += `     ⦿ ${colorForStatus(status)} - ${name} - ${id}\n`;
      }
    }
    result += '\n';
  }

  return result;
};

const printStatuses = (statuses, link) => {
  let result = '';
  for (const [name, check] of Object.entries(statuses)) {
    if (!check) {
      result += `  ⦿ ${chalk.bold(name)} - ${chalk.blue('Missing')}\n\n`;
      continue;
    }
    const status = getStatusString(check);
    const url = new URL(check.target_url);

    if (link) {
      result += `  ⦿ ${chalk.bold(name)} - ${formatLink(status, url)} - ${getBuildID(url)}\n\n`;
    } else {
      result += ` ⦿ ${chalk.bold(name)} - ${status} - ${url}\n\n`;
    }
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
  .option('-n|--no-link', 'Do not show smart linking for CI status information')
  .option('-s|--show-jobs', 'Whether to also list the jobs for each workflow', () => {
    if (!CIRCLE_TOKEN) {
      fatal('process.env.CIRCLE_TOKEN is required to run this command');
    }
  })
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
          if (!check) continue;
          const url = new URL(check.details_url);
          const workflowID = getWorkflowID(url);
          const { items: jobs } = await got(
            `https://circleci.com/api/v2/workflow/${workflowID}/job`,
            {
              username: CIRCLE_TOKEN,
              password: '',
            },
          ).json();
          checks[name].jobs = jobs;
        }
      }

      console.log(`${chalk.bold('Electron CI Status')}
  ${chalk.bold('Ref')}: ${chalk.cyan(ref)}

  ${chalk.bold(chalk.bgMagenta(chalk.white('Circle CI')))}
${printChecks(checks, !!options.link)}
  ${chalk.bold(chalk.bgBlue(chalk.white('Appveyor')))}
${printStatuses(statuses, !!options.link)}`);
    } catch (e) {
      fatal(e.message);
    }
  });

program.parse(process.argv);
