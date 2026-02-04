#!/usr/bin/env node

const { Octokit } = require('@octokit/rest');
const chalk = require('chalk').default;
const program = require('commander');
const fs = require('fs');
const inquirer = require('inquirer');
const path = require('path');
const os = require('os');

const evmConfig = require('./evm-config');
const { spawnSync } = require('./utils/depot-tools');
const { getGerritPatchDetailsFromURL } = require('./utils/gerrit');
const { getGitHubAuthToken } = require('./utils/github-auth');
const { color, fatal } = require('./utils/logging');

const ELECTRON_BOT_EMAIL = 'electron-bot@users.noreply.github.com';
const ELECTRON_BOT_NAME = 'Electron Bot';
const ELECTRON_REPO_DATA = {
  owner: 'electron',
  repo: 'electron',
};
const DEPS_REGEX = new RegExp(`chromium_version':\n +'(.+?)',`, 'm');
const CHROMIUM_CL_REGEX =
  /https:\/\/chromium-review\.googlesource\.com\/c\/chromium\/src\/\+\/(\d+)/;
const V8_CL_REGEX = /https:\/\/chromium-review\.googlesource\.com\/c\/v8\/v8\/\+\/(\d+)/;

async function getChromiumVersion(octokit, ref) {
  const { data } = await octokit.repos.getContent({
    ...ELECTRON_REPO_DATA,
    path: 'DEPS',
    ref,
  });

  if (!data.content) {
    fatal('Could not read content of PR');
    return;
  }

  const [, version] = DEPS_REGEX.exec(Buffer.from(data.content, 'base64').toString('utf8'));

  return version;
}

