#!/usr/bin/env node

const d = require('debug')('build-tools:cherry-pick');
const program = require('commander');
const https = require('https');
const got = require('got');
const { Octokit } = require('@octokit/rest');

const { getCveForBugNr } = require('./utils/crbug');
const { getGitHubAuthToken } = require('./utils/github-auth');
const { fatal } = require('./utils/logging');

function fetchBase64(url) {
  return new Promise((resolve, reject) => {
    https
      .request(url, res => {
        let data = '';
        res.setEncoding('ascii');
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          resolve(Buffer.from(data, 'base64').toString('utf8'));
        });
        res.on('error', reject);
      })
      .end();
  });
}

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
  if (
    gerritUrl.host !== 'chromium-review.googlesource.com' &&
    gerritUrl.host !== 'skia-review.googlesource.com' &&
    gerritUrl.host !== 'webrtc-review.googlesource.com' &&
    gerritUrl.host !== 'pdfium-review.googlesource.com'
  ) {
    fatal('Unsupported gerrit host');
  }
  const [, repo, number] = /^\/c\/(.+?)\/\+\/(\d+)/.exec(gerritUrl.pathname);

  d(`fetching patch from gerrit`);
  const changeId = `${repo}~${number}`;
  const patchUrl = new URL(
    `/changes/${encodeURIComponent(changeId)}/revisions/current/patch`,
    gerritUrl,
  );
  const patch = await fetchBase64(patchUrl.toString());

  const [, commitId] = /^From ([0-9a-f]+)/.exec(patch);

  const bugNumber =
    (/^Bug[:=] ?(.+)$/im.exec(patch) || [])[1] || 6(/^Bug= ?chromium:(.+)$/m.exec(patch) || [])[1];
  const cve = security ? await getCveForBugNr(bugNumber.replace('chromium:', '')) : '';

  const patchDirName =
    {
      'chromium-review.googlesource.com:chromium/src': 'chromium',
      'skia-review.googlesource.com:skia': 'skia',
      'webrtc-review.googlesource.com:src': 'webrtc',
    }[gerritUrl.host + ':' + repo] || repo.split('/').reverse()[0];

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

  const response = await got.get(`https://github.com/nodejs/node/commit/${commitSha}.patch`);
  const shortCommit = commitSha.slice(0, 7);
  const patch = response.body;

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
    try {
      const {
        data: { permissions },
      } = await octokit.repos.get({
        owner: 'electron',
        repo: 'electron',
      });
      if (!permissions || !permissions.push) {
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

      for (const target of targetBranches) {
        const branchName = `cherry-pick/${target}/${patchDirName}/${shortCommit}`;
        d(`fetching electron base branch info for ${target}`);
        const {
          data: {
            commit: {
              sha: targetSha,
              commit: {
                tree: { sha: targetBaseTreeSha },
              },
            },
          },
        } = await octokit.repos.getBranch({
          owner: 'electron',
          repo: 'electron',
          branch: target,
        });

        d(`fetching base patch list`);
        const { data: patchListData } = await octokit.repos
          .getContent({
            owner: 'electron',
            repo: 'electron',
            path: `${patchPath}/.patches`,
            ref: targetSha,
          })
          .catch(() => {
            console.log(
              `NOTE: No patches existing for ${patchDirName} in ${target}, added a dir under patches/ but you'll need to manually edit patches/config.json`,
            );
            return {
              data: null,
            };
          });
        const patchList = patchListData
          ? Buffer.from(patchListData.content, 'base64').toString('utf8')
          : '';
        const newPatchList = patchList + `${patchName}\n`;

        d(`creating tree base_tree=${targetBaseTreeSha}`);
        const { data: tree } = await octokit.git.createTree({
          owner: 'electron',
          repo: 'electron',
          base_tree: targetBaseTreeSha,
          tree: [
            {
              path: `${patchPath}/.patches`,
              mode: '100644',
              type: 'blob',
              content: newPatchList,
            },
            {
              path: `${patchPath}/${patchName}`,
              mode: '100644',
              type: 'blob',
              content: patch,
            },
          ],
        });

        d(`creating commit tree=${tree.sha} parent=${targetSha}`);
        const { data: commit } = await octokit.git.createCommit({
          owner: 'electron',
          repo: 'electron',
          tree: tree.sha,
          parents: [targetSha],
          message: `chore: cherry-pick ${shortCommit} from ${patchDirName}`,
        });

        d(`creating ref`);
        await octokit.git.createRef({
          owner: 'electron',
          repo: 'electron',
          ref: `refs/heads/${branchName}`,
          sha: commit.sha,
        });

        d(`creating pr`);
        const { data: pr } = await octokit.pulls.create({
          owner: 'electron',
          repo: 'electron',
          head: `electron:${branchName}`,
          base: target,
          title: `chore: cherry-pick ${shortCommit} from ${patchDirName}`,
          body: `${commitMessage}\n\nNotes: ${
            bugNumber
              ? security
                ? `Security: backported fix for ${cve || bugNumber}.`
                : `Backported fix for ${bugNumber}.`
              : `<!-- couldn't find bug number -->`
          }`,
          maintainer_can_modify: true,
        });

        d(`labelling pr`);
        await octokit.issues.update({
          owner: 'electron',
          repo: 'electron',
          issue_number: pr.number,
          labels: [
            target,
            'backport-check-skip',
            'semver/patch',
            ...(security ? ['security 🔒'] : []),
          ],
        });

        console.log(`Created cherry-pick PR to ${target}: ${pr.html_url}`);
      }
    } catch (err) {
      console.error('Failed to cherry-pick');
      fatal(err);
    }
  })
  .parse(process.argv);
