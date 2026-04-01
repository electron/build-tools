#!/usr/bin/env node

import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as querystring from 'node:querystring';

import extractZip from 'extract-zip';
import * as semver from 'semver';
import { program } from 'commander';
import * as inquirer from '@inquirer/prompts';
import { Octokit } from '@octokit/rest';

import debug from 'debug';
import { progressStream } from './utils/download';
import { getGitHubAuthToken } from './utils/github-auth';
import open from 'open';
import { current } from './evm-config';
import { color, fatal, logError } from './utils/logging';
import type { SanitizedConfig } from './types';

const d = debug('build-tools:pr');

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
  const options = { cwd, encoding: 'utf8' as const };

  try {
    return childProcess.execSync(command, options).trim();
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
    const options = { cwd, encoding: 'utf8' as const };
    const remoteUrl = childProcess.execSync(command, options).trim();

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

interface DownloadDistOptions {
  platform: string;
  arch: string;
  output?: string;
  skipConfirmation: boolean;
}

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

    d('checking auth...');
    const auth = await getGitHubAuthToken(['repo']);
    const octokit = new Octokit({ auth });

    d('fetching pr info...');
    let pullRequest;
    try {
      const { data } = await octokit.pulls.get({
        owner: 'electron',
        repo: 'electron',
        pull_number: parseInt(pullRequestNumber, 10),
      });
      pullRequest = data;
    } catch (error) {
      console.error(`Failed to get pull request: ${String(error)}`);
      return;
    }

    if (!options.skipConfirmation) {
      const isElectronRepo = pullRequest.head.repo?.full_name !== 'electron/electron';
      const proceed = await inquirer.confirm({
        default: false,
        message: `You are about to download artifacts from:

“${pullRequest.title} (#${pullRequest.number})” by ${pullRequest.user?.login}
${pullRequest.head.repo?.html_url}${isElectronRepo ? ' (fork)' : ''}
${pullRequest.state !== 'open' ? '\n❗❗❗ The pull request is closed, only proceed if you trust the source ❗❗❗\n' : ''}
Proceed?`,
      });

      if (!proceed) return;
    }

    d('fetching workflow runs...');
    let workflowRuns;
    try {
      const { data } = await octokit.actions.listWorkflowRunsForRepo({
        owner: 'electron',
        repo: 'electron',
        branch: pullRequest.head.ref,
        event: 'pull_request',
        status: 'completed',
        per_page: 10,
      });
      workflowRuns = data.workflow_runs;
    } catch (error) {
      console.error(`Failed to list workflow runs: ${String(error)}`);
      return;
    }

    const latestBuildWorkflowRun = workflowRuns.find((run) => run.name === 'Build');
    if (!latestBuildWorkflowRun) {
      fatal(`No 'Build' workflow runs found for pull request #${pullRequestNumber}`);
    }
    const shortCommitHash = latestBuildWorkflowRun.head_sha.substring(0, 7);

    d('fetching artifacts...');
    let artifacts;
    try {
      const { data } = await octokit.actions.listWorkflowRunArtifacts({
        owner: 'electron',
        repo: 'electron',
        run_id: latestBuildWorkflowRun.id,
      });
      artifacts = data.artifacts;
    } catch (error) {
      console.error(`Failed to list artifacts: ${String(error)}`);
      return;
    }

    const artifactPlatform = options.platform === 'win32' ? 'win' : options.platform;
    const artifactName = `generated_artifacts_${artifactPlatform}_${options.arch}`;
    const artifact = artifacts.find((a) => a.name === artifactName);
    if (!artifact) {
      console.error(`Failed to find artifact: ${artifactName}`);
      return;
    }

    let outputDir: string;

    if (options.output) {
      outputDir = path.resolve(options.output);

      if (!(await fs.promises.stat(outputDir).catch(() => false))) {
        fatal(`The output directory '${options.output}' does not exist`);
      }
    } else {
      const artifactsDir = path.resolve(__dirname, '..', 'artifacts');
      const defaultDir = path.resolve(
        artifactsDir,
        `pr_${pullRequest.number}_${shortCommitHash}_${options.platform}_${options.arch}`,
      );

      // Clean up the directory if it exists
      try {
        await fs.promises.rm(defaultDir, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Create the directory
      await fs.promises.mkdir(defaultDir, { recursive: true });

      outputDir = defaultDir;
    }

    console.log(
      `Downloading artifact '${artifactName}' from pull request #${pullRequestNumber}...`,
    );

    // Download the artifact to a temporary directory
    const tempDir = path.join(os.tmpdir(), 'electron-tmp');
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    await fs.promises.mkdir(tempDir);

    const { url } = octokit.actions.downloadArtifact.endpoint({
      owner: 'electron',
      repo: 'electron',
      artifact_id: artifact.id,
      archive_format: 'zip',
    });

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${auth}`,
      },
    });

    if (!response.ok) {
      fatal(`Could not find artifact: ${url} got ${response.status}`);
    }

    if (!response.body) {
      fatal('Artifact download returned no body');
    }

    const total = parseInt(response.headers.get('content-length') ?? '0', 10);
    const artifactDownloadStream = Readable.fromWeb(response.body);

    try {
      const artifactZipPath = path.join(tempDir, `${artifactName}.zip`);
      const artifactFileStream = fs.createWriteStream(artifactZipPath);
      if (process.env['CI']) {
        await pipeline(artifactDownloadStream, artifactFileStream);
      } else {
        await pipeline(
          artifactDownloadStream,
          progressStream(total, '[:bar] :mbRateMB/s :percent :etas'),
          artifactFileStream,
        );
      }

      // Extract artifact zip
      d('unzipping artifact to %s', tempDir);
      await extractZip(artifactZipPath, { dir: tempDir });

      // Check if dist.zip exists within the extracted artifact
      const distZipPath = path.join(tempDir, 'dist.zip');
      if (!(await fs.promises.stat(distZipPath).catch(() => false))) {
        throw new Error(`dist.zip not found in build artifact.`);
      }

      // Extract dist.zip
      // NOTE: 'extract-zip' is used as it correctly extracts symlinks.
      d('unzipping dist.zip to %s', outputDir);
      await extractZip(distZipPath, { dir: outputDir });

      const platformExecutables: Record<string, string> = {
        win32: 'electron.exe',
        darwin: 'Electron.app/',
        linux: 'electron',
      };

      const executableName = platformExecutables[options.platform];
      if (!executableName) {
        throw new Error(`Unable to find executable for platform '${options.platform}'`);
      }

      const executablePath = path.join(outputDir, executableName);
      if (!(await fs.promises.stat(executablePath).catch(() => false))) {
        throw new Error(`${executableName} not found within dist.zip.`);
      }

      console.log(`${color.success} Downloaded to ${outputDir}`);
    } catch (error) {
      logError(error);
      process.exitCode = 1; // wait for cleanup
    } finally {
      // Cleanup temporary files
      try {
        await fs.promises.rm(tempDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  });

if (require.main === module) {
  program.parse(process.argv);
}
