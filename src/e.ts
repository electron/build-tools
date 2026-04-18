#!/usr/bin/env node

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { program } from 'commander';

import * as evmConfig from './evm-config.js';
import { color, fatal } from './utils/logging.js';
import * as depot from './utils/depot-tools.js';
import { ensurePrereqs } from './utils/prereqs.js';
import { refreshPathVariable } from './utils/refresh-path.js';
import { ensureSDK } from './utils/sdk.js';

// Refresh the PATH variable at the top of this shell so that retries in the same shell get the latest PATH variable
refreshPathVariable();

// Fail fast on unsupported Node.js / Python runtimes before doing any work.
ensurePrereqs();

function maybeCheckForUpdates(): void {
  // skip auto-update check if disabled
  //
  // NB: send updater's stdout to stderr so its log messages are visible
  // but don't pollute stdout. For example, calling `FOO="$(e show exec)"`
  // should not get a FOO that includes "Checking for build-tools updates".
  const disableAutoUpdatesFile = path.resolve(import.meta.dirname, '..', '.disable-auto-updates');
  if (fs.existsSync(disableAutoUpdatesFile)) {
    console.error(`${color.info} Auto-updates disabled - skipping update check`);
    return;
  }

  // Skip auto-update check if we checked out a specific commit.
  if (process.env['BUILD_TOOLS_SHA']) {
    console.error(
      `${color.info} build-tools checked out at a specific commit - skipping update check`,
    );
    return;
  }

  // Don't check if we already checked recently
  const intervalHours = 4;
  const updateCheckTSFile = path.resolve(import.meta.dirname, '..', '.update');
  const lastCheckEpochMsec = fs.existsSync(updateCheckTSFile)
    ? parseInt(fs.readFileSync(updateCheckTSFile, 'utf8'), 10)
    : 0;
  const needCheckAfter = lastCheckEpochMsec + 1000 * 60 * 60 * intervalHours;
  if (Date.now() < needCheckAfter) {
    return;
  }

  // Run the updater script.
  //
  // NB: send updater's stdout to stderr so its log messages are visible
  // but don't pollute stdout. For example, calling `FOO="$(e show exec)"`
  // should not get a FOO that includes "Checking for build-tools updates".
  cp.spawnSync(process.execPath, ['e-auto-update.js'], {
    cwd: import.meta.dirname,
    stdio: [0, 2, 2],
  });

  // Update the last-checked-at timestamp.
  fs.writeFileSync(updateCheckTSFile, `${Date.now()}`);

  // Re-run the current invocation with the updated build-tools.
  const result = cp.spawnSync(
    process.execPath,
    process.argv[0] === process.execPath ? process.argv.slice(1) : process.argv,
    {
      cwd: process.cwd(),
      stdio: 'inherit',
    },
  );
  process.exit(result.status ?? 0);
}

maybeCheckForUpdates();
evmConfig.resetShouldWarn();

program.description('Electron build tool').usage('<command> [commandArgs...]');

program
  .command('init [options] <name>', 'Create a new build config')
  .alias('new')
  .command(
    'worktree <subcommand>',
    'Manage gclient working directories that share git objects with an existing checkout',
  )
  .command('sync [gclientArgs...]', 'Get or update source code')
  .command('build [options]', 'Build Electron and other things')
  .alias('make')
  .command(
    'depot-tools [depotToolsArgs...]',
    'Run a command from the depot-tools directory with the correct configuration',
  )
  .alias('d');

program
  .command('start [args...]')
  .alias('run')
  .description('Run the Electron executable')
  .allowUnknownOption()
  .action((args: string[]) => {
    try {
      const exec = evmConfig.execOf(evmConfig.current());
      if (!fs.existsSync(exec)) {
        fatal(`Could not find Electron executable at ${color.path(exec)}`);
      }

      const opts: cp.ExecFileSyncOptions = { stdio: 'inherit' };
      console.log(color.childExec(exec, args, opts));
      cp.execFileSync(exec, args, opts);
    } catch (e) {
      fatal(e);
    }
  })
  .on('--help', () => {
    console.log('');
    console.log('Examples:');
    console.log('');
    console.log('  $ e start .');
    console.log('  $ e start /path/to/app');
    console.log('  $ e start /path/to/app --js-flags');
  });

