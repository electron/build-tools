#!/usr/bin/env node

const d = require('debug')('build-tools:cherry-pick');
const program = require('commander');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Octokit } = require('@octokit/rest');

const { getCveForBugNr } = require('./utils/crbug');
const { getGitHubAuthToken } = require('./utils/github-auth');
const { fatal, color } = require('./utils/logging');

const ELECTRON_REPO_DATA = {
  owner: 'electron',
  repo: 'electron',
};

const gerritSources = [
  'chromium-review.googlesource.com',
  'skia-review.googlesource.com',
  'webrtc-review.googlesource.com',
  'pdfium-review.googlesource.com',
  'dawn-review.googlesource.com',
];

async function getPatchDetailsFromURL(urlStr, security) {
  const parsedUrl = new URL(urlStr);
  if (parsedUrl.host.endsWith('.googlesource.com')) {
    return await getGerritPatchDetailsFromURL(parsedUrl, security);
  }
  if (parsedUrl.host === 'github.com') {
    return await getGitHubPatchDetailsFromURL(parsedUrl, security);
  }
  fatal(
    'Expected a gerrit or github URL (e.g. https://chromium-review.googlesource.com/c/v8/v8/+/2465830)',
  );
}

async function getGerritPatchDetailsFromURL(gerritUrl, security) {
  const { host, pathname } = gerritUrl;

  if (!gerritSources.includes(host)) {
    fatal('Unsupported gerrit host');
  }
  const [, repo, number] = /^\/c\/(.+?)\/\+\/(\d+)/.exec(pathname);

  d(`fetching patch from gerrit`);
  const changeId = `${repo}~${number}`;
  const patchUrl = new URL(
    `/changes/${encodeURIComponent(changeId)}/revisions/current/patch`,
    gerritUrl,
  );

  const patch = await fetch(patchUrl)
    .then((resp) => resp.text())
    .then((text) => Buffer.from(text, 'base64').toString('utf8'));

  const [, commitId] = /^From ([0-9a-f]+)/.exec(patch);

  const bugNumber =
    /^(?:Bug|Fixed)[:=] ?(.+)$/im.exec(patch)?.[1] || /^Bug= ?chromium:(.+)$/m.exec(patch)?.[1];

  let cve = '';
  if (security) {
    try {
      cve = await getCveForBugNr(bugNumber.replace('chromium:', ''));
    } catch (err) {
      d(err);
      console.error(
        `${color.warn} Failed to fetch CVE for ${bugNumber} - you'll need to find it manually`,
      );
    }
  }

  const patchDirName =
    {
      'chromium-review.googlesource.com:chromium/src': 'chromium',
      'skia-review.googlesource.com:skia': 'skia',
      'webrtc-review.googlesource.com:src': 'webrtc',
    }[`${host}:${repo}`] || repo.split('/').reverse()[0];

  const shortCommit = commitId.substr(0, 12);

  return { patchDirName, shortCommit, patch, bugNumber, cve };
}

async function getGitHubPatchDetailsFromURL(gitHubUrl, security) {
  if (security) {
    fatal('GitHub cherry-picks can not be security backports currently');
  }

  if (!gitHubUrl.pathname.startsWith('/nodejs/node/commit/')) {
    fatal('Unsupport github repo');
  }

  const commitSha = gitHubUrl.pathname.split('/')[4];
  if (!commitSha) {
    fatal('Could not find commit sha in url');
  }

  const response = await fetch(`https://github.com/nodejs/node/commit/${commitSha}.patch`);
  const shortCommit = commitSha.slice(0, 7);
  const patch = await response.text();

  return {
    patchDirName: 'node',
    shortCommit,
    patch,
  };
}

