#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { ensureNodeHeaders } = require('./utils/headers');
const { color, fatal } = require('./utils/logging');

function runSpecRunner(config, script, runnerArgs) {
  const exec = process.execPath;
  const args = [script, ...runnerArgs];
  const opts = {
    stdio: 'inherit',
    encoding: 'utf8',
    cwd: path.resolve(config.root, 'src', 'electron'),
    env: {
      ELECTRON_OUT_DIR: config.gen.out,
      npm_config_node_gyp: path.resolve(
        __dirname,
        '..',
        'node_modules',
        'node-gyp',
        'bin',
        'node-gyp.js',
      ),
      ...process.env,
      ...config.env,
    },
  };
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
    new program.Option(
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
      fatal(e);
    }
  })
  .parse(process.argv);
