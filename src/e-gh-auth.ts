#!/usr/bin/env node

import { program } from 'commander';

import { createGitHubAuthToken } from './utils/github-auth';
import { fatal } from './utils/logging';

program
  .description('Generates a device auth token for the electron org that build-tools can use')
  .option('--shell', 'Print an export command such that "eval $(e gh-auth --shell)" works')
  .allowExcessArguments(false)
  .action(async ({ shell }: { shell?: boolean }) => {
    try {
      const token = await createGitHubAuthToken(['repo']);
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
