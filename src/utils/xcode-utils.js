const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const zip = require('cross-zip');
const { ensureDir } = require('./e-utils');

const XcodeDir = path.resolve(__dirname, '..', 'third_party', 'Xcode');
const XcodePath = path.resolve(XcodeDir, 'Xcode.app');
const XcodeZip = path.resolve(XcodeDir, 'Xcode.zip');
const XcodeURL = 'https://electron-build-tools.s3-us-west-2.amazonaws.com/macos/Xcode-10.3.zip';

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
        [path.resolve(__dirname, 'download.js'), XcodeURL, XcodeZip],
        {
          stdio: 'inherit',
        },
      );
    }

    const unzipPath = path.resolve(XcodeDir, 'tmp_unzip');
    rimraf.sync(unzipPath);
    zip.unzipSync(XcodeZip, unzipPath);

    fs.renameSync(path.resolve(unzipPath, 'Xcode.app'), XcodePath);
    rimraf.sync(XcodeZip);
    rimraf.sync(unzipPath);
  }
}

module.exports = {
  Xcode: {
    XcodePath,
    ensureXcode,
  }
}
