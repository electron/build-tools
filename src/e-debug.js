#!/usr/bin/env node

const childProcess = require('child_process');
const commandExistsSync = require('command-exists').sync;
const path = require('path');

const evmConfig = require('./evm-config');
const { fatal } = require('./util');

const opts = {
  encoding: 'utf8',
  stdio: 'inherit',
};

function run_gdb(config) {
  const exec = evmConfig.execOf(config);
  const gdbinit = path.resolve(config.root, 'src', 'tools', 'gdb', 'gdbinit');
  const ex = `source ${gdbinit}`;
  const args = [exec, '-q', '-ex', ex];
  childProcess.execFileSync('gdb', args, opts);
}

function run_lldb(config) {
  const exec = evmConfig.execOf(config);
  const args = [exec];
  childProcess.execFileSync('lldb', args, opts);
}

try {
  const config = evmConfig.current();
  if (commandExistsSync('gdb')) {
    run_gdb(config);
  } else if (commandExistsSync('lldb')) {
    run_lldb(config);
  } else {
    throw `No debugger found!`;
  }
} catch (e) {
  fatal(e);
}
