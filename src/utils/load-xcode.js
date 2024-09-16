#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const depot = require('./depot-tools');
const { color, fatal } = require('./logging');
const Xcode = require('./xcode');
const evmConfig = require('../evm-config');

function loadXcode(options = {}) {
  const quiet = options.quiet || false;

  if (process.platform !== 'darwin') {
    fatal('Should only configure Xcode on darwin platform');
  }

  // For testing purposes
  if (process.env.__VITEST__) {
    console.log('TEST: loadXcode called');
    return;
  }

  if (Xcode.ensureXcode() === false) {
    return;
  }

  const { env } = depot.opts(evmConfig.current());

  // Ensure that we have accepted the Xcode license agreement
  const out = childProcess.spawnSync('lldb', ['--help'], { env });
  if (out.status !== 0 && out.stderr.toString().includes('xcodebuild')) {
    console.info('You need to accept the Xcode license agreement, this will require sudo');
    childProcess.execFileSync('sudo', ['xcodebuild', '-license', 'accept'], { env });
  }

  // Ensure XcodeSystemResources is installed
  const result = childProcess.execSync('pkgutil --pkgs', { env });
  const isSystemResourcesInstalled = result
    .toString()
    .split('\n')
    .some(pkg => pkg.trim() === 'com.apple.pkg.XcodeSystemResources');
  if (!isSystemResourcesInstalled) {
    console.log(
      `Looks like XcodeSystemResources have not been installed on this machine yet, in order to initialize Xcode we will attempt to install them now, this may prompt for your password`,
    );
    childProcess.execFileSync(
      'sudo',
      [
        'installer',
        '-pkg',
        path.resolve(
          Xcode.XcodePath,
          'Contents',
          'Resources',
          'Packages',
          'XcodeSystemResources.pkg',
        ),
        '-target',
        '/',
      ],
      {
        stdio: 'inherit',
        env,
      },
    );
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
    fatal('Could not find Xcode SDK directory. Please ensure you have installed Xcode');
  }

  // Unlink unnecessary macOS SDKs that we have linked in the past
  for (const sdk of SDK_TO_UNLINK) {
    // Check that target exists.
    const targetDirectory = path.resolve(xCodeSDKDir, `MacOSX${sdk}.sdk`);
    if (!fs.existsSync(targetDirectory)) continue;

    // Check that target is a valid symbolic link.
    const stats = fs.lstatSync(targetDirectory);
    if (!stats.isSymbolicLink()) continue;

    // Check if the link is to the default SDK that we should have
    if (
      fs.realpathSync(targetDirectory) === fs.realpathSync(path.resolve(xCodeSDKDir, 'MacOSX.sdk'))
    )
      continue;

    console.warn(`${color.info} Removing symbolic link ${color.path(targetDirectory)}`);

    childProcess.execFileSync('unlink', [targetDirectory], { env });
  }

  if (!quiet) console.log(color.success);
}

module.exports = {
  loadXcode,
};
