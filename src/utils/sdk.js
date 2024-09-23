const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const { ensureDir } = require('./paths');
const evmConfig = require('../evm-config');

const { color, fatal } = require('./logging');
const { deleteDir } = require('./paths');

const SDKDir = path.resolve(__dirname, '..', '..', 'third_party', 'SDKs');
const SDKZip = path.resolve(SDKDir, 'MacOSX.sdk.zip');

const XcodeBaseURL = 'https://dev-cdn.electronjs.org/xcode/';

const SDKs = {
  '15.0': {
    fileName: 'MacOSX-15.0.sdk.zip',
    sha256: '03d6d8d9a06aebee886cf136168ccbdb8579b80f7193376a36075ddde06abd88',
  },
  '14.0': {
    fileName: 'MacOSX-14.0.sdk.zip',
    sha256: '63c0e69c60c3e0f25b42726fc3a0f0f2902b5cac304d78456c33e13f9dd6d081',
  },
  '13.3': {
    fileName: 'MacOSX-13.3.sdk.zip',
    sha256: '78b99db2e6f0fba2ffeef0d2dfb25e6b700483e3f18cdaf9a18a9a3f9ed10cfa',
  },
  '13.0': {
    fileName: 'MacOSX-13.0.sdk.zip',
    sha256: '689ae09a4287d2711bd137e48a675635e0d66fdcfb3cf8a324c4b3f03c2cf883',
  },
  '12.3': {
    fileName: 'MacOSX-12.3.sdk.zip',
    sha256: '4fb95f95d439f1d1eaf5c89e3e2b842ac746b96273908f8bf8d732a39597e78f',
  },
};

const fallbackSDK = () => {
  const semverFallback = Object.keys(SDKs)
    .map(v => semver.valid(semver.coerce(v)))
    .sort(semver.rcompare)[0];
  return semverFallback.substring(0, semverFallback.length - 2);
};

function getSDKVersion() {
  const { SDKROOT } = evmConfig.current().env;

  if (!fs.existsSync(SDKROOT)) {
    return 'unknown';
  }

  const settingsPath = path.resolve(SDKROOT, 'SDKSettings.json');
  const data = fs.readFileSync(settingsPath, 'utf8');
  const json = JSON.parse(data);

  return json.MinimalDisplayName;
}

// Extract the SDK version from the toolchain file and normalize it.
function extractSDKVersion(toolchainFile) {
  if (!fs.existsSync(toolchainFile)) {
    return null;
  }

  const contents = fs.readFileSync(toolchainFile, 'utf8');
  const match = /macOS\s(\d+(\.\d+)?)\sSDK\n\#/.exec(contents);

  if (!match) {
    return null;
  }

  return match[1].includes('.') ? match[1] : `${match[1]}.0`;
}

function expectedSDKVersion() {
  const { root } = evmConfig.current();

  // The current Xcode version and associated SDK can be found in build/mac_toolchain.py.
  const macToolchainPy = path.resolve(root, 'src', 'build', 'mac_toolchain.py');
  const version = extractSDKVersion(macToolchainPy);

  if (isNaN(Number(version)) || !SDKs[version]) {
    console.warn(
      color.warn,
      `Automatically detected an unknown macOS SDK ${color.path(
        version,
      )} - falling back to default of`,
      fallbackSDK(),
    );
    return fallbackSDK();
  }

  return version;
}

function ensureSDKAndSymlink(config) {
  const localPath = ensureSDK();

  const outDir = evmConfig.outDir(config);

  const outRelative = path.join('xcode_links', 'electron', path.basename(localPath));
  const xcodeLink = path.resolve(outDir, outRelative);
  if (!fs.existsSync(xcodeLink)) {
    fs.mkdirSync(path.dirname(xcodeLink), {
      recursive: true,
    });
    fs.symlinkSync(localPath, xcodeLink);
  }

  return `//out/${path.basename(outDir)}/${outRelative}`;
}

function ensureSDK() {
  // For testing purposes
  if (process.env.__VITEST__) {
    console.log('TEST: ensureSDK called');
    return;
  }

  const expected = expectedSDKVersion();
  const eventualVersionedPath = path.resolve(SDKDir, `MacOSX${expected}.sdk`);

  const shouldEnsureSDK = !fs.existsSync(eventualVersionedPath) || getSDKVersion() !== expected;

  if (shouldEnsureSDK) {
    ensureDir(SDKDir);
    const expectedSDKHash = SDKs[expected].sha256;

    if (!fs.existsSync(eventualVersionedPath)) {
      let shouldDownload = true;
      if (fs.existsSync(SDKZip)) {
        const existingHash = hashFile(SDKZip);
        if (existingHash === expectedSDKHash) {
          shouldDownload = false;
        } else {
          console.log(
            `${color.warn} Got existing hash ${color.cmd(
              existingHash,
            )} which did not match ${color.cmd(expectedSDKHash)} so redownloading SDK`,
          );
          deleteDir(SDKZip);
        }
      }

      if (shouldDownload) {
        const sdkURL = `${XcodeBaseURL}${SDKs[expected].fileName}`;
        console.log(`Downloading ${color.cmd(sdkURL)} into ${color.path(SDKZip)}`);
        const { status } = cp.spawnSync(
          process.execPath,
          [path.resolve(__dirname, '..', 'download.js'), sdkURL, SDKZip],
          {
            stdio: 'inherit',
          },
        );

        if (status !== 0) {
          deleteDir(SDKZip);
          fatal(`Failure while downloading SDK zip`);
        }

        const newHash = hashFile(SDKZip);
        if (newHash !== expectedSDKHash) {
          deleteDir(SDKZip);
          fatal(
            `Downloaded SDK zip had hash "${newHash}" which does not match expected hash "${expectedSDKHash}"`,
          );
        }
      }

      console.log(`Extracting ${color.cmd(SDKZip)} into ${color.path(eventualVersionedPath)}`);
      const unzipPath = path.resolve(SDKDir, 'tmp_unzip');

      // Ensure the unzip path is clean before extracting the SDK.
      deleteDir(unzipPath);

      try {
        const { status } = cp.spawnSync('unzip', ['-q', '-o', SDKZip, '-d', unzipPath], {
          stdio: 'inherit',
        });
        if (status !== 0) {
          fatal('Failure while extracting SDK zip');
        }
      } catch (error) {
        deleteDir(SDKZip);
        deleteDir(unzipPath);
        fatal(error);
      }

      fs.renameSync(path.resolve(unzipPath, 'MacOSX.sdk'), eventualVersionedPath);
      deleteDir(SDKZip);
      deleteDir(unzipPath);
    }

    evmConfig.setEnvVar(evmConfig.currentName(), 'SDKROOT', eventualVersionedPath);

    console.log(`${color.info} Now using SDK version ${color.path(getSDKVersion())}`);
  }

  deleteDir(SDKZip);

  return eventualVersionedPath;
}

// Hash MacOSX.sdk directory zip with sha256.
function hashFile(file) {
  console.log(`Calculating hash for ${color.path(file)}`);
  return cp
    .spawnSync('shasum', ['-a', '256', file])
    .stdout.toString()
    .split(' ')[0]
    .trim();
}

module.exports = {
  ensureSDK,
  ensureSDKAndSymlink,
};
