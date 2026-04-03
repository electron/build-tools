#!/usr/bin/env node

import * as childProcess from 'node:child_process';
import * as path from 'node:path';

import { program, Option } from 'commander';

import * as evmConfig from './evm-config';
import { ensureNodeHeaders } from './utils/headers';
import { color, fatal } from './utils/logging';
import type { SanitizedConfig } from './types';

function runSpecRunner(config: SanitizedConfig, script: string, runnerArgs: string[]): void {
  const exec = process.execPath;
  const args = [script, ...runnerArgs];
  const opts: childProcess.ExecFileSyncOptionsWithStringEncoding = {
    stdio: 'inherit',
    encoding: 'utf8',
    cwd: path.resolve(config.root, 'src', 'electron'),
    env: {
      ELECTRON_OUT_DIR: config.gen.out,
      ...process.env,
      ...config.env,
    },
  };
  console.log(color.childExec(exec, args, opts));
  childProcess.execFileSync(exec, args, opts);
}

interface TestOptions {
  electronVersion?: string;
  node: boolean;
  nan: boolean;
  remote: boolean;
  disableLogging?: boolean;
  runners?: 'main' | 'native';
}

program
  .argument('[specRunnerArgs...]')
  .allowUnknownOption()
  .option('--electronVersion <version>', 'Electron release to run tests against')
  .option('--node', 'Run node spec runner', false)
  .option('--nan', 'Run nan spec runner', false)
  .option(
    '--no-remote',
    'Build test runner components (e.g. electron:node_headers) without remote execution',
  )
  .option('--disable-logging', "Don't add the --enable-logging flag for the spec runner")
  .addOption(
    new Option(
      '--runners <runner>',
      'A subset of tests to run - not used with either the node or nan specs',
    ).choices(['main', 'native']),
  )
  .action((specRunnerArgs: string[], options: TestOptions) => {
    try {
      const config = evmConfig.current();
      if (options.node && options.nan) {
        fatal(
          'Can not run both node and nan specs at the same time, --node and --nan are mutually exclusive',
        );
      }
      if (options.runners) {
        specRunnerArgs.push(`--runners=${options.runners}`);
      }
      if (options.electronVersion) {
        specRunnerArgs.push(`--electronVersion=${options.electronVersion}`);
      }
      if (!options.disableLogging) {
        specRunnerArgs.push('--enable-logging');
      }
      let script = './script/spec-runner.js';
      if (options.node) {
        script = './script/node-spec-runner.js';
      }
      if (options.nan) {
        script = './script/nan-spec-runner.js';
      }
      if (!options.electronVersion) {
        ensureNodeHeaders(config, options.remote);
      }
      runSpecRunner(config, script, specRunnerArgs);
    } catch (e) {
      fatal(e);
    }
  })
  .parse(process.argv);
