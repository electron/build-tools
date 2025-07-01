#!/usr/bin/env node

import { Octokit } from '@octokit/rest';
import chalk from 'chalk';
import { program } from 'commander';
import fs from 'node:fs';
import inquirer from 'inquirer';
import path from 'node:path';
import os from 'node:os';

import * as evmConfig from './evm-config.js';
import { depotSpawnSync } from './utils/depot-tools.js';
import { getGerritPatchDetailsFromURL } from './utils/gerrit.js';
import { getGitHubAuthToken } from './utils/github-auth.js';
import { color, fatal } from './utils/logging.js';
import { EVMBaseElectronConfiguration } from './evm-config.schema.js';
import { SpawnSyncOptions } from 'node:child_process';

const ELECTRON_BOT_EMAIL = 'electron-bot@users.noreply.github.com';
const ELECTRON_BOT_NAME = 'Electron Bot';
const ELECTRON_REPO_DATA = {
  owner: 'electron',
  repo: 'electron',
};
const DEPS_REGEX = new RegExp(`chromium_version':\n +'(.+?)',`, 'm');
const CL_REGEX = /https:\/\/chromium-review\.googlesource\.com\/c\/chromium\/src\/\+\/(\d+)/;

async function getChromiumVersion(octokit: Octokit, ref: string) {
  const { data } = await octokit.repos.getContent({
    ...ELECTRON_REPO_DATA,
    path: 'DEPS',
    ref,
  });

  if (!('content' in data) || !data.content) {
    fatal('Could not read content of PR');
    return;
  }

  const [, version] = DEPS_REGEX.exec(Buffer.from(data.content, 'base64').toString('utf8')) ?? [];

  return version || null;
}

// Copied from https://github.com/electron/electron/blob/3a3595f2af59cb08fb09e3e2e4b7cdf713db2b27/script/release/notes/notes.ts#L605-L623
const compareChromiumVersions = (v1: string, v2: string): 1 | -1 | 0 => {
  const [split1, split2] = [v1.split('.'), v2.split('.')];

  if (split1.length !== split2.length) {
    throw new Error(
      `Expected version strings to have same number of sections: ${split1} and ${split2}`,
    );
  }
  for (let i = 0; i < split1.length; i++) {
    const p1 = parseInt(split1[i], 10);
    const p2 = parseInt(split2[i], 10);

    if (p1 > p2) return 1;
    else if (p1 < p2) return -1;
    // Continue checking the value if this portion is equal
  }

  return 0;
};

function gitCommit(
  config: EVMBaseElectronConfiguration,
  commitMessage: string,
  opts: SpawnSyncOptions,
  fatalMessage: string,
) {
  depotSpawnSync(
    config,
    'git',
    [
      'commit',
      '--no-verify', // There's a bug on Windows that creates incorrect changes
      '-m',
      os.platform() === 'win32' ? `"${commitMessage}"` : commitMessage,
    ],
    opts,
    fatalMessage,
  );
}

