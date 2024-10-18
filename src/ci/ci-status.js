#!/usr/bin/env node

const { Octokit } = require('@octokit/rest');
const { default: chalk } = require('chalk');
const { execFileSync } = require('child_process');
const { program } = require('commander');
const path = require('path');
const { current } = require('../evm-config');
const { getGitHubAuthToken } = require('../utils/github-auth');
const { fatal } = require('../utils/logging');

const { APPVEYOR_CLOUD_TOKEN } = process.env;

const APPVEYOR_BOT_ID = 40616121;

const colorForStatus = (status) => {
  switch (status) {
    case 'success':
      return chalk.green(status);
    case 'infrastructure_fail':
    case 'failed':
    case 'terminated-unknown':
    case 'unauthorized':
    case 'timedout':
      return chalk.redBright(status);
    case 'running':
    case 'not_run':
    case 'retried':
    case 'queued':
    case 'not_running':
    case 'on_hold':
    case 'blocked':
      return chalk.yellow(status);
    case 'canceled':
    case 'cancelled':
      return chalk.gray(status);
  }
};

const getAppveyorStatusString = (check) => {
  switch (check.state) {
    case 'success':
      return chalk.green('success');
    case 'failure':
      return chalk.redBright('failed');
    default:
      return chalk.yellow('running');
  }
};

const appveyorArchMap = {
  branch: {
    'Windows x64': 'appveyor: win-x64-testing',
    'Windows ia32': 'appveyor: win-ia32-testing',
    'Windows Arm': 'appveyor: win-woa-testing',
  },
  main: {
    'Windows x64': 'appveyor: electron-x64-release',
    'Windows ia32': 'appveyor: electron-ia32-release',
    'Windows Arm': 'appveyor: win-woa-release',
  },
};

const formatLink = (name, url) => `\x1B]8;;${url}\x1B\\${name}\x1B]8;;\x1B\\`;

const getWorkflowID = (url) => url.pathname.replace('/workflow-run/', '');
const getBuildID = ({ pathname }) => {
  const index = pathname.lastIndexOf('/builds/') + 8;
  return pathname.substring(index, pathname.length);
};

const getType = (prs) => {
  // If there are no PRs, we're on a PR fork branch.
  if (prs.length === 0) return 'branch';

  const pr = prs[0];
  const isMain = pr.base.ref === 'main' && pr.base.ref === pr.head.ref;
  return isMain ? 'main' : 'branch';
};

const getArch = (url) => url.pathname.match(/(electron-[a-zA-Z0-9]*-testing)/)[0];

const printStatuses = (statuses, link) => {
  let result = '';
  for (const [name, check] of Object.entries(statuses)) {
    if (!check) {
      result += `  ⦿ ${chalk.bold(name)} - ${chalk.blue('Missing')}\n\n`;
      continue;
    }

    const status = getAppveyorStatusString(check);
    const url = new URL(check.target_url);

    if (link) {
      result += `  ⦿ ${chalk.bold(name)} - ${formatLink(status, url)} - ${getBuildID(url)}\n`;
    } else {
      result += ` ⦿ ${chalk.bold(name)} - ${status} - ${url}\n`;
    }

    if (check.jobs) {
      const failed = [];
      const succeeded = check.jobs.filter((j) => {
        const passed = j.status === 'success';
        if (!passed) failed.push(j);
        return passed;
      });

      if (succeeded.length) {
        const names = succeeded.map((s) => s.name);
        result +=
          succeeded.length === check.jobs.length
            ? '     ⦿ all jobs succeeded\n'
            : `     ⦿ ${colorForStatus('success')} ${names.join(', ')}\n`;
      }
      for (const job of failed) {
        const { jobId, name, status } = job;
        result += `     ⦿ ${colorForStatus(status)} - ${name} - ${jobId}\n`;
      }
    }
    result += '\n';
  }

  return result;
};

const parseRef = (ref) => {
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
  .option('-s|--show-jobs', 'Whether to also list the jobs for each workflow')
  .action(async (options) => {
    const electronDir = path.resolve(current().root, 'src', 'electron');
    const currentRef = execFileSync('git', ['branch', '--show-current'], { cwd: electronDir })
      .toString()
      .trim();

    const octokit = new Octokit({
      auth: await getGitHubAuthToken(['repo']),
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

      const { data } = await octokit.repos.listCommitStatusesForRef({
        repo: 'electron',
        owner: 'electron',
        ref,
      });

      const statuses = {};

      const prs = check_runs[0].pull_requests;
      const archTypes = appveyorArchMap[getType(prs)];

      for (const [name, arch] of Object.entries(archTypes)) {
        statuses[name] = data.find(
          ({ creator, context }) => creator.id === APPVEYOR_BOT_ID && context === arch,
        );
      }

      if (options.showJobs) {
        // Fetch jobs for Appveyor Workflows.
        for (const [name, check] of Object.entries(statuses)) {
          if (!check) continue;
          const url = new URL(check.target_url);
          const id = getBuildID(url);
          const arch = getArch(url);
          const {
            build: { jobs },
          } = await fetch(
            `https://ci.appveyor.com/api/projects/electron-bot/${arch}/builds/${id}`,
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${APPVEYOR_CLOUD_TOKEN}`,
              },
            },
          ).then((resp) => resp.json());
          statuses[name].jobs = jobs;
        }
      }

      console.log(`${chalk.bold('Electron CI Status')}
  ${chalk.bold('Ref')}: ${chalk.cyan(ref)}

  ${chalk.bold(chalk.bgBlue(chalk.white('Appveyor')))}
${printStatuses(statuses, !!options.link)}`);
    } catch (e) {
      fatal(e.message);
    }
  });

program.parse(process.argv);