// Copied from https://github.com/electron/electron/blob/3a3595f2af59cb08fb09e3e2e4b7cdf713db2b27/script/release/notes/notes.ts#L605-L623
const compareChromiumVersions = (v1, v2) => {
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

function gitCommit(config, commitMessage, opts, fatalMessage) {
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

async function fetchChromiumDashCommit(commitSha, repo) {
  const resp = await fetch(
    `https://chromiumdash.appspot.com/fetch_commit?commit=${commitSha}&repo=${repo}`,
  );
  if (!resp.ok) {
    fatal(`Failed to fetch commit details for SHA "${commitSha}"`);
    return;
  }

  // Grab the earliest Chromium version the CL was released in, relations, and the merge time
  const { earliest, relations, time } = await resp.json();

  return { earliest, relations, time };
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
  .action(async (prNumberStr, chromiumVersionOrCommitShaStr, options) => {
    const prNumber = parseInt(prNumberStr, 10);
    if (isNaN(prNumber) || `${prNumber}` !== prNumberStr) {
      fatal(`rcv requires a PR number, "${prNumberStr}" was provided`);
      return;
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
      return;
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
          .then((resp) => resp.json())
          .then((versions) => versions.map(({ version }) => version)),
      );
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
            `Chromium version ${chalk.blueBright(chromiumVersionOrCommitShaStr)} is not between ${chalk.blueBright(initialVersion)} and ${chalk.blueBright(newVersion)}`,
          );
          return;
        }

        // Confirm chromiumVersionOrCommitShaStr is a tagged Chromium version
        if (!chromiumVersions.includes(chromiumVersionOrCommitShaStr)) {
          fatal(
            `Version ${chalk.blueBright(chromiumVersionOrCommitShaStr)} is not a tagged Chromium version`,
          );
          return;
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
            `Chromium commit ${chalk.blueBright(chromiumVersionOrCommitShaStr)} is not between ${chalk.blueBright(initialVersion)} and ${chalk.blueBright(newVersion)}`,
          );
          return;
        }

        usingCommitSha = true;
      } else {
        fatal(
          `Provided value ${chalk.blueBright(chromiumVersionOrCommitShaStr)} does not appear to be a valid Chromium version or commit SHA`,
        );
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
    };
    const gitStatusResult = spawnSync(config, 'git', ['status', '--porcelain'], spawnOpts);
    if (gitStatusResult.status !== 0 || gitStatusResult.stdout.toString().trim().length !== 0) {
      fatal(
        "Your current git working directory is not clean, we won't erase your local changes. Clean it up and try again",
      );
      return;
    }

    // Checkout the parent of the merge commit if it was merged, else the base SHA
    let targetSha = pr.base.sha;

    if (pr.merged) {
      if (!pr.merge_commit_sha) {
        fatal('No merge SHA available on PR');
        return;
      }
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

    spawnSync(
      config,
      'git',
      ['fetch', 'origin', targetSha],
      spawnOpts,
      'Failed to fetch upstream base',
    );
    spawnSync(config, 'git', ['checkout', targetSha], spawnOpts, 'Failed to checkout base commit');

    const rcvBranch = `rcv/pr/${prNumber}/version/${chromiumVersionOrCommitShaStr}`;
    spawnSync(config, 'git', ['branch', '-D', rcvBranch], spawnOpts);
    spawnSync(
      config,
      'git',
      ['checkout', '-b', rcvBranch],
      spawnOpts,
      `Failed to checkout new branch "${rcvBranch}"`,
    );

    spawnSync(config, 'yarn', ['install'], spawnOpts, 'Failed to do "yarn install" on new branch');

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

    const commitsToCherryPick = [];
    const chromiumCommitLog = [];

    if (usingCommitSha) {
      // Pull the commit log from the initial version up until the provided commit SHA
      const maxCommits = 10000;
      const textResponse = await fetch(
        `https://chromium.googlesource.com/chromium/src/+log/${initialVersion}..${chromiumVersionOrCommitShaStr}?n=${maxCommits}&format=JSON`,
      ).then((resp) => resp.text());

      if (textResponse.startsWith(")]}'")) {
        chromiumCommitLog.push(...JSON.parse(textResponse.substring(4))['log']);

        if (chromiumCommitLog.length === maxCommits) {
          fatal('Too many commits in Chromium commit log');
          return;
        }
      } else {
        fatal('Unexpected response from Chromium commit log fetch');
        return;
      }
    }

    for (const commit of commits) {
      const shortSha = commit.sha.substring(0, 7);
      const message = commit.commit.message.split('\n')[0];

      const chromiumCLMatch = CHROMIUM_CL_REGEX.exec(commit.commit.message);
      const v8CLMatch = V8_CL_REGEX.exec(commit.commit.message);

      const clMatch = chromiumCLMatch || v8CLMatch;
      if (!clMatch) {
        console.info(`${color.info} Skipping non-CL commit: ${chalk.yellow(shortSha)} ${message}`);
        continue;
      }

      const isV8 = !!v8CLMatch;
      const repo = isV8 ? 'v8' : 'chromium';
      const label = isV8 ? chalk.cyan('V8') : chalk.magenta('Chromium');

      const parsedUrl = new URL(clMatch[0]);

      let clCommitSha, earliest, time;

      try {
        const { commitId } = await getGerritPatchDetailsFromURL(parsedUrl);
        let relations;
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
        (!usingCommitSha && compareChromiumVersions(earliest, chromiumVersionOrCommitShaStr) <= 0);

      if (shouldCherryPick) {
        console.log(
          `${color.success} Cherry-picking commit for ${label} CL: ${chalk.yellow(shortSha)} ${message} (${chalk.greenBright(earliest)})`,
        );
        commitsToCherryPick.push({ sha: commit.sha, chromiumVersion: earliest, mergeTime: time });
      } else {
        console.info(
          `${color.info} Skipping commit for ${label} CL: ${chalk.yellow(shortSha)} ${message} (${chalk.greenBright(earliest)})`,
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
    const hunspellGitStatusResult = spawnSync(config, 'git', ['status', '--porcelain'], spawnOpts);
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
  });

program.parse(process.argv);
