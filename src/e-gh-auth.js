#!/usr/bin/env node

const d = require('debug')('build-tools:gh-auth');
const program = require('commander');

const { getGitHubAuthToken } = require('./utils/github-auth');
const { fatal } = require('./utils/logging');

program
  .description('Generates a device auth token for the electron org that build-tools can use')
  .option('--shell', 'Print an export command such that "eval $(e gh-auth --shell)" works')
  .allowUnknownOption(false)
  .action(async ({ shell }) => {
    try {
      const token = await getGitHubAuthToken(['repo']);
      if (shell) {
        console.log(`export ELECTRON_BUILD_TOOLS_GH_AUTH="${token}"`);
      } else {
        console.log('Token:', token);
      }
    } catch (err) {
      console.error('Failed to authenticate');
      fatal(err);
    }
  })
  .parse(process.argv);
