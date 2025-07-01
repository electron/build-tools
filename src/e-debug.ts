#!/usr/bin/env node

import childProcess from 'node:child_process';
import path from 'node:path';

import { sync as commandExistsSync } from 'command-exists';
import { program } from 'commander';

import * as evmConfig from './evm-config.js';
import { fatal } from './utils/logging.js';
import { EVMBaseElectronConfiguration } from './evm-config.schema.js';

const opts = {
  encoding: 'utf8',
  stdio: 'inherit',
} as const;

program.description('Run the Electron build with a debugger (gdb or lldb)').action(debug);

function run_gdb(config: EVMBaseElectronConfiguration): void {
  const electron = evmConfig.execOf(config);
  const gdbinit = path.resolve(config.root, 'src', 'tools', 'gdb', 'gdbinit');
  const ex = `source ${gdbinit}`;
  const args = [electron, '-quiet' /*skip copyright msg*/, '-ex', ex];
  childProcess.execFileSync('gdb', args, opts);
}

function run_lldb(config: EVMBaseElectronConfiguration): void {
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
    fatal(e as Error);
  }
}

program.parse(process.argv);
