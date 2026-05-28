#!/usr/bin/env node

import * as childProcess from 'node:child_process';
import * as path from 'node:path';
import * as querystring from 'node:querystring';

import * as semver from 'semver';
import { Command } from 'commander';

const program = new Command();
import open from 'open';
import { current } from './evm-config.js';
import { downloadDist, DownloadDistOptions } from './utils/download-dist.js';
import { color, fatal } from './utils/logging.js';
import type { SanitizedConfig } from './types.js';

// Adapted from https://github.com/electron/clerk
export function findNoteInPRBody(body: string): string | null {
  const onelineMatch = /(?:(?:\r?\n)|^)notes: (.+?)(?:(?:\r?\n)|$)/gi.exec(body);
  const multilineMatch = /(?:(?:\r?\n)Notes:(?:\r?\n+)((?:\*.+(?:(?:\r?\n)|$))+))/gi.exec(body);

  let notes: string | null = null;
  if (onelineMatch?.[1]) {
    notes = onelineMatch[1];
  } else if (multilineMatch?.[1]) {
    notes = multilineMatch[1];
  }

  if (notes) {
    // Remove the default PR template.
    notes = notes.replace(/<!--.*?-->/g, '');
  }

  return notes ? notes.trim() : notes;
}

async function getPullRequestInfo(
  pullNumber: string,
): Promise<{ notes: string | null; title: string | null }> {
  let notes: string | null = null;
  let title: string | null = null;

  const url = `https://api.github.com/repos/electron/electron/pulls/${pullNumber}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      fatal(`Could not find PR: ${url} got ${response.status}`);
    }
    const data = (await response.json()) as { body: string; title: string };
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

function guessPRTarget(config: SanitizedConfig): string | undefined {
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
    `Unable to guess default target PR branch -- generated version '${version}' should include 'nightly' or be a valid semver string`,
  );
  return undefined;
}

function guessPRSource(config: SanitizedConfig): string {
  const command = 'git rev-parse --abbrev-ref HEAD';

  const cwd = path.resolve(config.root, 'src', 'electron');

  try {
    return childProcess.execSync(command, { cwd, encoding: 'utf8' }).trim();
  } catch {
    return 'main';
  }
}

function pullRequestSource(source: string): string {
  const regexes = [
    /https:\/\/github.com\/(\S*)\/electron.git/,
    /git@github.com:(\S*)\/electron.git/,
  ];

  const config = current();

  if (config.remotes.electron.fork) {
    const command = 'git remote get-url fork';
    const cwd = path.resolve(config.root, 'src', 'electron');
    const remoteUrl = childProcess.execSync(command, { cwd, encoding: 'utf8' }).trim();

    for (const regex of regexes) {
      const m = regex.exec(remoteUrl);
      if (m?.[1]) {
        return `${m[1]}:${source}`;
      }
    }
  }

  return source;
}

program
  .command('open', { isDefault: true })
  .description('Open a GitHub URL where you can PR your changes')
  .option('-s, --source [source_branch]', 'Where the changes are coming from')
  .option('-t, --target [target_branch]', 'Where the changes are going to')
  .option('-b, --backport <pull_request>', 'Pull request being backported')
  .action(async (options: { source?: string; target?: string; backport?: string }) => {
    const source = options.source ?? guessPRSource(current());
    const target = options.target ?? guessPRTarget(current());

    if (!source) {
      fatal(`'source' is required to create a PR`);
    } else if (!target) {
      fatal(`'target' is required to create a PR`);
    }

    const repoBaseUrl = 'https://github.com/electron/electron';
    const comparePath = `${target}...${pullRequestSource(source)}`;
    const queryParams: Record<string, string | number> = { expand: 1 };

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
      if (manualBranchTarget?.[1]) {
        options.backport = manualBranchTarget[1];
      }
    }

    if (options.backport) {
      if (!/^\d+$/.test(options.backport)) {
        fatal(`${options.backport} is not a valid GitHub backport number - try again`);
      }

      const { notes, title } = await getPullRequestInfo(options.backport);
      if (title) {
        queryParams['title'] = title;
      }
      queryParams['body'] = `Backport of #${
        options.backport
      }.\n\nSee that PR for details.\n\nNotes: ${notes ?? ''}`;
    }

    await open(`${repoBaseUrl}/compare/${comparePath}?${querystring.stringify(queryParams)}`);
  });

program
  .command('download-dist <pull_request_number>')
  .description('Download a pull request dist')
  .option(
    '--platform [platform]',
    'Platform to download dist for. Defaults to current platform.',
    process.platform,
  )
  .option(
    '--arch [arch]',
    'Architecture to download dist for. Defaults to current arch.',
    process.arch,
  )
  .option(
    '-o, --output <output_directory>',
    'Specify the output directory for downloaded artifacts. ' +
      'Defaults to ~/.electron_build_tools/artifacts/pr_{number}_{commithash}_{platform}_{arch}',
  )
  .option(
    '-s, --skip-confirmation',
    'Skip the confirmation prompt before downloading the dist.',
    !!process.env['CI'],
  )
  .action(async (pullRequestNumber: string, options: DownloadDistOptions) => {
    if (!pullRequestNumber) {
      fatal(`Pull request number is required to download a PR`);
    }

    await downloadDist(pullRequestNumber, options);
  });

if (import.meta.main) {
  program.parse(process.argv);
}
