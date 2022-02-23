#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const program = require('commander');

const { color, fatal } = require('./utils/logging');
const Xcode = require('./utils/xcode');

program
  .description('Load and link a specific version of XCode')
  .option('--list-targets', 'Show all supported patch targets', false)
  .option('--version [version]', 'Forces a specific Xcode version', null)
  .option('--quiet', 'Run without verbose output', false)
  .action(loadXCode)
  .parse(process.argv);

function loadXCode() {
  try {
    if (process.platform !== 'darwin') {
      console.error('Should only configure Xcode on darwin platform');
      process.exit(1);
    }

    if (Xcode.ensureXcode(program.version) === false) {
      process.exit(0);
    }

    // Select our new xcode
    const output = childProcess.execFileSync('xcode-select', ['-p']).toString();
    if (!output.trim().startsWith(Xcode.XcodePath)) {
      console.info(
        `Setting your Xcode installation to ${color.path(Xcode.XcodePath)}, this will require sudo`,
      );
      childProcess.execFileSync('sudo', ['xcode-select', '-s', Xcode.XcodePath], {
        stdio: 'inherit',
      });
    }

    // Ensure that we have accepted the Xcode license agreement
    const out = childProcess.spawnSync('lldb', ['--help']);
    if (out.status !== 0 && out.stderr.toString().includes('xcodebuild')) {
      console.info('You need to accept the Xcode license agreement, this will require sudo');
      childProcess.execFileSync('sudo', ['xcodebuild', '-license', 'accept']);
    }

    const SDK_TO_UNLINK = ['10.12', '10.13', '10.14', '10.15'];

    const xCodeSDKDir = path.resolve(
      Xcode.XcodePath,
      'Contents',
      'Developer',
      'Platforms',
      'MacOSX.platform',
      'Developer',
      'SDKs',
    );

    if (!fs.existsSync(xCodeSDKDir)) {
      console.error('Could not find Xcode SDK directory. Please ensure you have installed Xcode');
      process.exit(1);
    }

    // Unlink unnecessary macOS SDKs that we have linked in the past
    for (const sdk of SDK_TO_UNLINK) {
      // Check that target exists.
      const targetDirectory = path.resolve(xCodeSDKDir, `MacOSX${sdk}.sdk`);
      if (!fs.existsSync(targetDirectory)) continue;

      // Check that target is a valid symbolic link.
      const stats = fs.lstatSync(targetDirectory);
      if (!stats.isSymbolicLink()) return;

      // Check if the link is to the default SDK that we should have
      if (
        fs.realpathSync(targetDirectory) ===
        fs.realpathSync(path.resolve(xCodeSDKDir, 'MacOSX.sdk'))
      )
        return;

      console.warn(`${color.info} Removing symbolic link ${color.path(targetDirectory)}`);

      childProcess.execFileSync('unlink', [targetDirectory]);
    }

    if (!program.quiet) console.log(color.success);
  } catch (e) {
    fatal(e);
  }
}
