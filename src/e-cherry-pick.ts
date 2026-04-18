#!/usr/bin/env node

import * as cp from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { program } from 'commander';
import { Octokit } from '@octokit/rest';

import * as evmConfig from './evm-config.js';
import debug from 'debug';
import { getGerritPatchDetailsFromURL } from './utils/gerrit.js';
import { getGitHubAuthToken } from './utils/github-auth.js';
import { fatal, color } from './utils/logging.js';

const d = debug('build-tools:cherry-pick');

const ELECTRON_REPO_DATA = {
  owner: 'electron',
  repo: 'electron',
};

export interface PatchDetails {
  patchDirName: string;
  shortCommit: string;
  patch: string;
  bugNumber?: string | undefined;
  cve?: string;
}

async function getPatchDetailsFromURL(
  urlStr: string,
  security: boolean,
  cveLookup: boolean,
): Promise<PatchDetails> {
  const parsedUrl = new URL(urlStr);
  if (parsedUrl.host.endsWith('.googlesource.com')) {
    // gerrit's `security` flag only gates the issues.chromium.org CVE lookup,
    // so suppress it when --no-cve-lookup is passed.
    return getGerritPatchDetailsFromURL(parsedUrl, security && cveLookup);
  }
  if (parsedUrl.host === 'github.com') {
    return getGitHubPatchDetailsFromURL(parsedUrl, security);
  }
  fatal(
    'Expected a gerrit or github URL (e.g. https://chromium-review.googlesource.com/c/v8/v8/+/2465830)',
  );
}

