#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');
const querystring = require('querystring');
const semver = require('semver');

const open = require('open');
const program = require('commander');

const { current } = require('./evm-config');
const { color, fatal } = require('./utils/logging');

// Adapted from https://github.com/electron/clerk
function findNoteInPRBody(body) {
  const onelineMatch = /(?:(?:\r?\n)|^)notes: (.+?)(?:(?:\r?\n)|$)/gi.exec(body);
  const multilineMatch = /(?:(?:\r?\n)Notes:(?:\r?\n+)((?:\*.+(?:(?:\r?\n)|$))+))/gi.exec(body);

  let notes = null;
  if (onelineMatch && onelineMatch[1]) {
    notes = onelineMatch[1];
  } else if (multilineMatch && multilineMatch[1]) {
    notes = multilineMatch[1];
  }

  if (notes) {
    // Remove the default PR template.
    notes = notes.replace(/<!--.*?-->/g, '');
  }

  return notes ? notes.trim() : notes;
}

async function getPullRequestInfo(pullNumber) {
  let notes = null;
  let title = null;

  const url = `https://api.github.com/repos/electron/electron/pulls/${pullNumber}`;
  const opts = {
    responseType: 'json',
    throwHttpErrors: false,
  };
  try {
    const response = await fetch(url, opts);
    if (!response.ok) {
      fatal(`Could not find PR: ${url} got ${response.status}`);
    }
    const data = await response.json();
    notes = findNoteInPRBody(data.body);
    title = data.title;
  } catch (error) {
    console.log(color.err, error);
  }

  return {
    notes,
    title,
  };
}

function guessPRTarget(config) {
  const electronDir = path.resolve(config.root, 'src', 'electron');
  if (process.cwd() !== electronDir) {
    fatal(`You must be in an Electron repository to guess the default target PR branch`);
  }

  let script = path.resolve(electronDir, 'script', 'lib', 'get-version.js');

  if (process.platform === 'win32') {
    script = script.replace(new RegExp(/\\/, 'g'), '\\\\');
  }
  const version = childProcess
    .execSync(`node -p "require('${script}').getElectronVersion()"`)
    .toString()
    .trim();

  const latestVersion = childProcess
    .execSync('git describe --tags `git rev-list --tags --max-count=1`')
    .toString()
    .trim();

  // Nightlies are only released off of main, so we can safely make this assumption.
  // However, if the nearest reachable tag from this commit is also the latest tag
  // across all branches, and neither is a nightly, we're in the small time window
  // between a stable release and the next nightly, and should also target main.
  const inNightlyWindow = !version.includes('nightly') && version === latestVersion;
  if (version.includes('nightly') || inNightlyWindow) return 'main';

  const match = semver.valid(version);
  if (match) {
    return `${semver.major(match)}-x-y`;
  }

  console.warn(
    `Unable to guess default target PR branch -- generated version '${version}' should include 'nightly' or match ${versionPattern}`,
  );
}

function guessPRSource(config) {
  const command = 'git rev-parse --abbrev-ref HEAD';

  const cwd = path.resolve(config.root, 'src', 'electron');
  const options = { cwd, encoding: 'utf8' };

  try {
    return childProcess.execSync(command, options).trim();
  } catch {
    return 'main';
  }
}

function pullRequestSource(source) {
  const regexes = [
    /https:\/\/github.com\/(\S*)\/electron.git/,
    /git@github.com:(\S*)\/electron.git/,
  ];

  const config = current();

  if (config.remotes.electron.fork) {
    const command = 'git remote get-url fork';
    const cwd = path.resolve(config.root, 'src', 'electron');
    const options = { cwd, encoding: 'utf8' };
    const remoteUrl = childProcess.execSync(command, options).trim();

    for (const regex of regexes) {
      if (regex.test(remoteUrl)) {
        return `${regex.exec(remoteUrl)[1]}:${source}`;
      }
    }
  }

  return source;
}

program
  .description('Open a GitHub URL where you can PR your changes')
  .option(
    '-s, --source <source_branch>',
    'Where the changes are coming from',
    guessPRSource(current()),
  )
  .option(
    '-t, --target <target_branch>',
    'Where the changes are going to',
    guessPRTarget(current()),
  )
  .option('-b, --backport <pull_request>', 'Pull request being backported')
  .action(async (options) => {
    if (!options.source) {
      fatal(`'source' is required to create a PR`);
    } else if (!options.target) {
      fatal(`'target' is required to create a PR`);
    }

    const repoBaseUrl = 'https://github.com/electron/electron';
    const comparePath = `${options.target}...${pullRequestSource(options.source)}`;
    const queryParams = { expand: 1 };

    if (!options.backport) {
      const currentBranchResult = childProcess.spawnSync(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        {
          cwd: path.resolve(current().root, 'src', 'electron'),
        },
      );
      const currentBranch = currentBranchResult.stdout.toString().trim();
      const manualBranchPattern = /^manual-bp\/[^\/]+\/pr\/([0-9]+)\/branch\/[^\/]+$/;
      const manualBranchTarget = manualBranchPattern.exec(currentBranch);
      if (manualBranchTarget) {
        options.backport = manualBranchTarget[1];
      }
    }

    if (options.backport) {
      if (!/^\d+$/.test(options.backport)) {
        fatal(`${options.backport} is not a valid GitHub backport number - try again`);
      }

      const { notes, title } = await getPullRequestInfo(options.backport);
      if (title) {
        queryParams.title = title;
      }
      queryParams.body = `Backport of #${
        options.backport
      }.\n\nSee that PR for details.\n\nNotes: ${notes || ''}`;
    }

    return open(`${repoBaseUrl}/compare/${comparePath}?${querystring.stringify(queryParams)}`);
  })
  .parse(process.argv);
