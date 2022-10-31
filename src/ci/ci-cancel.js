#!/usr/bin/env node

const { default: chalk } = require('chalk');
const { program } = require('commander');
const got = require('got');

const { fatal } = require('../utils/logging');
const { archOption, ArchTypes, BuildTypes, getCIType } = require('./common');

const { CIRCLE_TOKEN, APPVEYOR_CLOUD_TOKEN } = process.env;

const APPVEYOR_ACCOUNT_NAME = 'electron-bot';

const cancelAppveyorBuild = async id => {
  const { statusCode } = await got
    .delete(
      `https://ci.appveyor.com/api/builds/${APPVEYOR_ACCOUNT_NAME}/${ArchTypes[arch]}/${id}`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${APPVEYOR_CLOUD_TOKEN}`,
        },
      },
    )
    .json();

  const msg = statusCode === 204 ? 'Successfully cancelled' : 'Failed to cancel';
  console.info(`${chalk.white(`${msg} Appveyor ${ArchTypes[arch]} build with id ${id}`)}`);
};

const cancelCircleCIWorkflow = async id => {
  const { stopped_at } = await got(`https://circleci.com/api/v2/workflow/${id}`, {
    username: CIRCLE_TOKEN,
    password: '',
  }).json();

  // Don't try to cancel completed builds.
  if (stopped_at !== null) {
    console.log(`${chalk.white(`${msg} Could not cancel completed CircleCI build with id ${id}`)}`);
    return;
  }

  const { message } = await got
    .post(`https://circleci.com/api/v2/workflow/${id}/cancel`, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      username: CIRCLE_TOKEN,
      password: '',
    })
    .json();

  const msg = message === 'Accepted.' ? 'Successfully cancelled' : 'Failed to cancel';
  console.log(`${chalk.white(`${msg} CircleCI workflow with id ${id}`)}`);
};

program
  .description('Cancel CI workflows and builds')
  .argument('<id>', 'The ID of the workflow or build to cancel')
  .addOption(archOption)
  .action(async (id, { arch }) => {
    try {
      const type = getCIType(id);

      if (type === BuildTypes.CIRCLECI) {
        if (!CIRCLE_TOKEN) {
          fatal('process.env.CIRCLE_TOKEN required for AppVeyor cancellations');
        }

        await cancelCircleCIWorkflow(id);
      } else if (type === BuildTypes.APPVEYOR) {
        if (!arch) {
          throw new commander.InvalidArgumentError('arch is required for Appveyor cancellations');
        } else if (!APPVEYOR_CLOUD_TOKEN) {
          fatal('process.env.APPVEYOR_CLOUD_TOKEN required for AppVeyor cancellations');
        }

        await cancelAppveyorBuild(id, arch);
      }
    } catch (e) {
      fatal(e.message);
    }
  });

program.parse(process.argv);
