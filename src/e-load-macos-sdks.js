#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { color, macOSSDKs } = require('./util');

if (process.platform !== 'darwin') {
  console.error('Should only configure macOS SDKs on darwin platform');
  process.exit(1);
}

macOSSDKs.ensure();

const SDK_TO_LINK = ['10.13', '10.14', '10.15'];

const xCodeSDKDir = path.resolve(
  '/Applications',
  'Xcode.app',
  'Contents',
  'Developer',
  'Platforms',
  'MacOSX.platform',
  'Developer',
  'SDKs',
);
if (!fs.existsSync(xCodeSDKDir)) {
  console.error('Could not find Xcode SDK directory.  Please ensure you have installed Xcode');
  process.exit(1);
}

for (const sdk of SDK_TO_LINK) {
  const sourceSDK = path.resolve(macOSSDKs.path, `MacOSX${sdk}.sdk`);
  if (!fs.existsSync(sourceSDK)) continue;

  const targetDirectory = path.resolve(xCodeSDKDir, `MacOSX${sdk}.sdk`);
  if (fs.existsSync(targetDirectory)) continue;

  console.warn(
    `${color.info} Creating a symbolic link from ${color.path(sourceSDK)} --> ${color.path(
      targetDirectory,
    )}`,
  );

  childProcess.execFileSync('sudo', ['ln', '-s', sourceSDK, targetDirectory]);
}

const output = childProcess.execFileSync('xcode-select', ['-p']).toString();
if (!output.trim().includes('Xcode.app')) {
  console.warn(
    `${color.warn} Looks like your Xcode is not configured correctly, running a command to fix it now`,
  );
  console.info(`Setting your Xcode installation to ${color.path('/Applications/Xcode.app')}`);
  childProcess.execFileSync('sudo', ['xcode-select', '-s', '/Applications/Xcode.app']);
}

console.log(color.done);
