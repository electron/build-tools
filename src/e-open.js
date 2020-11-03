#!/usr/bin/env node

const cp = require('child_process');
const got = require('got');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config.js');
const { color, fatal } = require('./utils/logging');

// 'feat: added foo (#1234)' --> 1234
function getPullNumberFromSubject(subject) {
  const pullNumberRegex = /^.*\s\(#(\d+)\)$/;
  const match = subject.match(pullNumberRegex);
  return match ? Number.parseInt(match[1]) : null;
}

// abbrev-sha1 --> { pullNumber, sha1 }
function getCommitInfo(object) {
  let pullNumber = null;
  let sha1 = null;

  const cmd = 'git';
  const args = ['show', '--no-patch', '--pretty=format:%H%n%s', object];
  const opts = {
    cwd: path.resolve(evmConfig.current().root, 'src', 'electron'),
    encoding: 'utf8',
  };

  const result = cp.spawnSync(cmd, args, opts);
  if (result.status === 0) {
    const lines = result.stdout.split('\n');
    sha1 = lines[0];
    pullNumber = getPullNumberFromSubject(lines[1]);
  }

  return { pullNumber, sha1 };
}

// ask GitHub for a commit's pull request URLs
async function getPullURLsFromGitHub(sha1) {
  const ret = [];

  const opts = {
    url: `https://api.github.com/repos/electron/electron/commits/${sha1}/pulls`,
    responseType: 'json',
    headers: {
      // https://developer.github.com/changes/2019-04-11-pulls-branches-for-commit/
      Accept: 'application/vnd.github.groot-preview+json',
    },
  };
  try {
    const response = await got(opts); // find the commit's PRs
    if (response.statusCode !== 200) {
      fatal(`Could not open PR: ${opts.url} got ${response.headers.status}`);
    }
    ret.push(...(response.body || []).map(pull => pull.html_url).filter(url => !!url));
  } catch (error) {
    console.log(color.err, error);
  }

  return ret;
}

// get the pull request URLs for a git object or pull number
async function getPullURLs(ref) {
  const { pullNumber, sha1 } = getCommitInfo(ref);
  const makeURL = num => `https://github.com/electron/electron/pull/${num}`;

  if (pullNumber) {
    return [makeURL(pullNumber)];
  }

  if (sha1) {
    return await getPullURLsFromGitHub(sha1);
  }

  const parsed = Number.parseInt(ref);
  if (Number.isSafeInteger(parsed)) {
    return [makeURL(parsed)];
  }

  console.log(`${color.err} ${color.cmd(ref)} is not a git object or pull request number`);
  return [];
}

async function doOpen(opts) {
  const urls = await getPullURLs(opts.object);

  if (urls.length === 0) {
    console.log(`${color.err} No PRs found for ${opts.object}`);
    return;
  }

  const open = require('open');
  for (const url of urls) {
    if (opts.print) {
      console.log(url);
    } else {
      open(url);
    }
  }
}

let name;
let options;

program
  .arguments('<sha1|PR#>')
  .description('Open a GitHub URL for the given commit hash / pull # / issue #')
  .option('--print', 'Print the URL instead of opening it', false)
  .action((name_in, options_in) => {
    name = name_in;
    options = options_in;
  })
  .parse(process.argv);

doOpen({ object: name, print: options.print });
