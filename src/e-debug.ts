#!/usr/bin/env node

import * as childProcess from 'node:child_process';
import * as path from 'node:path';

import { program } from 'commander';

import * as evmConfig from './evm-config.js';
import { fatal } from './utils/logging.js';
import { commandExists } from './utils/which.js';
import type { SanitizedConfig } from './types.js';

const opts: childProcess.ExecFileSyncOptionsWithStringEncoding = {
  encoding: 'utf8',
  stdio: 'inherit',
};

program.description('Run the Electron build with a debugger (gdb or lldb)').action(debug);

function run_gdb(config: SanitizedConfig): void {
  const electron = evmConfig.execOf(config);
  const gdbinit = path.resolve(config.root, 'src', 'tools', 'gdb', 'gdbinit');
  const ex = `source ${gdbinit}`;
  const args = [electron, '-quiet' /*skip copyright msg*/, '-ex', ex];
  childProcess.execFileSync('gdb', args, opts);
}

function run_lldb(config: SanitizedConfig): void {
  const electron = evmConfig.execOf(config);
  const lldbinit = path.resolve(config.root, 'src', 'tools', 'lldb', 'lldbinit.py');
  const args = [
    '-O' /* run before any file loads */,
    `command script import ${lldbinit}`,
    electron,
  ];
  childProcess.execFileSync('lldb', args, opts);
}

function debug(): void {
  try {
    const choices = [
      { exec: 'gdb', runner: run_gdb },
      { exec: 'lldb', runner: run_lldb },
    ];

    const choice = choices.find((c) => commandExists(c.exec));
    if (choice) {
      choice.runner(evmConfig.current());
    } else {
      fatal(
        `No debugger found in PATH! Looked for [${choices.map((c) => `'${c.exec}'`).join(', ')}]`,
      );
    }
  } catch (e) {
    fatal(e);
  }
}

program.parse(process.argv);
