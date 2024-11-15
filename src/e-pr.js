#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const extractZip = require('extract-zip');
const querystring = require('querystring');
const semver = require('semver');
const open = require('open');
const program = require('commander');
const { Octokit } = require('@octokit/rest');

const { getGitHubAuthToken } = require('./utils/github-auth');
const { current } = require('./evm-config');
const { color, fatal } = require('./utils/logging');

// Adapted from https://github.com/electron/clerk
function findNoteInPRBody(body) {
  const onelineMatch = /(?:(?:\r?\n)|^)notes: (.+?)(?:(?:\r?\n)|$)/gi.exec(body);
  const multilineMatch = /(?:(?:\r?\n)Notes:(?:\r?\n+)((?:\*.+(?:(?:\r?\n)|$))+))/gi.exec(body);

  let notes = null;
  if (onelineMatch && onelineMatch[1]) {
    notes = onelineMatch[1];
  } else if (multilineMatch && multilineMatch[1]) {
    notes = multilineMatch[1];
  }

  if (notes) {
    // Remove the default PR template.
    notes = notes.replace(/<!--.*?-->/g, '');
  }

  return notes ? notes.trim() : notes;
}

async function getPullRequestInfo(pullNumber) {
  let notes = null;
  let title = null;

  const url = `https://api.github.com/repos/electron/electron/pulls/${pullNumber}`;
  const opts = {
    responseType: 'json',
    throwHttpErrors: false,
  };
  try {
    const response = await fetch(url, opts);
    if (!response.ok) {
      fatal(`Could not find PR: ${url} got ${response.status}`);
    }
    const data = await response.json();
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

function guessPRTarget(config) {
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
    `Unable to guess default target PR branch -- generated version '${version}' should include 'nightly' or match ${versionPattern}`,
  );
}

function guessPRSource(config) {
  const command = 'git rev-parse --abbrev-ref HEAD';

  const cwd = path.resolve(config.root, 'src', 'electron');
  const options = { cwd, encoding: 'utf8' };

  try {
    return childProcess.execSync(command, options).trim();
  } catch {
    return 'main';
  }
}

function pullRequestSource(source) {
  const regexes = [
    /https:\/\/github.com\/(\S*)\/electron.git/,
    /git@github.com:(\S*)\/electron.git/,
  ];

  const config = current();

  if (config.remotes.electron.fork) {
    const command = 'git remote get-url fork';
    const cwd = path.resolve(config.root, 'src', 'electron');
    const options = { cwd, encoding: 'utf8' };
    const remoteUrl = childProcess.execSync(command, options).trim();

    for (const regex of regexes) {
      if (regex.test(remoteUrl)) {
        return `${regex.exec(remoteUrl)[1]}:${source}`;
      }
    }
  }

  return source;
}

program
  .command('open')
  .description('Open a GitHub URL where you can PR your changes')
  .option('-s, --source [source_branch]', 'Where the changes are coming from')
  .option('-t, --target [target_branch]', 'Where the changes are going to')
  .option('-b, --backport <pull_request>', 'Pull request being backported')
  .action(async (options) => {
    const source = options.source || guessPRSource(current());
    const target = options.target || guessPRSource(current());

    if (!source) {
      fatal(`'source' is required to create a PR`);
    } else if (!target) {
      fatal(`'target' is required to create a PR`);
    }

    const repoBaseUrl = 'https://github.com/electron/electron';
    const comparePath = `${target}...${pullRequestSource(source)}`;
    const queryParams = { expand: 1 };

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
      if (manualBranchTarget) {
        options.backport = manualBranchTarget[1];
      }
    }

    if (options.backport) {
      if (!/^\d+$/.test(options.backport)) {
        fatal(`${options.backport} is not a valid GitHub backport number - try again`);
      }

      const { notes, title } = await getPullRequestInfo(options.backport);
      if (title) {
        queryParams.title = title;
      }
      queryParams.body = `Backport of #${
        options.backport
      }.\n\nSee that PR for details.\n\nNotes: ${notes || ''}`;
    }

    return open(`${repoBaseUrl}/compare/${comparePath}?${querystring.stringify(queryParams)}`);
  });

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
  .action(async (pullRequestNumber, options) => {
    if (!pullRequestNumber) {
      fatal(`Pull request number is required to download a PR`);
    }

    const octokit = new Octokit({
      auth: await getGitHubAuthToken(['repo']),
    });

    let pullRequest;
    try {
      const { data } = await octokit.pulls.get({
        owner: 'electron',
        repo: 'electron',
        pull_number: pullRequestNumber,
      });
      pullRequest = data;
    } catch (error) {
      console.error(`Failed to get pull request: ${error}`);
      return;
    }

    let workflowRuns;
    try {
      const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner: 'electron',
        repo: 'electron',
        branch: pullRequest.head.ref,
        name: 'Build',
        event: 'pull_request',
        status: 'completed',
        per_page: 10,
        sort: 'created',
        direction: 'desc',
      });
      workflowRuns = data.workflow_runs;
    } catch (error) {
      console.error(`Failed to list workflow runs: ${error}`);
      return;
    }

    const latestBuildWorkflowRun = workflowRuns.find((run) => run.name === 'Build');
    if (!latestBuildWorkflowRun) {
      fatal(`No 'Build' workflow runs found for pull request #${pullRequestNumber}`);
      return;
    }

    let artifacts;
    try {
      const { data } = await octokit.actions.listWorkflowRunArtifacts({
        owner: 'electron',
        repo: 'electron',
        run_id: latestBuildWorkflowRun.id,
      });
      artifacts = data.artifacts;
    } catch (error) {
      console.error(`Failed to list artifacts: ${error}`);
      return;
    }

    const artifactName = `generated_artifacts_${options.platform}_${options.arch}`;
    const artifact = artifacts.find((artifact) => artifact.name === artifactName);
    if (!artifact) {
      console.error(`Failed to find artifact: ${artifactName}`);
      return;
    }

    const prDir = path.resolve(
      __dirname,
      '..',
      'artifacts',
      `pr_${pullRequest.number}_${options.platform}_${options.arch}`,
    );

    // Clean up the directory if it exists
    try {
      await fs.promises.rm(prDir, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Create the directory
    await fs.promises.mkdir(prDir, { recursive: true });
    console.log(
      `Downloading artifact '${artifactName}' from pull request #${pullRequestNumber}...`,
    );

    // Download the artifact
    // TODO: use write stream
    const response = await octokit.actions.downloadArtifact({
      owner: 'electron',
      repo: 'electron',
      artifact_id: artifact.id,
      archive_format: 'zip',
    });

    const artifactPath = path.join(prDir, `${artifactName}.zip`);
    await fs.promises.writeFile(artifactPath, Buffer.from(response.data));

    console.log('Extracting dist...');

    // Extract the artifact zip
    const extractPath = path.join(prDir, artifactName);
    await fs.promises.mkdir(extractPath, { recursive: true });
    await extractZip(artifactPath, { dir: extractPath });

    // Check if dist.zip exists within the extracted artifact
    const distZipPath = path.join(extractPath, 'dist.zip');
    if (!(await fs.promises.stat(distZipPath).catch(() => false))) {
      fatal(`dist.zip not found within the extracted artifact.`);
      return;
    }

    // Extract dist.zip
    await extractZip(distZipPath, { dir: prDir });

    // Check if Electron exists within the extracted dist.zip
    const platformExecutables = {
      win32: 'electron.exe',
      darwin: 'Electron.app',
      linux: 'electron',
    };
    const executableName = platformExecutables[options.platform];

    const electronAppPath = path.join(prDir, executableName);
    if (!(await fs.promises.stat(electronAppPath).catch(() => false))) {
      fatal(`${executableName} not found within the extracted dist.zip.`);
      return;
    }

    // Remove the artifact and extracted artifact zip
    await fs.promises.rm(artifactPath);
    await fs.promises.rm(extractPath, { recursive: true });

    console.info(`Downloaded to ${electronAppPath}`);
  });

program.parse(process.argv);
