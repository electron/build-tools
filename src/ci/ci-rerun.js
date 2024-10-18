#!/usr/bin/env node

const { default: chalk } = require('chalk');
const { program, InvalidArgumentError } = require('commander');

const { archOption, ArchTypes, BuildTypes } = require('./common');
const { fatal } = require('../utils/logging');
const { APPVEYOR_CLOUD_TOKEN } = process.env;

const rerunAppveyorBuild = async (id, options) => {
  const data = await fetch(`https://ci.appveyor.com/api/builds`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${APPVEYOR_CLOUD_TOKEN}`,
    },
    body: JSON.stringify({
      buildId: id,
      reRunIncomplete: options.fromFailed,
    }),
  }).then((resp) => resp.json());
  console.log(`${chalk.bgMagenta(chalk.white('Build Rerun'))}

⦿ ${chalk.white(
    `https://ci.appveyor.com/project/electron-bot/${ArchTypes[options.arch]}/builds/${
      data.buildId
    }`,
  )}
  `);
};

program
  .description('Rerun CI workflows')
  .argument('<id>', 'The ID of the workflow or build to rerun')
  .option('-f, --from-failed', 'Rerun workflow from failed/incomplete', true)
  .addOption(archOption)
  .action(async (id, options) => {
    try {
      if (!options.arch) {
        throw new InvalidArgumentError('arch is required for Appveyor reruns');
      } else if (!APPVEYOR_CLOUD_TOKEN) {
        fatal('process.env.APPVEYOR_CLOUD_TOKEN required for AppVeyor reruns');
      }

      await rerunAppveyorBuild(id, options);
    } catch (e) {
      fatal(e.message);
    }
  });

program.parse(process.argv);
