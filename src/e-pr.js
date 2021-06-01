#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');

const got = require('got');
const open = require('open');
const program = require('commander');

const evmConfig = require('./evm-config');
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

async function getPullRequestNotes(pullNumber) {
  let notes = null;

  const opts = {
    url: `https://api.github.com/repos/electron/electron/pulls/${pullNumber}`,
    responseType: 'json',
    throwHttpErrors: false,
  };
  try {
    const response = await got(opts);
    if (response.statusCode !== 200) {
      fatal(`Could not find PR: ${opts.url} got ${response.headers.status}`);
    }
    notes = findNoteInPRBody(response.body.body);
  } catch (error) {
    console.log(color.err, error);
  }

  return notes;
}

function guessPRTarget(config) {
  const filename = path.resolve(config.root, 'src', 'electron', 'package.json');
  const version = JSON.parse(fs.readFileSync(filename)).version;

  // Nightlies are only released off of main, so we can safely make this assumption
  if (version.includes('nightly')) return 'main';

  const versionPattern = /^(?<major>\d+)\.(?<minor>\d+)\.\d+.*$/;
  const match = versionPattern.exec(version);

  if (match) {
    return `${match.groups.major}-x-y`;
  }

  console.warn(
    `Unable to guess default target PR branch -- ${filename}'s version '${version}' should include 'nightly' or match ${versionPattern}`,
  );
}

function guessPRSource(config) {
  const command = 'git rev-parse --abbrev-ref HEAD';

  const cwd = path.resolve(config.root, 'src', 'electron');
  const options = { cwd, encoding: 'utf8' };

  return childProcess.execSync(command, options).trim();
}

function pullRequestSource(source) {
  const regexes = [
    /https:\/\/github.com\/(\S*)\/electron.git/,
    /git@github.com:(\S*)\/electron.git/,
  ];

  const config = evmConfig.current();

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

async function createPR(source, target, backport = undefined) {
  if (!source) {
    fatal(`'source' is required to create a PR`);
  } else if (!target) {
    fatal(`'target' is required to create a PR`);
  }

  const repoBaseUrl = 'https://github.com/electron/electron';
  const comparePath = `${target}...${pullRequestSource(source)}`;
  const queryParams = { expand: 1 };

  if (backport) {
    if (!/^\d+$/.test(backport)) {
      fatal(`${backport} is not a valid GitHub backport number - try again`);
    }

    const notes = (await getPullRequestNotes(backport)) || '';
    queryParams.body = `Backport of #${backport}.\n\nSee that PR for details.\n\nNotes: ${notes}`;
  }

  return open(`${repoBaseUrl}/compare/${comparePath}?${querystring.stringify(queryParams)}`);
}

let defaultTarget;
let defaultSource;
try {
  const config = evmConfig.current();
  defaultSource = guessPRSource(config);
  defaultTarget = guessPRTarget(config);
} catch {
  // we're just guessing defaults; it's OK to fail silently
}

program
  .description('Open a GitHub URL where you can PR your changes')
  .option('-s, --source <source_branch>', 'Where the changes are coming from', defaultSource)
  .option('-t, --target <target_branch>', 'Where the changes are going to', defaultTarget)
  .option('-b, --backport <pull_request>', 'Pull request being backported')
  .parse(process.argv);

createPR(program.source, program.target, program.backport);
