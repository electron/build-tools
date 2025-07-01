#!/usr/bin/env node

import { program } from 'commander';
import os from 'node:os';

import * as evmConfig from './evm-config.js';
import { fatal } from './utils/logging.js';
import { setDepotToolsAutoUpdate, ensureDepotTools, depotSpawnSync } from './utils/depot-tools.js';
import * as reclient from './utils/reclient.js';

program
  .command('depot-tools')
  .description('Run a command from the depot-tools directory with the correct configuration')
  .allowUnknownOption()
  .helpOption('\0')
  .action(() => {
    ensureDepotTools();

    const args = process.argv.slice(2);
    if (args.length === 0) {
      fatal(`Must provide a command to 'e depot-tools'`);
    }

    if (args[0] === 'auto-update') {
      if (!['enable', 'disable'].includes(args[1])) {
        fatal(`${args[1]} is not a valid argument - options are 'enable' or 'disable'`);
      }

      const enable = args[1] === 'enable';
      setDepotToolsAutoUpdate(enable);
      return;
    }

    let cwd;
    if (args[0] === 'rbe') {
      reclient.downloadAndPrepareRBECredentialHelper(evmConfig.current());
      args[0] = reclient.getHelperPath(evmConfig.current());
    }

    if (args[0] === '--') {
      args.shift();
    }

    const { status, error } = depotSpawnSync(evmConfig.maybeCurrent(), args[0], args.slice(1), {
      cwd,
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
