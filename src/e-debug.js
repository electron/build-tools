#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');

const { sync: commandExistsSync } = require('command-exists');
const program = require('commander');

const evmConfig = require('./evm-config');
const { fatal } = require('./utils/logging');

const opts = {
  encoding: 'utf8',
  stdio: 'inherit',
};

program.description('Run the Electron build with a debugger (gdb or lldb)').action(debug);

function run_gdb(config) {
  const electron = evmConfig.execOf(config);
  const gdbinit = path.resolve(config.root, 'src', 'tools', 'gdb', 'gdbinit');
  const ex = `source ${gdbinit}`;
  const args = [electron, '-quiet' /*skip copyright msg*/, '-ex', ex];
  childProcess.execFileSync('gdb', args, opts);
}

function run_lldb(config) {
  const electron = evmConfig.execOf(config);
  const lldbinit = path.resolve(config.root, 'src', 'tools', 'lldb', 'lldbinit.py');
  const args = [
    '-O' /* run before any file loads */,
    `command script import ${lldbinit}`,
    electron,
  ];
  childProcess.execFileSync('lldb', args, opts);
}

function debug() {
  try {
    const choices = [
      { exec: 'gdb', runner: run_gdb },
      { exec: 'lldb', runner: run_lldb },
    ];

    const choice = choices.find((choice) => commandExistsSync(choice.exec));
    if (choice) {
      choice.runner(evmConfig.current());
    } else {
      fatal(
        `No debugger found in PATH! Looked for [${choices
          .map((choice) => `'${choice.exec}'`)
          .join(', ')}]`,
      );
    }
  } catch (e) {
    fatal(e);
  }
}

program.parse(process.argv);