program
  .arguments('<roll-pr> [chromium-version]')
  .description('Attempts to reconstruct an intermediate Chromium version from a roll PR')
  .option('--sort', 'Sort cherry-picked commits by CL merge time', false)
  .option(
    '--merge-strategy-option',
    'Git merge strategy option to use when cherry-picking',
    'theirs',
  )
  .action(async (prNumberStr, chromiumVersionStr, options) => {
    const prNumber = parseInt(prNumberStr, 10);
    if (isNaN(prNumber) || `${prNumber}` !== prNumberStr) {
      fatal(`rcv requires a PR number, "${prNumberStr}" was provided`);
    }

    const octokit = new Octokit({
      auth: await getGitHubAuthToken(['repo']),
    });
    const { data: pr } = await octokit.pulls.get({
      ...ELECTRON_REPO_DATA,
      pull_number: prNumber,
    });
    if (!pr.merge_commit_sha) {
      fatal('No merge SHA available on PR');
    }

    const initialVersion = await getChromiumVersion(octokit, pr.base.sha);
    if (!initialVersion) {
      fatal('Could not find initial Chromium version in PR base');
    }
    const newVersion = await getChromiumVersion(octokit, pr.head.sha);
    if (!newVersion) {
      fatal('Could not find new Chromium version in PR head');
    }

    if (initialVersion === newVersion) {
      fatal('Does not look like a Chromium roll PR');
    }

    // Versions in the roll PR might span multiple milestones
    const milestones = new Set([initialVersion.split('.')[0], newVersion.split('.')[0]]);

    // Grab all releases for the milestone(s)
    const chromiumVersions = [];

    for (const milestone of milestones) {
      const milestoneVersions = new Set(
        await fetch(
          `https://chromiumdash.appspot.com/fetch_releases?channel=Canary&platform=Linux,Mac,Win32,Windows&milestone=${milestone}&num=1000`,
        )
          .then((resp) => resp.json() as Promise<{ version: string }[]>)
          .then((versions) => versions.map(({ version }) => version)),
      );
      chromiumVersions.push(...milestoneVersions);
    }

    if (chromiumVersionStr !== undefined) {
      if (
        compareChromiumVersions(chromiumVersionStr, initialVersion) < 0 ||
        compareChromiumVersions(chromiumVersionStr, newVersion) > 0
      ) {
        fatal(
          `Chromium version ${chalk.blueBright(chromiumVersionStr)} is not between ${chalk.blueBright(initialVersion)} and ${chalk.blueBright(newVersion)}`,
        );
        return;
      }

      // Confirm chromiumVersionStr is a tagged Chromium version
      if (!chromiumVersions.includes(chromiumVersionStr)) {
        fatal(`Version ${chalk.blueBright(chromiumVersionStr)} is not a tagged Chromium version`);
        return;
      }
    } else {
      // User did not provide a Chromium version, so let them choose
      const { version } = await inquirer.prompt([
        {
          type: 'list',
          name: 'version',
          message: 'Which Chromium version do you want to reconstruct?',
          choices: chromiumVersions.filter(
            (version) =>
              compareChromiumVersions(version, initialVersion) > 0 &&
              compareChromiumVersions(version, newVersion) < 0,
          ),
        },
      ]);
      chromiumVersionStr = version;
    }

    const config = evmConfig.current();
    const spawnOpts = {
      cwd: path.resolve(config.root, 'src', 'electron'),
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: ELECTRON_BOT_EMAIL,
        GIT_AUTHOR_NAME: ELECTRON_BOT_NAME,
        GIT_COMMITTER_EMAIL: ELECTRON_BOT_EMAIL,
        GIT_COMMITTER_NAME: ELECTRON_BOT_NAME,
      },
    } as const;
    const gitStatusResult = depotSpawnSync(config, 'git', ['status', '--porcelain'], spawnOpts);
    if (gitStatusResult.status !== 0 || gitStatusResult.stdout.toString().trim().length !== 0) {
      fatal(
        "Your current git working directory is not clean, we won't erase your local changes. Clean it up and try again",
      );
      return;
    }

    // Checkout the parent of the merge commit if it was merged, else the base SHA
    let targetSha = pr.base.sha;

    if (pr.merged) {
      const { data: mergeCommit } = await octokit.git.getCommit({
        ...ELECTRON_REPO_DATA,
        commit_sha: pr.merge_commit_sha,
      });
      if (mergeCommit.parents.length !== 1) {
        fatal('Expected merge commit to have one parent');
        return;
      }
      targetSha = mergeCommit.parents[0].sha;
    }

    depotSpawnSync(
      config,
      'git',
      ['fetch', 'origin', targetSha],
      spawnOpts,
      'Failed to fetch upstream base',
    );
    depotSpawnSync(
      config,
      'git',
      ['checkout', targetSha],
      spawnOpts,
      'Failed to checkout base commit',
    );

    const rcvBranch = `rcv/pr/${prNumber}/version/${chromiumVersionStr}`;
    depotSpawnSync(config, 'git', ['branch', '-D', rcvBranch], spawnOpts);
    depotSpawnSync(
      config,
      'git',
      ['checkout', '-b', rcvBranch],
      spawnOpts,
      `Failed to checkout new branch "${rcvBranch}"`,
    );

    depotSpawnSync(
      config,
      'yarn',
      ['install'],
      spawnOpts,
      'Failed to do "yarn install" on new branch',
    );

    // Update the Chromium version in DEPS
    const regexToReplace = new RegExp(`(chromium_version':\n +').+?',`, 'gm');
    const content = await fs.promises.readFile(path.resolve(spawnOpts.cwd, 'DEPS'), 'utf8');
    const newContent = content.replace(regexToReplace, `$1${chromiumVersionStr}',`);
    await fs.promises.writeFile(path.resolve(spawnOpts.cwd, 'DEPS'), newContent, 'utf8');

    // Make a commit with this change
    depotSpawnSync(config, 'git', ['add', 'DEPS'], spawnOpts, 'Failed to add DEPS file for commit');
    gitCommit(
      config,
      `chore: bump chromium to ${chromiumVersionStr}`,
      spawnOpts,
      'Failed to commit DEPS file change',
    );

    const { data: commits } = await octokit.pulls.listCommits({
      ...ELECTRON_REPO_DATA,
      pull_number: prNumber,
    });

    const commitsToCherryPick = [];

    for (const commit of commits) {
      const shortSha = commit.sha.substring(0, 7);
      const message = commit.commit.message.split('\n')[0];
      const clMatch = CL_REGEX.exec(commit.commit.message);

      if (clMatch) {
        const parsedUrl = new URL(clMatch[0]);
        const { shortCommit: chromiumShortSha } = await getGerritPatchDetailsFromURL(
          parsedUrl,
          false,
        );
        const { commits: chromiumCommits } = await fetch(
          `https://chromiumdash.appspot.com/fetch_commits?commit=${chromiumShortSha}`,
        ).then((resp) => resp.json() as Promise<{ commits: { earliest: string; time: number }[] }>);
        if (chromiumCommits.length !== 1) {
          fatal(`Expected to find exactly one commit for SHA "${chromiumShortSha}"`);
        }
        // Grab the earliest Chromium version the CL was released in, and the merge time
        const { earliest, time } = chromiumCommits[0];

        // Only cherry pick the commit if the earliest version is within target version
        if (compareChromiumVersions(earliest, chromiumVersionStr) <= 0) {
          console.log(
            `${color.success} Cherry-picking CL commit: ${chalk.yellow(shortSha)} ${message} (${chalk.greenBright(earliest)})`,
          );
          commitsToCherryPick.push({ sha: commit.sha, chromiumVersion: earliest, mergeTime: time });
        } else {
          console.info(
            `${color.info} Skipping CL commit: ${chalk.yellow(shortSha)} ${message} (${chalk.greenBright(earliest)})`,
          );
        }
      } else {
        console.info(`${color.info} Skipping non-CL commit: ${chalk.yellow(shortSha)} ${message}`);
      }
    }

    // Optionally reorder the commits by the merge time of their CL
    if (options.sort) {
      commitsToCherryPick.sort((a, b) => a.mergeTime - b.mergeTime);
    }

    for (const commit of commitsToCherryPick) {
      depotSpawnSync(
        config,
        'git',
        ['fetch', 'origin', commit.sha],
        spawnOpts,
        'Failed to fetch commit to cherry-pick',
      );
      depotSpawnSync(
        config,
        'git',
        [
          'cherry-pick',
          '--allow-empty',
          `--strategy-option=${options.mergeStrategyOption}`,
          commit.sha,
        ],
        spawnOpts,
        `Failed to cherry-pick commit "${commit.sha}"`,
      );
    }

    // Update filenames now that the commits have been cherry-picked
    depotSpawnSync(
      config,
      'node',
      ['script/gen-hunspell-filenames.js'],
      spawnOpts,
      'Failed to generate hunspell filenames',
    );
    const hunspellGitStatusResult = depotSpawnSync(
      config,
      'git',
      ['status', '--porcelain'],
      spawnOpts,
    );
    if (
      hunspellGitStatusResult.status !== 0 ||
      hunspellGitStatusResult.stdout.toString().trim().length !== 0
    ) {
      depotSpawnSync(
        config,
        'git',
        ['add', 'filenames.hunspell.gni'],
        spawnOpts,
        'Failed to add files for commit',
      );
      gitCommit(
        config,
        'chore: node script/gen-hunspell-filenames.js',
        spawnOpts,
        'Failed to commit generated filename changes',
      );
    }

    depotSpawnSync(
      config,
      'node',
      ['script/gen-libc++-filenames.js'],
      spawnOpts,
      'Failed to generate libc++ filenames',
    );
    const genLibCxxStatusResult = depotSpawnSync(
      config,
      'git',
      ['status', '--porcelain'],
      spawnOpts,
    );
    if (
      genLibCxxStatusResult.status !== 0 ||
      genLibCxxStatusResult.stdout.toString().trim().length !== 0
    ) {
      depotSpawnSync(
        config,
        'git',
        ['add', 'filenames.libcxx.gni', 'filenames.libcxxabi.gni'],
        spawnOpts,
        'Failed to add files for commit',
      );
      gitCommit(
        config,
        'chore: node script/gen-libc++-filenames.js',
        spawnOpts,
        'Failed to commit generated filename changes',
      );
    }
  });

program.parse(process.argv);
