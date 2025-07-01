#!/usr/bin/env node

import childProcess from 'node:child_process';
import path from 'node:path';
import { program, Option } from 'commander';

import * as evmConfig from './evm-config.js';
import { ensureNodeHeaders } from './utils/headers.js';
import { color, fatal } from './utils/logging.js';
import { EVMBaseElectronConfiguration } from './evm-config.schema.js';

function runSpecRunner(
  config: EVMBaseElectronConfiguration,
  script: string,
  runnerArgs: string[],
): void {
  const exec = process.execPath;
  const args = [script, ...runnerArgs];
  const opts = {
    stdio: 'inherit',
    encoding: 'utf8',
    cwd: path.resolve(config.root, 'src', 'electron'),
    env: {
      ELECTRON_OUT_DIR: config.gen.out,
      npm_config_node_gyp: path.resolve(
        import.meta.dirname,
        '..',
        'node_modules',
        'node-gyp',
        'bin',
        'node-gyp.js',
      ),
      ...process.env,
      ...config.env,
    },
  } as const;
  console.log(color.childExec(exec, args, opts));
  childProcess.execFileSync(exec, args, opts);
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
  .addOption(
    new Option(
      '--runners <runner>',
      'A subset of tests to run - not used with either the node or nan specs',
    ).choices(['main', 'native']),
  )
  .action((specRunnerArgs, options) => {
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
      fatal(e as Error);
    }
  })
  .parse(process.argv);
