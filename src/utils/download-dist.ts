import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import * as inquirer from '@inquirer/prompts';
import { Octokit } from '@octokit/rest';
import debug from 'debug';
import extractZip from 'extract-zip';

import { progressStream } from './download.js';
import { getGitHubAuthToken } from './github-auth.js';
import { color, fatal, logError } from './logging.js';

const d = debug('build-tools:download-dist');

export interface DownloadDistOptions {
  platform: string;
  arch: string;
  output?: string;
  skipConfirmation: boolean;
}

export async function downloadDist(
  pullRequestNumber: string,
  options: DownloadDistOptions,
): Promise<void> {
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
      // GitHub supports filtering by workflow name here but @octokit/openapi-types
      // doesn't declare it. Without this filter, a PR with many concurrent
      // workflows can push the Build run out of the first page of results.
      name: 'Build',
    } as Parameters<typeof octokit.actions.listWorkflowRunsForRepo>[0] & { name: string });
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
    const artifactsDir = path.resolve(import.meta.dirname, '..', 'artifacts');
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

  console.log(`Downloading artifact '${artifactName}' from pull request #${pullRequestNumber}...`);

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
}
