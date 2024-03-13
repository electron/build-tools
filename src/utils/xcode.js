const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const { ensureDir } = require('./paths');
const evmConfig = require('../evm-config');

const { color, fatal } = require('./logging');
const { deleteDir } = require('./paths');

const XcodeDir = path.resolve(__dirname, '..', '..', 'third_party', 'Xcode');
const XcodePath = path.resolve(XcodeDir, 'Xcode.app');
const XcodeZip = path.resolve(XcodeDir, 'Xcode.zip');
const XcodeBaseURL = 'https://dev-cdn.electronjs.org/xcode/';

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
  '13.2.1': {
    fileName: 'Xcode-13.2.1.zip',
    md5: 'cb1193a5a23eeeb4e9c5fd87557be8ce',
  },
  '13.3.0': {
    fileName: 'Xcode-13.3.0.zip',
    md5: 'b216a27212fdd0be922d83687aad22bf',
  },
  '14.1.0': {
    fileName: 'Xcode-14.1.0.zip',
    md5: '3dc1a4d8bc6abd5448be4f2d96a04f62',
  },
  '14.3.0': {
    fileName: 'Xcode-14.3.0.zip',
    md5: '4bc9043b275625568f81d9727ad6aef8',
  },
  '15.0.0': {
    fileName: 'Xcode-15.0.zip',
    md5: 'eb5d8dad732e6893991d86fb205c5c48',
  },
};

const fallbackXcode = () => {
  return Object.keys(XcodeVersions)
    .map(v => {
      return semver.valid(semver.coerce(v));
    })
    .sort(semver.rcompare)[0];
};

