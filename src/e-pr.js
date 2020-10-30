#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const open = require('open');
const program = require('commander');

const evmConfig = require('./evm-config');

function guessPRTarget(config) {
  const filename = path.resolve(config.root, 'src', 'electron', 'package.json');
  const version = JSON.parse(fs.readFileSync(filename)).version;

  // Nightlies are only released off of master, so we can safely make this assumption
  if (version.includes('nightly')) return 'master';

  const versionPattern = /^(\d+)\.(\d+)\.\d+.*$/;
  const match = versionPattern.exec(version);

  if (match) {
    const [major, minor] = [match[1], match[2]];

    //TODO(codebytere): remove this conditional when 7-1-x is EOL
    return parseInt(major, 10) >= 8 ? `${major}-x-y` : `${major}-${minor}-x`;
  }

  console.warn(
    `Unable to guess default target PR branch -- ${filename}'s version '${version}' should include 'nightly' or match ${pattern}`,
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
  .parse(process.argv);

open(
  `https://github.com/electron/electron/compare/${program.target}...${pullRequestSource(
    program.source,
  )}?expand=1`,
);