program
  .command('node [args...]')
  .description('Run the Electron build as if it were a Node.js executable')
  .allowUnknownOption()
  .action((args: string[]) => {
    try {
      const exec = evmConfig.execOf(evmConfig.current());
      const opts: cp.ExecFileSyncOptions = {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'inherit',
      };
      console.log(color.childExec(exec, args, opts));
      cp.execFileSync(exec, args, opts);
    } catch (e) {
      fatal(e);
    }
  })
  .on('--help', () => {
    console.log('');
    console.log('Examples:');
    console.log('');
    console.log('  $ e node .');
    console.log('  $ e node /path/to/app');
  });

program.command('debug', 'Run the Electron build with a debugger (gdb or lldb)');

program
  .command('use <name>')
  .description('Use build config <name> when running other `e` commands')
  .action((name: string) => {
    try {
      evmConfig.setCurrent(name);
      console.log(`Now using config ${color.config(name)}`);
      process.exit(0);
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('remove <name>')
  .alias('rm')
  .description('Remove build config <name> from list')
  .action((name: string) => {
    try {
      evmConfig.remove(name);
      console.log(`Removed config ${color.config(name)}`);
      process.exit(0);
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('backport [pr]', 'Assists with manual backport processes')
  .command('show <subcommand>', 'Show info about the current build config')
  .command('test [specRunnerArgs...]', `Run Electron's spec runner`)
  .command('pr [subcommand]', 'Work with PRs to electron/electron')
  .command('patches <target>', 'Refresh the patches in $root/src/electron/patches/$target')
  .command('open <sha1|PR#>', 'Open a GitHub URL for the given commit hash / pull # / issue #')
  .command('auto-update', 'Check for build-tools updates or enable/disable automatic updates')
  .alias('check-for-updates')
  .command(
    'cherry-pick <patch-url> <target-branch> [additionalBranchesOrUrls...]',
    'Opens a PR to electron/electron that backports the given CL(s) into our patches folder',
  )
  .alias('auto-cherry-pick')
  .command('gh-auth', 'Generates a device oauth token')
  .command(
    'rcv <roll-pr> [chromium-version]',
    'Attempts to reconstruct an intermediate Chromium version from a roll PR',
  )
  .alias('reconstruct-chromium-version');

program
  .command('load-macos-sdk [version]')
  .description('Loads required versions of macOS SDKs and symlinks them (may require sudo)')
  .action((version: string | undefined) => {
    ensureSDK(version);
  });

program
  .command('sanitize-config [name]')
  .description('Update and overwrite an existing config to conform to latest build-tools updates')
  .action((name: string | undefined) => {
    try {
      const configName = name ?? evmConfig.currentName();
      evmConfig.sanitizeConfigWithName(configName, true);
      console.log(`${color.success} Sanitized contents of ${color.config(configName)}`);
      process.exit(0);
    } catch (e) {
      fatal(e);
    }
  });

program
  .command('npm')
  .description(
    'Run a command that eventually spawns the electron NPM package but override the Electron binary that is used to be your local from-source electron',
  )
  .allowUnknownOption()
  .helpOption('\0')
  .action(() => {
    const args = process.argv.slice(3);
    if (args.length === 0 || !args[0]) {
      fatal(`Must provide a command to 'e npm'`);
    }

    const { status, error } = depot.spawnSync(evmConfig.current(), args[0], args.slice(1), {
      stdio: 'inherit',
      env: {
        ELECTRON_OVERRIDE_DIST_PATH: evmConfig.outDir(evmConfig.current()),
      },
    });

    if (status !== 0) {
      let errorMsg = `Failed to run command:`;
      if (status !== null) errorMsg += `\n Exit Code: "${status}"`;
      if (error) errorMsg += `\n ${error}`;
      fatal(errorMsg, status ?? 1);
    }

    process.exit(0);
  });

program
  .command('shell')
  .description(
    "Launch a shell environment populated with build-tools' environment variables and context",
  )
  .action(() => {
    depot.ensure();

    if (!['linux', 'darwin'].includes(process.platform)) {
      fatal(`'e shell' is not supported on non-unix platforms`);
    }

    const shell = process.env['SHELL'];
    if (!shell) {
      fatal('Could not detect shell to launch');
    }

    console.info(`Launching build-tools shell with ${color.cmd(shell)}`);
    const { status } = depot.spawnSync(evmConfig.current(), shell, [], {
      stdio: 'inherit',
      env: {
        ...process.env,
        SHELL_CONTEXT: evmConfig.currentName(),
      },
    });
    process.exit(status ?? 0);
  });

program.on('--help', () => {
  console.log(`
See https://github.com/electron/build-tools/blob/main/README.md for usage.`);
});

program.executableDir(import.meta.dirname);
program.parse(process.argv);
