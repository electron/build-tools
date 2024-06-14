#!/usr/bin/env node

const program = require('commander');
const os = require('os');

const evmConfig = require('./evm-config');
const { fatal } = require('./utils/logging');
const depot = require('./utils/depot-tools');
const reclient = require('./utils/reclient');

program
  .command('depot-tools')
  .description('Run a command from the depot-tools directory with the correct configuration')
  .allowUnknownOption()
  .helpOption('\0')
  .action(() => {
    depot.ensure();

    const args = process.argv.slice(2);
    if (args.length === 0) {
      fatal(`Must provide a command to 'e depot-tools'`);
    }

    if (args[0] === 'auto-update') {
      if (!['enable', 'disable'].includes(args[1])) {
        fatal(`${args[1]} is not a valid argument - options are 'enable' or 'disable'`);
      }

      const enable = args[1] === 'enable';
      depot.setAutoUpdate(enable);
      return;
    }

    let cwd;
    if (args[0] === 'rbe') {
      reclient.downloadAndPrepare(evmConfig.current(), true);
      args[0] = reclient.helperPath(evmConfig.current());
    }

    if (args[0] === '--') {
      args.shift();
    }

    const { status, error } = depot.spawnSync(evmConfig.maybeCurrent(), args[0], args.slice(1), {
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
      fatal(errorMsg, status);
    }

    process.exit(0);
  })
  .parse(process.argv);
