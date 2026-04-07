#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { styleText } from 'node:util';

import * as inquirer from '@inquirer/prompts';
import { Octokit } from '@octokit/rest';
import { program } from 'commander';

import * as evmConfig from './evm-config.js';
import { spawnSync, type DepotOpts } from './utils/depot-tools.js';
import { getGerritPatchDetailsFromURL } from './utils/gerrit.js';
import { getGitHubAuthToken } from './utils/github-auth.js';
import { color, fatal } from './utils/logging.js';
import type { SanitizedConfig } from './types.js';

const ELECTRON_BOT_EMAIL = 'electron-bot@users.noreply.github.com';
const ELECTRON_BOT_NAME = 'Electron Bot';
const ELECTRON_REPO_DATA = {
  owner: 'electron',
  repo: 'electron',
};
const DEPS_REGEX = new RegExp(`chromium_version':\n +'(.+?)',`, 'm');
const CL_REGEX =
  /https:\/\/chromium-review\.googlesource\.com\/c\/(chromium\/src|devtools\/devtools-frontend|v8\/v8)\/\+\/(\d+)(#\S+)?/;

const REPO_LABELS: Record<string, string> = {
  chromium: styleText('magenta', 'Chromium'),
  devtools: styleText('blue', 'DevTools'),
  v8: styleText('cyan', 'V8'),
};

async function getChromiumVersion(octokit: Octokit, ref: string): Promise<string> {
  const { data } = await octokit.repos.getContent({
    ...ELECTRON_REPO_DATA,
    path: 'DEPS',
    ref,
  });

  if (!('content' in data) || !data.content) {
    fatal('Could not read content of PR');
  }

  const match = DEPS_REGEX.exec(Buffer.from(data.content, 'base64').toString('utf8'));
  if (!match?.[1]) {
    fatal('Could not parse Chromium version from DEPS');
  }

  return match[1];
}

// Copied from https://github.com/electron/electron/blob/3a3595f2af59cb08fb09e3e2e4b7cdf713db2b27/script/release/notes/notes.ts#L605-L623
export const compareChromiumVersions = (v1: string, v2: string): number => {
  const [split1, split2] = [v1.split('.'), v2.split('.')];

  if (split1.length !== split2.length) {
    throw new Error(
      `Expected version strings to have same number of sections: ${split1} and ${split2}`,
    );
  }
  for (let i = 0; i < split1.length; i++) {
    const p1 = parseInt(split1[i] ?? '0', 10);
    const p2 = parseInt(split2[i] ?? '0', 10);

    if (p1 > p2) return 1;
    else if (p1 < p2) return -1;
    // Continue checking the value if this portion is equal
  }

  return 0;
};

function gitCommit(
  config: SanitizedConfig,
  commitMessage: string,
  opts: Partial<DepotOpts>,
  fatalMessage: string,
): void {
  spawnSync(
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

interface ChromiumDashCommit {
  earliest: string;
  relations: Array<{ from_commit: string; to_commit: string }>;
  time: number;
}

async function fetchChromiumDashCommit(
  commitSha: string,
  repo: string,
): Promise<ChromiumDashCommit> {
  const resp = await fetch(
    `https://chromiumdash.appspot.com/fetch_commit?commit=${commitSha}&repo=${repo}`,
  );
  if (!resp.ok) {
    fatal(`Failed to fetch commit details for SHA "${commitSha}"`);
  }

  // Grab the earliest Chromium version the CL was released in, relations, and the merge time
  const { earliest, relations, time } = (await resp.json()) as ChromiumDashCommit;

  return { earliest, relations, time };
}

interface RcvOptions {
  sort: boolean;
  mergeStrategyOption: string;
}

program
  .arguments('<roll-pr> [chromium-version-or-sha]')
  .description('Attempts to reconstruct an intermediate Chromium version from a roll PR')
  .option('--sort', 'Sort cherry-picked commits by CL merge time', false)
  .option(
    '--merge-strategy-option',
    'Git merge strategy option to use when cherry-picking',
    'theirs',
  )
  .action(
    async (
      prNumberStr: string,
      chromiumVersionOrCommitShaStr: string | undefined,
      options: RcvOptions,
    ) => {
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

      const initialVersion = await getChromiumVersion(octokit, pr.base.sha);
      const newVersion = await getChromiumVersion(octokit, pr.head.sha);

      if (initialVersion === newVersion) {
        fatal('Does not look like a Chromium roll PR');
      }

      // Versions in the roll PR might span multiple milestones
      const firstMilestone = initialVersion.split('.')[0];
      const lastMilestone = newVersion.split('.')[0];
      if (!firstMilestone || !lastMilestone) {
        fatal('Could not parse milestone from Chromium version');
      }
      const milestones = new Set([firstMilestone, lastMilestone]);

      // Grab all releases for the milestone(s)
      const chromiumVersions: string[] = [];

      for (const milestone of milestones) {
        const releases = (await fetch(
          `https://chromiumdash.appspot.com/fetch_releases?channel=Canary&platform=Linux,Mac,Win32,Windows&milestone=${milestone}&num=1000`,
        ).then((resp) => resp.json())) as Array<{ version: string }>;
        const milestoneVersions = new Set(releases.map(({ version }) => version));
        chromiumVersions.push(...milestoneVersions);
      }

      let usingCommitSha = false;

      if (chromiumVersionOrCommitShaStr !== undefined) {
        if (/^\d+\.\d+\.\d+/.test(chromiumVersionOrCommitShaStr)) {
          if (
            compareChromiumVersions(chromiumVersionOrCommitShaStr, initialVersion) < 0 ||
            compareChromiumVersions(chromiumVersionOrCommitShaStr, newVersion) > 0
          ) {
            fatal(
              `Chromium version ${styleText('blueBright', chromiumVersionOrCommitShaStr)} is not between ${styleText('blueBright', initialVersion)} and ${styleText('blueBright', newVersion)}`,
            );
          }

          // Confirm chromiumVersionOrCommitShaStr is a tagged Chromium version
          if (!chromiumVersions.includes(chromiumVersionOrCommitShaStr)) {
            fatal(
              `Version ${styleText('blueBright', chromiumVersionOrCommitShaStr)} is not a tagged Chromium version`,
            );
          }
        } else if (/^[0-9a-f]+$/.test(chromiumVersionOrCommitShaStr)) {
          // Assume it's a commit SHA, and verify it falls within the range
          const { earliest } = await fetchChromiumDashCommit(
            chromiumVersionOrCommitShaStr,
            'chromium',
          );

          if (
            compareChromiumVersions(earliest, initialVersion) < 0 ||
            compareChromiumVersions(earliest, newVersion) > 0
          ) {
            fatal(
              `Chromium commit ${styleText('blueBright', chromiumVersionOrCommitShaStr)} is not between ${styleText('blueBright', initialVersion)} and ${styleText('blueBright', newVersion)}`,
            );
          }

          usingCommitSha = true;
        } else {
          fatal(
            `Provided value ${styleText('blueBright', chromiumVersionOrCommitShaStr)} does not appear to be a valid Chromium version or commit SHA`,
          );
        }
      } else {
        const choices = chromiumVersions
          .filter(
            (version) =>
              compareChromiumVersions(version, initialVersion) > 0 &&
              compareChromiumVersions(version, newVersion) < 0,
          )
          .map((version) => ({ value: version }));

        // User did not provide a Chromium version, so let them choose
        const version = await inquirer.select({
          message: 'Which Chromium version do you want to reconstruct?',
          choices: [...choices, new inquirer.Separator()],
        });
        chromiumVersionOrCommitShaStr = version;
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
      } satisfies Partial<DepotOpts>;
      const gitStatusResult = spawnSync(config, 'git', ['status', '--porcelain'], spawnOpts);
      if (gitStatusResult.status !== 0 || gitStatusResult.stdout.toString().trim().length !== 0) {
        fatal(
          "Your current git working directory is not clean, we won't erase your local changes. Clean it up and try again",
        );
      }

      // Checkout the parent of the merge commit if it was merged, else the base SHA
      let targetSha = pr.base.sha;

      if (pr.merged) {
        if (!pr.merge_commit_sha) {
          fatal('No merge SHA available on PR');
        }
        const { data: mergeCommit } = await octokit.git.getCommit({
          ...ELECTRON_REPO_DATA,
          commit_sha: pr.merge_commit_sha,
        });
        if (mergeCommit.parents.length !== 1) {
          fatal('Expected merge commit to have one parent');
        }
        const parent = mergeCommit.parents[0];
        if (!parent) {
          fatal('Merge commit parent is missing');
        }
        targetSha = parent.sha;
      }

      spawnSync(
        config,
        'git',
        ['fetch', 'origin', targetSha],
        spawnOpts,
        'Failed to fetch upstream base',
      );
      spawnSync(
        config,
        'git',
        ['checkout', targetSha],
        spawnOpts,
        'Failed to checkout base commit',
      );

      const rcvBranch = `rcv/pr/${prNumber}/version/${chromiumVersionOrCommitShaStr}`;
      spawnSync(config, 'git', ['branch', '-D', rcvBranch], spawnOpts);
      spawnSync(
        config,
        'git',
        ['checkout', '-b', rcvBranch],
        spawnOpts,
        `Failed to checkout new branch "${rcvBranch}"`,
      );

      spawnSync(
        config,
        'yarn',
        ['install'],
        spawnOpts,
        'Failed to do "yarn install" on new branch',
      );

      // Update the Chromium version in DEPS
      const regexToReplace = new RegExp(`(chromium_version':\n +').+?',`, 'gm');
      const content = await fs.promises.readFile(path.resolve(spawnOpts.cwd, 'DEPS'), 'utf8');
      const newContent = content.replace(regexToReplace, `$1${chromiumVersionOrCommitShaStr}',`);
      await fs.promises.writeFile(path.resolve(spawnOpts.cwd, 'DEPS'), newContent, 'utf8');

      // Make a commit with this change
      spawnSync(config, 'git', ['add', 'DEPS'], spawnOpts, 'Failed to add DEPS file for commit');
      gitCommit(
        config,
        `chore: bump chromium to ${chromiumVersionOrCommitShaStr}`,
        spawnOpts,
        'Failed to commit DEPS file change',
      );

      const commits = await octokit.paginate(octokit.pulls.listCommits, {
        ...ELECTRON_REPO_DATA,
        pull_number: prNumber,
      });

      const commitsToCherryPick: Array<{
        sha: string;
        chromiumVersion: string;
        mergeTime: number;
      }> = [];
      const chromiumCommitLog: Array<{ commit: string }> = [];

      if (usingCommitSha) {
        // Pull the commit log from the initial version up until the provided commit SHA
        const maxCommits = 10000;
        const textResponse = await fetch(
          `https://chromium.googlesource.com/chromium/src/+log/${initialVersion}..${chromiumVersionOrCommitShaStr}?n=${maxCommits}&format=JSON`,
        ).then((resp) => resp.text());

        if (textResponse.startsWith(")]}'")) {
          const parsed = JSON.parse(textResponse.substring(4)) as {
            log: Array<{ commit: string }>;
          };
          chromiumCommitLog.push(...parsed.log);

          if (chromiumCommitLog.length === maxCommits) {
            fatal('Too many commits in Chromium commit log');
          }
        } else {
          fatal('Unexpected response from Chromium commit log fetch');
        }
      }

      for (const commit of commits) {
        const shortSha = commit.sha.substring(0, 7);
        const message = commit.commit.message.split('\n')[0] ?? '';

        const clMatch = CL_REGEX.exec(commit.commit.message);

        if (!clMatch?.[1]) {
          console.info(
            `${color.info} Skipping non-CL commit: ${styleText('yellow', shortSha)} ${message}`,
          );
          continue;
        }

        const repo = clMatch[1].split('/')[0];
        if (!repo) {
          console.info(`${color.err} Couldn't parse repo from CL URL`);
          continue;
        }
        const label = REPO_LABELS[repo] ?? repo;

        const parsedUrl = new URL(clMatch[0]);

        let clCommitSha: string | undefined;
        let earliest: string;
        let time: number;

        try {
          const { commitId } = await getGerritPatchDetailsFromURL(parsedUrl);
          let relations: Array<{ from_commit: string; to_commit: string }>;
          ({ earliest, relations, time } = await fetchChromiumDashCommit(commitId, repo));
          if (repo === 'chromium') {
            clCommitSha = commitId;
          } else {
            const relation = relations.find((rel) => rel.from_commit === commitId);
            if (!relation) {
              console.info(`${color.err} Couldn't find Chromium commit for ${parsedUrl}`);
              continue;
            }
            clCommitSha = relation.to_commit;
          }
        } catch {
          console.info(`${color.err} Couldn't fetch commit details for ${parsedUrl}`);
          continue;
        }

        // Only cherry pick the commit if it is between the initial Chromium version and the user provided version/commit SHA
        const shouldCherryPick =
          (usingCommitSha && chromiumCommitLog.find((c) => c.commit === clCommitSha)) ||
          (!usingCommitSha &&
            chromiumVersionOrCommitShaStr &&
            compareChromiumVersions(earliest, chromiumVersionOrCommitShaStr) <= 0);

        if (shouldCherryPick) {
          console.log(
            `${color.success} Cherry-picking commit for ${label} CL: ${styleText('yellow', shortSha)} ${message} (${styleText('greenBright', earliest)})`,
          );
          commitsToCherryPick.push({ sha: commit.sha, chromiumVersion: earliest, mergeTime: time });
        } else {
          console.info(
            `${color.info} Skipping commit for ${label} CL: ${styleText('yellow', shortSha)} ${message} (${styleText('greenBright', earliest)})`,
          );
        }
      }

      // Optionally reorder the commits by the merge time of their CL
      if (options.sort) {
        commitsToCherryPick.sort((a, b) => a.mergeTime - b.mergeTime);
      }

      for (const commit of commitsToCherryPick) {
        spawnSync(
          config,
          'git',
          ['fetch', 'origin', commit.sha],
          spawnOpts,
          'Failed to fetch commit to cherry-pick',
        );
        spawnSync(
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
      spawnSync(
        config,
        'node',
        ['script/gen-hunspell-filenames.js'],
        spawnOpts,
        'Failed to generate hunspell filenames',
      );
      const hunspellGitStatusResult = spawnSync(
        config,
        'git',
        ['status', '--porcelain'],
        spawnOpts,
      );
      if (
        hunspellGitStatusResult.status !== 0 ||
        hunspellGitStatusResult.stdout.toString().trim().length !== 0
      ) {
        spawnSync(
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

      spawnSync(
        config,
        'node',
        ['script/gen-libc++-filenames.js'],
        spawnOpts,
        'Failed to generate libc++ filenames',
      );
      const genLibCxxStatusResult = spawnSync(config, 'git', ['status', '--porcelain'], spawnOpts);
      if (
        genLibCxxStatusResult.status !== 0 ||
        genLibCxxStatusResult.stdout.toString().trim().length !== 0
      ) {
        spawnSync(
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
    },
  );

if (import.meta.main) {
  program.parse(process.argv);
}
