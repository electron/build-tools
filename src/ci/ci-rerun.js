#!/usr/bin/env node

const { default: chalk } = require('chalk');
const program = require('commander');
const got = require('got');

const { fatal } = require('../utils/logging');

program
  .description('Rerun CI workflows')
  .argument('[workflow]', 'The ID of the workflow to rerun')
  .option('-f, --from-failed', 'Rerun workflow from failed', true)
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
    } catch (e) {
      fatal(e.message);
    }
  });

program.parse(process.argv);
