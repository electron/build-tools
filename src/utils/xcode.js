const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const { ensureDir } = require('./paths');

const { color } = require('./logging');

const XcodeDir = path.resolve(__dirname, '..', '..', 'third_party', 'Xcode');
const XcodePath = path.resolve(XcodeDir, 'Xcode.app');
const XcodeZip = path.resolve(XcodeDir, 'Xcode.zip');
const XcodeURL = `${process.env.ELECTRON_BUILD_TOOLS_MIRROR ||
  'https://electron-build-tools.s3-us-west-2.amazonaws.com'}/macos/Xcode-11.1.zip`;
const EXPECTED_XCODE_VERSION = '11.1';

const expectedXcodeHash = 'f24c258035ed1513afc96eaa9a2500c0';

function getXcodeVersion() {
  const result = childProcess.spawnSync('defaults', [
    'read',
    path.resolve(XcodePath, 'Contents', 'Info.plist'),
    'CFBundleShortVersionString',
  ]);
  if (result.status === 0) {
    return result.stdout.toString().trim();
  }
  return 'unknown';
}

function ensureXcode() {
  if (!fs.existsSync(XcodePath) || getXcodeVersion() !== EXPECTED_XCODE_VERSION) {
    ensureDir(XcodeDir);
    let shouldDownload = true;
    if (fs.existsSync(XcodeZip)) {
      const existingHash = hashFile(XcodeZip);
      if (existingHash === expectedXcodeHash) {
        shouldDownload = false;
      } else {
        console.log(
          `${color.warn} Got existing hash ${color.cmd(
            existingHash,
          )} which did not match ${color.cmd(expectedXcodeHash)} so redownloading Xcode`,
        );
        rimraf.sync(XcodeZip);
      }
    }

    if (shouldDownload) {
      console.log(`Downloading ${color.cmd(XcodeURL)} into ${color.path(XcodeZip)}`);
      childProcess.spawnSync(
        process.execPath,
        [path.resolve(__dirname, '..', 'download.js'), XcodeURL, XcodeZip],
        {
          stdio: 'inherit',
        },
      );
    }

    console.log(`Extracting ${color.cmd(XcodeZip)} into ${color.path(XcodePath)}`);
    const unzipPath = path.resolve(XcodeDir, 'tmp_unzip');
    rimraf.sync(unzipPath);
    childProcess.spawnSync('unzip', ['-q', '-o', XcodeZip, '-d', unzipPath], {
      stdio: 'inherit',
    });

    // We keep the old Xcode around to avoid redownloading incase we ever want
    // build-tools to support hot-switching of Xcode versions
    if (fs.existsSync(XcodePath)) {
      const versionedXcode = path.resolve(XcodeDir, `Xcode-${getXcodeVersion()}.app`);
      if (!fs.existsSync(versionedXcode)) {
        fs.renameSync(XcodePath, versionedXcode);
      } else {
        rimraf.sync(XcodePath);
      }
    }
    fs.renameSync(path.resolve(unzipPath, 'Xcode.app'), XcodePath);
    rimraf.sync(XcodeZip);
    rimraf.sync(unzipPath);
  }
}

function hashFile(file) {
  console.log(`Calculating hash for ${color.path(file)}`);
  return childProcess
    .spawnSync('md5', ['-q', file])
    .stdout.toString()
    .trim();
}

module.exports = {
  XcodePath,
  ensureXcode,
};
