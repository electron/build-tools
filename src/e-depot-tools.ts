#!/usr/bin/env node

import * as os from 'node:os';

import { program } from 'commander';

import * as evmConfig from './evm-config';
import { fatal } from './utils/logging';
import * as depot from './utils/depot-tools';
import * as reclient from './utils/reclient';

program
  .command('depot-tools')
  .description('Run a command from the depot-tools directory with the correct configuration')
  .allowUnknownOption()
  .helpOption('\0')
  .action(() => {
    depot.ensure();

    const args = process.argv.slice(2);
    if (args.length === 0 || !args[0]) {
      fatal(`Must provide a command to 'e depot-tools'`);
    }

    if (args[0] === 'auto-update') {
      const sub = args[1];
      if (sub !== 'enable' && sub !== 'disable') {
        fatal(`${sub} is not a valid argument - options are 'enable' or 'disable'`);
      }

      const enable = sub === 'enable';
      depot.setAutoUpdate(enable);
      return;
    }

    let cwd: string | undefined;
    if (args[0] === 'rbe') {
      reclient.downloadAndPrepareRBECredentialHelper(evmConfig.current());
      args[0] = reclient.helperPath(evmConfig.current());
    }

    if (args[0] === '--') {
      args.shift();
    }

    const cmd = args[0];
    if (!cmd) {
      fatal(`Must provide a command to 'e depot-tools'`);
    }

    const { status, error } = depot.spawnSync(evmConfig.maybeCurrent(), cmd, args.slice(1), {
      ...(cwd ? { cwd } : {}),
      stdio: 'inherit',
      env: {
        ...process.env,
        AGREE_NOTGOMA_TOS: '1',
      },
      shell: os.platform() === 'win32',
    });

    if (status !== 0) {
      let errorMsg = `Failed to run command:`;
      if (status !== null) errorMsg += `\n Exit Code: "${status}"`;
      if (error) errorMsg += `\n ${error}`;
      fatal(errorMsg, status ?? 1);
    }

    process.exit(0);
  })
  .parse(process.argv);
