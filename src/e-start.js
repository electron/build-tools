#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');
const fs = require('fs');
const semver = require('semver');
const program = require('commander');

const evmConfig = require('./evm-config');
const { color, fatal } = require('./utils/logging');

program
  .allowUnknownOption()
  .option(
    '--v <version>',
    'A specific version binary of Electron to run the specified app with. Must have set the binary directory in the current config.',
  )
  .option('--path <path>', 'Path to an Electron executable')
  .on('--help', () => {
    console.log('');
    console.log('Examples:');
    console.log('');
    console.log('  $ e start .');
    console.log('  $ e start /path/to/app');
    console.log('  $ e start --v=1.2.3 /path/to/app');
    console.log('  $ e start --path=/path/to/electron/exec /path/to/app');
    console.log('  $ e start /path/to/app --js-flags');
  })
  .parse(process.argv);

try {
  const config = evmConfig.current();

  let exec;
  let args;
  if (program.v) {
    const binDir = config.electronBinaryDirectory;
    if (!binDir) {
      console.error(`${color.err} config.electronBinaryDirectory not defined or not valid`);
      process.exit(1);
    } else if (!semver.valid(program.v)) {
      console.error(`${color.err} ${color.cmd(program.v)} must be a valid semantic version`);
      process.exit(1);
    }

    const binaryPath = path.resolve(binDir, program.v);
    if (!fs.existsSync(binaryPath)) {
      console.error(
        `${color.err} Could not find Electron in ${color.path(
          path.join(binDir, program.v),
        )}. Please download it and try again.`,
      );
      process.exit(1);
    }

    args = program.rawArgs.slice(4);
    exec = path.join(binaryPath, evmConfig.electronExecPath());
  } else if (program.path) {
    if (!fs.existsSync(program.path)) {
      console.error(
        `${color.err} ${color.path(program.path)} does not contain a valid Electron executable.`,
      );
      process.exit(1);
    }
    args = program.rawArgs.slice(4);
    exec = path.join(program.path, evmConfig.electronExecPath());
  } else {
    args = program.rawArgs.slice(2);
    exec = evmConfig.execOf(config);
  }

  const opts = { stdio: 'inherit' };
  console.log(color.childExec(exec, args, opts));
  childProcess.execFileSync(exec, args, opts);
} catch (e) {
  fatal(e);
}