program
  .arguments('<patch-url> <target-branch> [additionalBranches...]')
  .option('--security', 'Whether this backport is for security reasons')
  .description('Opens a PR to electron/electron that backport the given CL into our patches folder')
  .allowExcessArguments(false)
  .action(async (patchUrlStr, targetBranch, additionalBranches, { security }) => {
    if (targetBranch.startsWith('https://')) {
      let tmp = patchUrlStr;
      patchUrlStr = targetBranch;
      targetBranch = tmp;
    }

    const octokit = new Octokit({
      auth: await getGitHubAuthToken(['repo']),
    });

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-tmp'));
    const electronPath = path.join(tmp, 'electron');

    let error = null;
    try {
      const {
        data: { permissions },
      } = await octokit.repos.get(ELECTRON_REPO_DATA);

      if (!permissions?.push) {
        fatal(
          'The supplied $GITHUB_TOKEN does not have write access to electron/electron - exiting',
        );
      }

      const { patchDirName, shortCommit, patch, bugNumber, cve } = await getPatchDetailsFromURL(
        patchUrlStr,
        security,
      );

      const patchName = `cherry-pick-${shortCommit}.patch`;
      const commitMessage = /Subject: \[PATCH\] (.+?)^---$/ms.exec(patch)[1];
      const patchPath = `patches/${patchDirName}`;
      const targetBranches = [targetBranch, ...additionalBranches];

      d(`Cloning electron/electron to ${tmp}`);
      cp.execSync('git clone https://github.com/electron/electron', { cwd: tmp });

      for (const target of targetBranches) {
        console.log(`${color.info} Cherry-picking ${shortCommit} into ${target}`);

        const branchName = `cherry-pick/${target}/${patchDirName}/${shortCommit}`;

        // Check out the target branch and create a new branch for the cherry-pick.
        d(`Checking out new branch from ${target}: ${branchName}`);
        cp.execSync(`git checkout ${target}`, { cwd: electronPath, stdio: 'ignore' });
        cp.execSync(`git checkout -b ${branchName}`, { cwd: electronPath, stdio: 'ignore' });

        // Ensure the patches directory exists.
        if (!fs.existsSync(`${electronPath}/${patchPath}`)) {
          console.warn(
            `${color.warn} No patches existing for ${patchDirName} in ${target} added a dir under patches/ but you'll need to manually edit patches/config.json`,
          );
          fs.mkdirSync(`${electronPath}/${patchPath}`);
        }

        // Check whether the patch already exists in the target branch.
        if (fs.existsSync(`${electronPath}/${patchPath}/${patchName}`)) {
          console.info(
            `${color.info} Patch ${patchName} already exists in ${patchDirName} in ${target} - aborting cherry-pick`,
          );
          continue;
        }

        // Write the patch to the patches directory and update the .patches file.
        const patchList = fs.readFileSync(`${electronPath}/${patchPath}/.patches`, 'utf8');
        const newPatchList = patchList + `${patchName}\n`;

        d(`Writing patch to ${patchPath}/${patchName} and updating .patches`);
        fs.writeFileSync(`${electronPath}/${patchPath}/${patchName}`, patch);
        fs.writeFileSync(`${electronPath}/${patchPath}/.patches`, newPatchList);

        d(`Committing changes`);
        const commitMsg = `chore: cherry-pick ${shortCommit} from ${patchDirName}`;
        cp.execSync(`git add ${patchPath}`, { cwd: electronPath });
        cp.execSync(`git commit -m "${commitMsg}"`, {
          cwd: electronPath,
          stdio: 'ignore',
        });

        // Push the changes to the remote.
        cp.execSync(`git push origin ${branchName}`, {
          cwd: electronPath,
          stdio: 'ignore',
        });

        d(`Creating PR for ${branchName}`);
        const { data: pr } = await octokit.pulls.create({
          ...ELECTRON_REPO_DATA,
          head: `electron:${branchName}`,
          base: target,
          title: commitMsg,
          body: `${commitMessage}\n\nNotes: ${
            bugNumber
              ? security
                ? `Security: backported fix for ${cve || bugNumber}.`
                : `Backported fix for ${bugNumber}.`
              : `<!-- couldn't find bug number -->`
          }`,
          maintainer_can_modify: true,
        });

        d(`Labeling PR to ${target}`);
        await octokit.issues.update({
          ...ELECTRON_REPO_DATA,
          issue_number: pr.number,
          labels: [
            target,
            'backport-check-skip',
            'semver/patch',
            ...(security ? ['security 🔒'] : []),
          ],
        });

        console.log(`${color.success} Created cherry-pick PR to ${target}: ${pr.html_url}`);

        // Clean up the working tree between cherry-picks.
        d(`Cleaning up working tree between cherry-picks`);
        cp.execSync('git clean -fdx', { cwd: electronPath });
      }
    } catch (err) {
      error = err;
    } finally {
      d(`Removing temporary electron directory at ${tmp}`);
      fs.rmSync(tmp, { recursive: true });

      if (error) {
        console.error(`${color.err} Failed to cherry-pick`);
        fatal(error);
      }
    }
  })
  .parse(process.argv);
