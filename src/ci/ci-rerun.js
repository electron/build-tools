#!/usr/bin/env node

const { default: chalk } = require('chalk');
const program = require('commander');
const got = require('got');

const { fatal } = require('../utils/logging');

program
  .description('Show information about CI job statuses')
  .argument('[workflow]', 'The ID of the workflow to rerun')
  .option('-f, --from-failed', 'Rerun workflow from failed', false)
  .option('-e, --enable-ssh', 'Rerun workflow from failed', false)
  .action(async (workflow, options) => {
    try {
      const { pipeline_number } = await got(`https://circleci.com/api/v2/workflow/${workflow}`, {
        username: process.env.CIRCLE_TOKEN,
        password: '',
      }).json();

      const { workflow_id } = await got
        .post(`https://circleci.com/api/v2/workflow/${workflow}/rerun`, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          username: process.env.CIRCLE_TOKEN,
          password: '',
          json: {
            enable_ssh: options.enableSsh,
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
    } catch (e) {
      fatal(e.message);
    }
  });

program.parse(process.argv);
