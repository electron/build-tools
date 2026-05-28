#!/usr/bin/env node

import { Command } from 'commander';

import { downloadDist, DownloadDistOptions } from './utils/download-dist.js';

const program = new Command();

program
  .argument('<pull_request_number_or_commit_sha>')
  .description('Download a pull request or commit dist')
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
      'Defaults to ~/.electron_build_tools/artifacts/pr_{number}_{commithash}_{platform}_{arch} ' +
      'or ~/.electron_build_tools/artifacts/commit_{sha}_{platform}_{arch}',
  )
  .option(
    '-s, --skip-confirmation',
    'Skip the confirmation prompt before downloading the dist.',
    !!process.env['CI'],
  )
  .action(async (source: string, options: DownloadDistOptions) => {
    await downloadDist(source, options);
  })
  .parse(process.argv);
