#!/usr/bin/env node

const { default: chalk } = require('chalk');
const { program, Option } = require('commander');
const got = require('got');

const { fatal } = require('../utils/logging');

const BuildTypes = {
  CIRCLECI: 'CIRCLECI',
  APPVEYOR: 'APPVEYOR',
};

const ArchTypes = {
  ia32: 'electron-ia32-testing',
  x64: 'electron-x64-testing',
  woa: 'electron-woa-testing',
};

const APPVEYOR_ACCOUNT_NAME = 'electron-bot';

const rerunCircleCIWorkflow = async (id, options) => {
  const { pipeline_number } = await got(`https://circleci.com/api/v2/workflow/${id}`, {
    username: process.env.CIRCLE_TOKEN,
    password: '',
  }).json();

  const { workflow_id } = await got
    .post(`https://circleci.com/api/v2/workflow/${id}/rerun`, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      username: process.env.CIRCLE_TOKEN,
      password: '',
      json: {
        //TODO(codebytere): allow specifying jobs and rerunning with SSH.
        enable_ssh: false,
        from_failed: options.fromFailed,
        jobs: [],
        sparse_tree: false,
      },
    })
    .json();

  console.log(`${chalk.bgMagenta(chalk.white('New Workflow Run'))}

⦿ ${chalk.white(
    `https://app.circleci.com/pipelines/github/electron/electron/${pipeline_number}/workflows/${workflow_id}`,
  )}
  `);
};

const rerunAppveyorBuild = async (id, arch) => {
  const data = await got
    .put(`https://ci.appveyor.com/api/builds`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.APPVEYOR_CLOUD_TOKEN}`,
      },
      json: {
        buildId: id,
        reRunIncomplete: false,
      },
    })
    .json();
  console.log(`${chalk.bgMagenta(chalk.white('Build Rerun'))}

⦿ ${chalk.white(
    `https://ci.appveyor.com/project/${APPVEYOR_ACCOUNT_NAME}/${ArchTypes[arch]}/builds/${data.buildId}`,
  )}
  `);
};

// CircleCI workflow IDs have letters and numbers and contain dashes,
// while Appveyor Build IDs are all numbers.
const getCIType = id => {
  const isCircleID = id.includes('-') && /^[0-9]+$/.test(id);
  return isCircleID ? BuildTypes.CIRCLECI : BuildTypes.APPVEYOR;
};

const archOption = new Option(
  '-a, --arch <arch>',
  'The arch of the build to rerun (required for AppVeyor)',
).choices(['ia32', 'x64', 'woa']);

program
  .description('Rerun CI workflows')
  .argument('<id>', 'The ID of the workflow or build to rerun')
  .option('-f, --from-failed', 'Rerun workflow from failed (CircleCI only)', true)
  .addOption(archOption)
  .action(async (id, options) => {
    try {
      const type = getCIType(id);

      if (type === BuildTypes.CIRCLECI) {
        await rerunCircleCIWorkflow(id, options);
      } else if (type === BuildTypes.APPVEYOR) {
        if (!options.arch) {
          throw new commander.InvalidArgumentError('arch is required for Appveyor reruns');
        } else if (!process.env.APPVEYOR_CLOUD_TOKEN) {
          fatal('process.env.APPVEYOR_CLOUD_TOKEN required for AppVeyor reruns');
        }

        await rerunAppveyorBuild(id, options.arch);
      }
    } catch (e) {
      fatal(e.message);
    }
  });

program.parse(process.argv);
