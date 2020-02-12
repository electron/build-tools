#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { color, fatal } = require('./utils/logging');
const { ensureDir } = require('./utils/paths');

function ensureNodeHeaders(config) {
  const src_dir = path.resolve(config.root, 'src');
  const out_dir = evmConfig.outDir(config);
  const node_headers_dir = path.resolve(out_dir, 'gen', 'node_headers');
  const electron_spec_dir = path.resolve(src_dir, 'electron', 'spec');

  let needs_build;
  try {
    const filename = path.resolve(electron_spec_dir, 'package.json');
    const package_time = fs.lstatSync(filename);
    const headers_time = fs.lstatSync(node_headers_dir);
    needs_build = package_time > headers_time;
  } catch {
    needs_build = true;
  }

  if (needs_build) {
    const exec = 'node';
    const args = [path.resolve(__dirname, 'e'), 'build', 'node:headers'];
    const opts = { stdio: 'inherit', encoding: 'utf8' };
    childProcess.execFileSync(exec, args, opts);
  }

  if (process.platform === 'win32') {
    ensureDir(path.resolve(node_headers_dir, 'Release'));
    fs.copyFileSync(
      path.resolve(out_dir, 'electron.lib'),
      path.resolve(node_headers_dir, 'Release', 'node.lib'),
    );
  }
}

function runSpecRunner(config, script, runnerArgs) {
  const exec = 'node';
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
        'node-gyp',
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
  .parse(process.argv);

try {
  const runnerArgs = program.parseOptions(process.argv).unknown;
  const config = evmConfig.current();
  const script = program.node ? './script/node-spec-runner.js' : './script/spec-runner.js';
  ensureNodeHeaders(config);
  runSpecRunner(config, script, runnerArgs);
} catch (e) {
  fatal(e);
}
