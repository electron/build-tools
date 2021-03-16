const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const { ensureDir } = require('./paths');
const { getIsArm } = require('./arm');
const evmConfig = require('../evm-config');

const { color, fatal } = require('./logging');

const XcodeDir = path.resolve(__dirname, '..', '..', 'third_party', 'Xcode');
const XcodePath = path.resolve(XcodeDir, 'Xcode.app');
const XcodeZip = path.resolve(XcodeDir, 'Xcode.zip');
const XcodeBaseURL = `${process.env.ELECTRON_BUILD_TOOLS_MIRROR ||
  'https://electron-build-tools.s3-us-west-2.amazonaws.com'}/macos/`;

const XcodeVersions = {
  '9.4.1': {
    fileName: 'Xcode-9.4.1.zip',
    md5: '84be26baae0ce613e64306e0c39162ae',
  },
  '11.1.0': {
    fileName: 'Xcode-11.1.zip',
    md5: 'f24c258035ed1513afc96eaa9a2500c0',
  },
  '10.3.0': {
    fileName: 'Xcode-10.3.0.zip',
    md5: 'df587e65d9243fc87b22db617e23c376',
  },
  '11.5.0': {
    fileName: 'Xcode-11.5.zip',
    md5: '2665cc451d86e58bac68dcced0a22945',
  },
  '12.0.0-UA': {
    fileName: 'Xcode-12.0.0-UA.zip',
    md5: '28c3f8a906be53361260b01fa5792baa',
  },
  '12.2.0': {
    fileName: 'Xcode-12.2.0.zip',
    md5: 'd1bfc9b5bc829ec81b999b78c5795508',
  },
  '12.4.0': {
    fileName: 'Xcode-12.4.0.zip',
    md5: '20828f7208e67f99928cc88aaafca00c',
  },
};

const fallbackXcode = '11.1.0';

function getXcodeVersion() {
  const result = childProcess.spawnSync('defaults', [
    'read',
    path.resolve(XcodePath, 'Contents', 'Info.plist'),
    'CFBundleShortVersionString',
  ]);
  if (result.status === 0) {
    const v = result.stdout.toString().trim();
    if (v.split('.').length === 2) return `${v}.0`;
    return v;
  }
  return 'unknown';
}

function expectedXcodeVersion() {
  const { root } = evmConfig.current();
  const yaml = path.resolve(root, 'src', 'electron', '.circleci', 'config.yml');
  const match = /xcode: "(.+?)"/.exec(fs.readFileSync(yaml, 'utf8'));
  if (!match) {
    console.warn(
      color.warn,
      'failed to automatically identify the required version of Xcode, falling back to default of',
      fallbackXcode,
    );
    return fallbackXcode;
  }
  const version = match[1].trim();
  if (!XcodeVersions[version]) {
    console.warn(
      color.warn,
      `automatically detected an unknown version of Xcode ${color.path(
        version,
      )}, falling back to default of`,
      fallbackXcode,
    );
    return fallbackXcode;
  }
  return version;
}

function fixBadVersioned103() {
  const bad = path.resolve(XcodeDir, `Xcode-10.3.app`);
  const good = path.resolve(XcodeDir, `Xcode-10.3.0.app`);
  if (fs.existsSync(bad)) {
    if (fs.existsSync(good)) {
      rimraf.sync(bad);
    } else {
      fs.renameSync(bad, good);
    }
  }
}

function ensureXcode() {
  const expected = expectedXcodeVersion();
  fixBadVersioned103();

  const shouldEnsureXcode = !fs.existsSync(XcodePath) || getXcodeVersion() !== expected;
  const isArm = getIsArm();

  // For now, do not download a custom version of Xcode
  // if running on ARM / Apple Silicon
  if (shouldEnsureXcode && !isArm) {
    ensureDir(XcodeDir);
    const expectedXcodeHash = XcodeVersions[expected].md5;
    const eventualVersionedPath = path.resolve(XcodeDir, `Xcode-${expected}.app`);

    if (!fs.existsSync(eventualVersionedPath)) {
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
        const XcodeURL = `${XcodeBaseURL}${XcodeVersions[expected].fileName}`;
        console.log(`Downloading ${color.cmd(XcodeURL)} into ${color.path(XcodeZip)}`);
        childProcess.spawnSync(
          process.execPath,
          [path.resolve(__dirname, '..', 'download.js'), XcodeURL, XcodeZip],
          {
            stdio: 'inherit',
          },
        );

        const newHash = hashFile(XcodeZip);
        if (newHash !== expectedXcodeHash) {
          rimraf.sync(XcodeZip);
          fatal(
            `Downloaded Xcode zip had hash "${newHash}" which does not match expected hash "${expectedXcodeHash}"`,
          );
        }
      }

      console.log(`Extracting ${color.cmd(XcodeZip)} into ${color.path(eventualVersionedPath)}`);
      const unzipPath = path.resolve(XcodeDir, 'tmp_unzip');
      rimraf.sync(unzipPath);
      childProcess.spawnSync('unzip', ['-q', '-o', XcodeZip, '-d', unzipPath], {
        stdio: 'inherit',
      });

      fs.renameSync(path.resolve(unzipPath, 'Xcode.app'), eventualVersionedPath);
      rimraf.sync(XcodeZip);
      rimraf.sync(unzipPath);
    }

    // We keep the old Xcode around to avoid redownloading incase we ever want
    // build-tools to support hot-switching of Xcode versions
    if (fs.existsSync(XcodePath)) {
      if (fs.statSync(XcodePath).isSymbolicLink()) {
        fs.unlinkSync(XcodePath);
      } else {
        const versionedXcode = path.resolve(XcodeDir, `Xcode-${getXcodeVersion()}.app`);
        if (!fs.existsSync(versionedXcode)) {
          fs.renameSync(XcodePath, versionedXcode);
        } else {
          rimraf.sync(XcodePath);
        }
      }
    }

    console.log(`Updating active Xcode version to ${color.path(expected)}`);
    fs.symlinkSync(eventualVersionedPath, XcodePath);
  }
  rimraf.sync(XcodeZip);
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