function getXcodeVersion() {
  const result = cp.spawnSync('defaults', [
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

function removeUnusedXcodes() {
  const recent = fs
    .readdirSync(XcodeDir)
    .map(xcode => {
      const xcodePath = path.join(XcodeDir, xcode);
      const { atime } = fs.statSync(xcodePath);
      return { name: xcodePath, atime };
    })
    .sort((a, b) => b.atime - a.atime);

  const { preserveXcode } = evmConfig.current();
  for (const { name } of recent.slice(preserveXcode)) {
    deleteDir(name);
  }
}

function extractXcodeVersion(config) {
  const legacyMatch = /xcode: "?(\d+.\d+.\d+?)"?/.exec(config);
  if (legacyMatch) return legacyMatch[1];

  const modernMatch = /description: "xcode version"\n[\S\s]+default: (\d+.\d+.\d+?)\n/gm.exec(
    config,
  );
  if (modernMatch) return modernMatch[1];

  const chromiumMatch = /Xcode (\d+\.\d+(\.\d+)?)/.exec(config);
  if (chromiumMatch) return chromiumMatch[1];

  return null;
}

function expectedXcodeVersion(target) {
  const { root, defaultTarget } = evmConfig.current();

  let version;

  // First check CI build_config.yml
  if (!version) {
    const buildConfYaml = path.resolve(root, 'src', 'electron', '.circleci', 'build_config.yml');
    version =
      fs.existsSync(buildConfYaml) && extractXcodeVersion(fs.readFileSync(buildConfYaml, 'utf8'));
  }

  // Second check CI config.yml
  if (!version) {
    const configYaml = path.resolve(root, 'src', 'electron', '.circleci', 'config.yml');
    version = fs.existsSync(configYaml) && extractXcodeVersion(fs.readFileSync(configYaml, 'utf8'));
  }

  // Third check base.yml
  if (!version) {
    const baseYaml = path.resolve(root, 'src', 'electron', '.circleci', 'config', 'base.yml');
    version = fs.existsSync(baseYaml) && extractXcodeVersion(fs.readFileSync(baseYaml, 'utf8'));
  }

  // Finally check build/mac_toolchain.py if we're building Chromium.
  if ([target, defaultTarget].includes('chrome')) {
    const macToolchainPy = path.resolve(root, 'src', 'build', 'mac_toolchain.py');
    version =
      fs.existsSync(macToolchainPy) && extractXcodeVersion(fs.readFileSync(macToolchainPy, 'utf8'));
  }

  const coerced = semver.coerce(version);
  if (!semver.valid(coerced)) {
    console.warn(
      color.warn,
      `failed to automatically identify the required version of Xcode - falling back
to default of`,
      fallbackXcode(),
    );
    return fallbackXcode();
  } else {
    version = coerced.version;
  }

  if (!XcodeVersions[version]) {
    console.warn(
      color.warn,
      `automatically detected an unknown version of Xcode ${color.path(
        version,
      )} - falling back to default of`,
      fallbackXcode(),
    );
    return fallbackXcode();
  }

  // macOS Ventura only supports Xcode 14 and newer.
  const productVersion = cp
    .execSync('sw_vers -productVersion')
    .toString()
    .trim();
  const isVenturaOrHigher = semver.coerce(productVersion).major >= 13;

  if (isVenturaOrHigher && !semver.gt(version, '14.0.0')) {
    console.warn(
      color.warn,
      `Xcode ${version} is not supported on macOS Ventura - falling back to default of`,
      fallbackXcode(),
    );
    return fallbackXcode();
  }

  return version;
}

function fixBadVersioned103() {
  const bad = path.resolve(XcodeDir, `Xcode-10.3.app`);
  const good = path.resolve(XcodeDir, `Xcode-10.3.0.app`);
  if (fs.existsSync(bad)) {
    if (fs.existsSync(good)) {
      deleteDir(bad);
    } else {
      fs.renameSync(bad, good);
    }
  }
}

function ensureXcode(target) {
  const expected = expectedXcodeVersion(target);
  fixBadVersioned103();

  const shouldEnsureXcode = !fs.existsSync(XcodePath) || getXcodeVersion() !== expected;

  if (shouldEnsureXcode) {
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
          deleteDir(XcodeZip);
        }
      }

      if (shouldDownload) {
        const XcodeURL = `${XcodeBaseURL}${XcodeVersions[expected].fileName}`;
        console.log(`Downloading ${color.cmd(XcodeURL)} into ${color.path(XcodeZip)}`);
        const { status } = cp.spawnSync(
          process.execPath,
          [path.resolve(__dirname, '..', 'download.js'), XcodeURL, XcodeZip],
          {
            stdio: 'inherit',
          },
        );

        if (status !== 0) {
          deleteDir(XcodeZip);
          fatal(`Failure while downloading Xcode zip`);
        }

        const newHash = hashFile(XcodeZip);
        if (newHash !== expectedXcodeHash) {
          deleteDir(XcodeZip);
          fatal(
            `Downloaded Xcode zip had hash "${newHash}" which does not match expected hash "${expectedXcodeHash}"`,
          );
        }
      }

      console.log(`Extracting ${color.cmd(XcodeZip)} into ${color.path(eventualVersionedPath)}`);
      const unzipPath = path.resolve(XcodeDir, 'tmp_unzip');
      deleteDir(unzipPath);
      cp.spawnSync('unzip', ['-q', '-o', XcodeZip, '-d', unzipPath], {
        stdio: 'inherit',
      });

      fs.renameSync(path.resolve(unzipPath, 'Xcode.app'), eventualVersionedPath);
      deleteDir(XcodeZip);
      deleteDir(unzipPath);
    }

    if (fs.existsSync(XcodePath)) {
      if (fs.statSync(XcodePath).isSymbolicLink()) {
        fs.unlinkSync(XcodePath);
      } else {
        const versionedXcode = path.resolve(XcodeDir, `Xcode-${getXcodeVersion()}.app`);
        if (!fs.existsSync(versionedXcode)) {
          fs.renameSync(XcodePath, versionedXcode);
        } else {
          deleteDir(XcodePath);
        }
      }
    }

    console.log(`Updating active Xcode version to ${color.path(expected)}`);
    fs.symlinkSync(eventualVersionedPath, XcodePath);
  }

  deleteDir(XcodeZip);

  removeUnusedXcodes();

  return true;
}

function hashFile(file) {
  console.log(`Calculating hash for ${color.path(file)}`);
  return cp
    .spawnSync('md5', ['-q', file])
    .stdout.toString()
    .trim();
}

module.exports = {
  XcodePath,
  ensureXcode,
};
