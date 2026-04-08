#!/usr/bin/env node

import * as fs from 'node:fs';

import { extractSDKVersion } from '../../../dist/utils/sdk.js';
import SDKs from '../../../src/utils/sdks.json' with { type: 'json' };

function isNewerVersion(v1, v2) {
  const [major1, minor1] = v1.split('.').map(Number);
  const [major2, minor2] = v2.split('.').map(Number);

  if (major1 !== major2) {
    return major1 > major2;
  }
  return minor1 > minor2;
}

function main() {
  try {
    const macToolchainPath = process.argv[2];

    if (!macToolchainPath || !fs.existsSync(macToolchainPath)) {
      console.error(`Error: Could not find ${macToolchainPath || 'mac_toolchain.py'}`);
      console.error('Usage: node check-sdk-version.mjs <path-to-mac_toolchain.py>');
      process.exit(1);
    }

    const chromiumSDK = extractSDKVersion(macToolchainPath);
    console.log(`Chromium SDK version: ${chromiumSDK}`);

    if (!chromiumSDK) {
      console.error('Error: Could not extract SDK version from mac_toolchain.py');
      process.exit(1);
    }

    const knownSDKs = Object.keys(SDKs);
    console.log(`Known SDK versions: ${knownSDKs.join(', ')}`);

    if (knownSDKs.includes(chromiumSDK)) {
      console.log(`✓ SDK ${chromiumSDK} is already in sdks.json`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', 'new-sdk=false\n');
      process.exit(0);
    }

    const latestKnownSDK = knownSDKs.sort((a, b) => {
      const [major1, minor1] = a.split('.').map(Number);
      const [major2, minor2] = b.split('.').map(Number);
      if (major1 !== major2) return major2 - major1;
      return minor2 - minor1;
    })[0];

    console.log(`Latest known SDK: ${latestKnownSDK}`);

    if (isNewerVersion(chromiumSDK, latestKnownSDK)) {
      console.log(`✗ New SDK detected: ${chromiumSDK} is newer than ${latestKnownSDK}`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `new-sdk=true\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `sdk-version=${chromiumSDK}\n`);
      process.exit(0);
    } else {
      console.log(
        `Note: SDK ${chromiumSDK} is not in sdks.json but is not newer than ${latestKnownSDK}`,
      );
      fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', 'new-sdk=false\n');
      process.exit(0);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
