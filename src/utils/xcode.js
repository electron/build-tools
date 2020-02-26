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
  'https://electron-build-tools.s3-us-west-2.amazonaws.com'}/macos/Xcode-10.3.zip`;

const expectedXcodeHash = '51acff28efa4742c86962b93f8fab9f2';

function ensureXcode() {
  if (!fs.existsSync(XcodePath)) {
    ensureDir(XcodeDir);
    let shouldDownload = true;
    if (fs.existsSync(XcodeZip)) {
      const existingHash = hashFile(XcodeZip);
      if (existingHash === expectedXcodeHash) shouldDownload = false;
      else
        console.log(
          `${color.warn} Got existing hash ${color.cmd(
            existingHash,
          )} which did not match ${color.cmd(expectedXcodeHash)} so redownloading Xcode`,
        );
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

    fs.renameSync(path.resolve(unzipPath, 'Xcode.app'), XcodePath);
    rimraf.sync(XcodeZip);
    rimraf.sync(unzipPath);
  }
}

function hashFile(file) {
  console.log(`Calculating hash for ${color.path(file)}`);
  return childProcess
    .spawnSync(process.execPath, [path.resolve(__dirname, 'hash.js'), file])
    .stdout.toString()
    .trim();
}

module.exports = {
  XcodePath,
  ensureXcode,
};