async function getGitHubPatchDetailsFromURL(
  gitHubUrl: URL,
  security: boolean,
): Promise<PatchDetails> {
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

export function isUrl(arg: string) {
  return arg.startsWith('https://') || arg.startsWith('http://');
}

export function commitSubject(patch: string) {
  return /Subject: \[PATCH\] (.+?)$/m.exec(patch)?.[1]?.trim() ?? '';
}

// The first positional argument is expected to be a patch URL and the second a
// target branch, but users frequently transpose them — accept either order.
// Any remaining positional that looks like a URL is another patch to include
// in the same PR; everything else is another target branch.
export function splitPositionalArgs(
  patchUrlStr: string,
  targetBranch: string,
  rest: string[],
): { patchUrls: string[]; targetBranches: string[] } {
  if (isUrl(targetBranch)) {
    const tmp = patchUrlStr;
    patchUrlStr = targetBranch;
    targetBranch = tmp;
  }

  const patchUrls = [patchUrlStr, ...rest.filter(isUrl)];
  const targetBranches = [targetBranch, ...rest.filter((a) => !isUrl(a))];
  return { patchUrls, targetBranches };
}

export function computeBatchId(patchUrls: string[]): string {
  return crypto.createHash('sha256').update(patchUrls.join('\n')).digest('hex').slice(0, 12);
}

export function formatPRTitleAndBody({
  patches,
  security,
}: {
  patches: PatchDetails[];
  security: boolean;
}): { title: string; body: string } {
  const isBatch = patches.length > 1;
  const first = patches[0]!;

  if (isBatch) {
    const patchDirNames = [...new Set(patches.map((p) => p.patchDirName))];
    const title = `chore: cherry-pick ${patches.length} changes from ${patchDirNames.join(', ')}`;
    const lines = patches.map((p) => {
      const ref = p.cve || p.bugNumber || p.shortCommit;
      return `* ${p.shortCommit} from ${p.patchDirName} — ${commitSubject(p.patch)} (${ref})`;
    });
    const notes = patches
      .map((p) => p.cve || p.bugNumber)
      .filter(Boolean)
      .join(', ');
    const body =
      `Backports the following changes:\n\n${lines.join('\n')}\n\n` +
      `Notes: ${
        notes
          ? security
            ? `Security: backported fixes for ${notes}.`
            : `Backported fixes for ${notes}.`
          : `<!-- couldn't find bug numbers -->`
      }`;
    return { title, body };
  }

  const { shortCommit, patchDirName, patch, bugNumber, cve } = first;
  const title = `chore: cherry-pick ${shortCommit} from ${patchDirName}`;
  const commitMessage = /Subject: \[PATCH\] (.+?)^---$/ms.exec(patch)?.[1] ?? '';
  const body = `${commitMessage}\n\nNotes: ${
    bugNumber
      ? security
        ? `Security: backported fix for ${cve || bugNumber}.`
        : `Backported fix for ${bugNumber}.`
      : `<!-- couldn't find bug number -->`
  }`;
  return { title, body };
}

program
  .arguments('<patch-url> <target-branch> [additionalBranchesOrUrls...]')
  .option('--security', 'Whether this backport is for security reasons')
  .option(
    '--no-cve-lookup',
    'Skip the issues.chromium.org CVE lookup (and the interactive Chrome cookie borrow it requires)',
  )
  .description(
    'Opens a PR to electron/electron that backports the given CL(s) into our patches folder',
  )
  .allowExcessArguments(false)
  .action(
    async (
      patchUrlStr: string,
      targetBranch: string,
      rest: string[],
      { security, cveLookup }: { security?: boolean; cveLookup: boolean },
    ) => {
      const { patchUrls, targetBranches } = splitPositionalArgs(patchUrlStr, targetBranch, rest);

      const octokit = new Octokit({
        auth: await getGitHubAuthToken(['repo']),
      });

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-tmp'));
      const electronPath = path.join(tmp, 'electron');

      let error: unknown = null;
      try {
        const {
          data: { permissions },
        } = await octokit.repos.get(ELECTRON_REPO_DATA);

        if (!permissions?.push) {
          fatal(
            'The supplied $GITHUB_TOKEN does not have write access to electron/electron - exiting',
          );
        }

        d(`Fetching ${patchUrls.length} patch(es) from upstream`);
        const patches: PatchDetails[] = [];
        for (const url of patchUrls) {
          patches.push(await getPatchDetailsFromURL(url, !!security, cveLookup));
        }

        const isBatch = patches.length > 1;
        const batchId = computeBatchId(patchUrls);

        d(`Cloning electron/electron to ${tmp}`);
        cp.execSync(`git clone ${evmConfig.current().remotes.electron.origin}`, { cwd: tmp });

        for (const target of targetBranches) {
          const first = patches[0]!;
          const branchName = isBatch
            ? `cherry-pick/${target}/batch-${batchId}`
            : `cherry-pick/${target}/${first.patchDirName}/${first.shortCommit}`;

          console.log(
            `${color.info} Cherry-picking ${patches.length} change(s) into ${target} (${branchName})`,
          );

          d(`Checking out new branch from ${target}: ${branchName}`);
          cp.execSync(`git checkout ${target}`, { cwd: electronPath, stdio: 'ignore' });
          cp.execSync(`git checkout -b ${branchName}`, { cwd: electronPath, stdio: 'ignore' });

          let appliedAny = false;
          for (const details of patches) {
            const { patchDirName, shortCommit, patch } = details;
            const patchName = `cherry-pick-${shortCommit}.patch`;
            const patchPath = `patches/${patchDirName}`;

            if (!fs.existsSync(`${electronPath}/${patchPath}`)) {
              console.warn(
                `${color.warn} No patches existing for ${patchDirName} in ${target} added a dir under patches/ but you'll need to manually edit patches/config.json`,
              );
              fs.mkdirSync(`${electronPath}/${patchPath}`);
              fs.writeFileSync(`${electronPath}/${patchPath}/.patches`, '');
            }

            if (fs.existsSync(`${electronPath}/${patchPath}/${patchName}`)) {
              console.info(
                `${color.info} Patch ${patchName} already exists in ${patchDirName} in ${target} - skipping`,
              );
              continue;
            }

            const patchList = fs.readFileSync(`${electronPath}/${patchPath}/.patches`, 'utf8');
            const newPatchList = patchList + `${patchName}\n`;

            d(`Writing patch to ${patchPath}/${patchName} and updating .patches`);
            fs.writeFileSync(`${electronPath}/${patchPath}/${patchName}`, patch);
            fs.writeFileSync(`${electronPath}/${patchPath}/.patches`, newPatchList);

            d(`Committing ${patchName}`);
            const commitMsg = `chore: cherry-pick ${shortCommit} from ${patchDirName}`;
            cp.execSync(`git add ${patchPath}`, { cwd: electronPath });
            cp.execSync(`git commit -S -m "${commitMsg}"`, {
              cwd: electronPath,
              stdio: 'ignore',
            });
            appliedAny = true;
          }

          if (!appliedAny) {
            console.info(
              `${color.info} All requested patches already exist in ${target} - aborting cherry-pick`,
            );
            continue;
          }

          cp.execSync(`git push origin ${branchName}`, {
            cwd: electronPath,
            stdio: 'ignore',
          });

          const { title, body } = formatPRTitleAndBody({ patches, security: !!security });

          d(`Creating PR for ${branchName}`);
          const { data: pr } = await octokit.pulls.create({
            ...ELECTRON_REPO_DATA,
            head: `electron:${branchName}`,
            base: target,
            title,
            body,
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
    },
  );

if (import.meta.main) {
  program.parse(process.argv);
}
