#!/usr/bin/env node

import * as cp from 'node:child_process';
import * as path from 'node:path';

import { program } from 'commander';

import * as evmConfig from './evm-config.js';
import { color, fatal } from './utils/logging.js';
import open from 'open';

// 'feat: added foo (#1234)' --> 1234
export function getPullNumberFromSubject(subject: string): number | null {
  const pullNumberRegex = /^.*\s\(#(\d+)\)$/;
  const match = subject.match(pullNumberRegex);
  return match?.[1] ? Number.parseInt(match[1]) : null;
}

// abbrev-sha1 --> { pullNumber, sha1 }
function getCommitInfo(object: string): { pullNumber: number | null; sha1: string | null } {
  let pullNumber: number | null = null;
  let sha1: string | null = null;

  const cmd = 'git';
  const args = ['show', '--no-patch', '--pretty=format:%H%n%s', object];
  const result = cp.spawnSync(cmd, args, {
    cwd: path.resolve(evmConfig.current().root, 'src', 'electron'),
    encoding: 'utf8',
  });
  if (result.status === 0) {
    const lines = result.stdout.split('\n');
    sha1 = lines[0] ?? null;
    pullNumber = lines[1] ? getPullNumberFromSubject(lines[1]) : null;
  }

  return { pullNumber, sha1 };
}

// ask GitHub for a commit's pull request URLs
async function getPullURLsFromGitHub(sha1: string): Promise<string[]> {
  const ret: string[] = [];

  const url = `https://api.github.com/repos/electron/electron/commits/${sha1}/pulls`;
  const opts = {
    headers: {
      // https://developer.github.com/changes/2019-04-11-pulls-branches-for-commit/
      Accept: 'application/vnd.github.groot-preview+json',
    },
  };

  try {
    const response = await fetch(url, opts); // find the commit's PRs
    if (!response.ok) {
      fatal(`Could not open PR: ${url} got ${response.status}`);
    }
    const data = (await response.json()) as Array<{ html_url?: string }>;
    ret.push(...(data ?? []).map((pull) => pull.html_url).filter((u): u is string => !!u));
  } catch (error) {
    console.log(color.err, error);
  }

  return ret;
}

// get the pull request URLs for a git object or pull number
async function getPullURLs(ref: string): Promise<string[]> {
  const { pullNumber, sha1 } = getCommitInfo(ref);
  const makeURL = (num: number): string => `https://github.com/electron/electron/pull/${num}`;

  if (pullNumber) {
    return [makeURL(pullNumber)];
  }

  if (sha1) {
    return getPullURLsFromGitHub(sha1);
  }

  const parsed = Number.parseInt(ref, 10);
  if (Number.isSafeInteger(parsed)) {
    return [makeURL(parsed)];
  }

  console.log(`${color.err} ${color.cmd(ref)} is not a git object or pull request number`);
  return [];
}

async function doOpen(opts: { object: string; print: boolean }): Promise<void> {
  const urls = await getPullURLs(opts.object);

  if (urls.length === 0) {
    console.log(`${color.err} No PRs found for ${opts.object}`);
    return;
  }

  for (const url of urls) {
    if (opts.print) {
      console.log(url);
    } else {
      void open(url);
    }
  }
}

program
  .argument('<sha1|PR#>')
  .description('Open a GitHub URL for the given commit hash / pull # / issue #')
  .option('--print', 'Print the URL instead of opening it', false)
  .action((name: string, options: { print: boolean }) => {
    void doOpen({ object: name, print: options.print });
  });

if (require.main === module) {
  program.parse(process.argv);
}
