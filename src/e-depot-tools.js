#!/usr/bin/env node

const program = require('commander');
const os = require('os');

const evmConfig = require('./evm-config');
const { fatal } = require('./utils/logging');
const depot = require('./utils/depot-tools');
const goma = require('./utils/goma');
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

    const current = evmConfig.current();

    let cwd;
    if (['goma_ctl', 'goma_auth'].includes(args[0])) {
      goma.downloadAndPrepare(current);
      cwd = goma.dir;
      args[0] = `${args[0]}.py`;
      args.unshift('python3');
    }

    if (args[0] === 'rbe') {
      reclient.downloadAndPrepare(current, true);
      args[0] = reclient.helperPath(current);
    }

    if (args[0] === '--') {
      args.shift();
    }

    const { status, error } = depot.spawnSync(current, args[0], args.slice(1), {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        AGREE_NOTGOMA_TOS: '1',
      },
    });

    if (status !== 0) {
      let errorMsg = `Failed to run command:`;
      if (status !== null) errorMsg += `\n Exit Code: "${status}"`;
      if (error) errorMsg += `\n ${error}`;
      fatal(errorMsg, status);
    }

    if (
      ['python', 'python3'].includes(args[0]) &&
      args.slice(1, 3).join(' ') === 'goma_auth.py logout'
    ) {
      goma.clearGomaLoginTime();
    }

    process.exit(0);
  })
  .parse(process.argv);
