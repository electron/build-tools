#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const extractZip = require('extract-zip');
const querystring = require('querystring');
const semver = require('semver');
const open = require('open');
const program = require('commander');
const { Octokit } = require('@octokit/rest');
const inquirer = require('inquirer');

const { progressStream } = require('./utils/download');
const { getGitHubAuthToken } = require('./utils/github-auth');
const { current } = require('./evm-config');
const { color, fatal, logError } = require('./utils/logging');

const d = require('debug')('build-tools:pr');

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
  .command('open', null, { isDefault: true })
  .description('Open a GitHub URL where you can PR your changes')
  .option('-s, --source [source_branch]', 'Where the changes are coming from')
  .option('-t, --target [target_branch]', 'Where the changes are going to')
  .option('-b, --backport <pull_request>', 'Pull request being backported')
  .action(async (options) => {
    const source = options.source || guessPRSource(current());
    const target = options.target || guessPRTarget(current());

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
  .option(
    '-o, --output <output_directory>',
    'Specify the output directory for downloaded artifacts. ' +
      'Defaults to ~/.electron_build_tools/artifacts/pr_{number}_{commithash}_{platform}_{arch}',
  )
  .option(
    '-s, --skip-confirmation',
    'Skip the confirmation prompt before downloading the dist.',
    !!process.env.CI,
  )
  .action(async (pullRequestNumber, options) => {
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
        pull_number: pullRequestNumber,
      });
      pullRequest = data;
    } catch (error) {
      console.error(`Failed to get pull request: ${error}`);
      return;
    }

    if (!options.skipConfirmation) {
      const isElectronRepo = pullRequest.head.repo.full_name !== 'electron/electron';
      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          default: false,
          name: 'proceed',
          message: `You are about to download artifacts from:

“${pullRequest.title} (#${pullRequest.number})” by ${pullRequest.user.login}
${pullRequest.head.repo.html_url}${isElectronRepo ? ' (fork)' : ''}
${pullRequest.state !== 'open' ? '\n❗❗❗ The pull request is closed, only proceed if you trust the source ❗❗❗\n' : ''}
Proceed?`,
        },
      ]);

      if (!proceed) return;
    }

    d('fetching workflow runs...');
    let workflowRuns;
    try {
      const { data } = await octokit.actions.listWorkflowRunsForRepo({
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
      console.error(`Failed to list artifacts: ${error}`);
      return;
    }

    const artifactPlatform = options.platform === 'win32' ? 'win' : options.platform;
    const artifactName = `generated_artifacts_${artifactPlatform}_${options.arch}`;
    const artifact = artifacts.find((artifact) => artifact.name === artifactName);
    if (!artifact) {
      console.error(`Failed to find artifact: ${artifactName}`);
      return;
    }

    let outputDir;

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
        if (error.code !== 'ENOENT') {
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

    const { url } = await octokit.actions.downloadArtifact.endpoint({
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

    const total = parseInt(response.headers.get('content-length'), 10);
    const artifactDownloadStream = Readable.fromWeb(response.body);

    try {
      const artifactZipPath = path.join(tempDir, `${artifactName}.zip`);
      const artifactFileStream = fs.createWriteStream(artifactZipPath);
      await pipeline(
        artifactDownloadStream,
        // Show download progress
        ...(process.env.CI ? [] : [progressStream(total, '[:bar] :mbRateMB/s :percent :etas')]),
        artifactFileStream,
      );

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

      const platformExecutables = {
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

program.parse(process.argv);
