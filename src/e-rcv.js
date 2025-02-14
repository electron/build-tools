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

const ELECTRON_REPO_DATA = {
  owner: 'electron',
  repo: 'electron',
};
const DEPS_REGEX = new RegExp(`chromium_version':\n +'(.+?)',`, 'm');
const CL_REGEX = /https:\/\/chromium-review\.googlesource\.com\/c\/chromium\/src\/\+\/(\d+)/;

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
      return;
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
      return;
    }

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
    const gitOpts = {
      cwd: path.resolve(config.root, 'src', 'electron'),
      stdio: 'pipe',
    };
    const result = spawnSync(config, 'git', ['status', '--porcelain'], gitOpts);
    if (result.status !== 0 || result.stdout.toString().trim().length !== 0) {
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

    const ensureShaLocal = spawnSync(config, 'git', ['fetch', 'origin', targetSha], gitOpts);
    if (ensureShaLocal.status !== 0) {
      fatal('Failed to fetch upstream base');
      return;
    }

    const checkoutResult = spawnSync(config, 'git', ['checkout', targetSha], gitOpts);
    if (checkoutResult.status !== 0) {
      fatal('Failed to checkout base commit');
      return;
    }

    const rcvBranch = `rcv/pr/${prNumber}/version/${chromiumVersionStr}`;
    spawnSync(config, 'git', ['branch', '-D', rcvBranch], gitOpts);
    const checkoutBranchResult = spawnSync(config, 'git', ['checkout', '-b', rcvBranch], gitOpts);
    if (checkoutBranchResult.status !== 0) {
      fatal(`Failed to checkout new branch "${rcvBranch}"`);
      return;
    }

    const yarnInstallResult = spawnSync(config, 'yarn', ['install'], gitOpts);
    if (yarnInstallResult.status !== 0) {
      fatal(`Failed to do "yarn install" on new branch`);
      return;
    }

    // Update the Chromium version in DEPS
    const regexToReplace = new RegExp(`(chromium_version':\n +').+?',`, 'gm');
    const content = await fs.promises.readFile(path.resolve(gitOpts.cwd, 'DEPS'), 'utf8');
    const newContent = content.replace(regexToReplace, `$1${chromiumVersionStr}',`);
    await fs.promises.writeFile(path.resolve(gitOpts.cwd, 'DEPS'), newContent, 'utf8');

    // Make a commit with this change
    const addResult = spawnSync(config, 'git', ['add', 'DEPS'], gitOpts);
    if (addResult.status !== 0) {
      fatal('Failed to add DEPS file for commit');
      return;
    }

    const author = 'Electron Bot <electron-bot@users.noreply.github.com>';
    const message = `chore: bump chromium to ${chromiumVersionStr}`;
    const commitResult = spawnSync(
      config,
      'git',
      [
        'commit',
        '--no-verify', // There's a bug on Windows that creates incorrect changes
        '--author',
        os.platform() === 'win32' ? `"${author}"` : author,
        '-m',
        os.platform() === 'win32' ? `"${message}"` : message,
      ],
      gitOpts,
    );
    if (commitResult.status !== 0) {
      fatal('Failed to commit DEPS file change');
      return;
    }

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
        const { shortCommit: chromiumShortSha } = await getGerritPatchDetailsFromURL(parsedUrl);
        const { commits: chromiumCommits } = await fetch(
          `https://chromiumdash.appspot.com/fetch_commits?commit=${chromiumShortSha}`,
        ).then((resp) => resp.json());
        if (chromiumCommits.length !== 1) {
          fatal(`Expected to find exactly one commit for SHA "${chromiumShortSha}"`);
          return;
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

    // Reorder the commits by the merge time of their CL
    if (options.sort) {
      commitsToCherryPick.sort((a, b) => a.mergeTime - b.mergeTime);
    }

    for (const commit of commitsToCherryPick) {
      const ensureCommitLocal = spawnSync(config, 'git', ['fetch', 'origin', commit.sha], gitOpts);
      if (ensureCommitLocal.status !== 0) {
        fatal('Failed to fetch commit to cherry-pick');
        return;
      }

      const cherryPickResult = spawnSync(
        config,
        'git',
        [
          'cherry-pick',
          '--allow-empty',
          `--strategy-option=${options.mergeStrategyOption}`,
          commit.sha,
        ],
        gitOpts,
      );
      if (cherryPickResult.status !== 0) {
        fatal(`Failed to cherry-pick commit "${commit.sha}"`);
        return;
      }
    }

    // TODO(dsanders11) - update filenames and commit
  });

program.parse(process.argv);
