#!/usr/bin/env node

const { default: chalk } = require('chalk');
const { program, InvalidArgumentError } = require('commander');

const { fatal } = require('../utils/logging');
const { archOption, ArchTypes, BuildTypes } = require('./common');

const { APPVEYOR_CLOUD_TOKEN } = process.env;

const cancelAppveyorBuild = async (id) => {
  const { statusCode } = await fetch(
    `https://ci.appveyor.com/api/builds/electron-bot/${ArchTypes[arch]}/${id}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${APPVEYOR_CLOUD_TOKEN}`,
      },
    },
  ).then((resp) => resp.json());

  const msg = statusCode === 204 ? 'Successfully cancelled' : 'Failed to cancel';
  console.info(`${chalk.white(`${msg} Appveyor ${ArchTypes[arch]} build with id ${id}`)}`);
};

program
  .description('Cancel CI workflows and builds')
  .argument('<id>', 'The ID of the workflow or build to cancel')
  .addOption(archOption)
  .action(async (id, { arch }) => {
    try {
      if (!arch) {
        throw new InvalidArgumentError('arch is required for Appveyor cancellations');
      } else if (!APPVEYOR_CLOUD_TOKEN) {
        fatal('process.env.APPVEYOR_CLOUD_TOKEN required for AppVeyor cancellations');
      }

      await cancelAppveyorBuild(id, arch);
    } catch (e) {
      fatal(e.message);
    }
  });

program.parse(process.argv);
