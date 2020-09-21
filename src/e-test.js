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
  .arguments('[specRunnerArgs...]')
  .allowUnknownOption()
  .option('--node', 'Run node spec runner', false)
  .option('--nan', 'Run nan spec runner', false)
  .option(
    '--runners=<main|remote|native>',
    "A subset of tests to run - either 'main', 'remote', or 'native', not used with either the node or nan specs",
  )
  .parse(process.argv);

try {
  const runnerArgs = program.parseOptions(process.argv).unknown;
  const config = evmConfig.current();
  if (program.node && program.nan) {
    fatal(
      'Can not run both node and nan specs at the same time, --node and --nan are mutually exclusive',
    );
  }
  let script = './script/spec-runner.js';
  if (program.node) {
    script = './script/node-spec-runner.js';
  }
  if (program.nan) {
    script = './script/nan-spec-runner.js';
  }
  ensureNodeHeaders(config);
  runSpecRunner(config, script, runnerArgs);
} catch (e) {
  fatal(e);
}
