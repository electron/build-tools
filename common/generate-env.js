const fs = require('fs');
const path = require('path');

const loadConfig = require('./load-config');
const { configRoot, resolveConfiguredPath } = require('./util');

function createEnv(configFile) {
  const config = loadConfig(configFile);

  const envVars = {
    GIT_CACHE_PATH: resolveConfiguredPath(config.gitCachePath),
    ELECTRON_GN_ROOT: resolveConfiguredPath(config.electronRoot),
    ELECTRON_OUT_DIR: config.electronOutDir || 'Debug',

    // '/path/to/config.foo.yml' -> 'foo'
    CONFIG_NAME: path.basename(configFile).match(/^config\.(.*)\.yml$/)[1]
  };

  if (process.platform === 'win32') {
    envVars.DEPOT_TOOLS_WIN_TOOLCHAIN = '0';
    envVars.GYP_MSVS_VERSION = '2017';
  }

  envVars.ELECTRON_GIT_ORIGIN = 'git@github.com:electron/electron.git';
  envVars.NODE_GIT_ORIGIN = 'git@github.com:electron/node.git';
  if (config.gitUseHttps) {
    envVars.NODE_GIT_ORIGIN = 'https://github.com/electron/node';
    envVars.ELECTRON_GIT_ORIGIN = 'https://github.com/electron/electron';
  }

  envVars.CHROMIUM_BUILDTOOLS_PATH = path.resolve(envVars.ELECTRON_GN_ROOT, 'src', 'buildtools');

  envVars.SCCACHE_TWO_TIER = 'true';
  envVars.SCCACHE_CACHE_SIZE = '20G';
  envVars.SCCACHE_BUCKET = 'electronjs-sccache-ci';

  envVars.EXTRA_GN_ARGS = `"${config.extraGnArgs || ''}"`;
  envVars.GN_IMPORT_NAME = config.buildType || 'debug';

  return envVars;
}

function main (configFile) {
  const win = process.platform === 'win32';
  const envFile = path.resolve(configRoot, `generated.env.${win?'bat':'sh'}`);
  console.log(`generating '${envFile}' from '${configFile}'`);

  const envVars = createEnv(configFile);
  const shouldExport = (key) => key === 'CHROMIUM_BUILDTOOLS_PATH';

  if (win) {
    fs.writeFileSync(envFile,
  `@echo off

  rem |-------------------- !!!! WARNING !!!! ---------------------|
  rem | This file is auto-generated, please do not modify manually |
  rem |------------------------------------------------------------|

  ${Object.entries(envVars).map(([key, val]) => `set ${key}=${val}`).sort().join('\n')}
  `,
    );
  } else {
    fs.writeFileSync(envFile,
`#!/usr/bin/env bash

# |-------------------- !!!! WARNING !!!! ---------------------|
# | This file is auto-generated, please do not modify manually |
# |------------------------------------------------------------|

${Object.entries(envVars).map(([key, val]) => `${shouldExport(key) ? 'export ' : ''}${key}=${val}`).sort().join('\n')}
`
    );
    fs.chmodSync(
      envFile,
      fs.constants.S_IRUSR | fs.constants.S_IRGRP | fs.constants.S_IROTH |
      fs.constants.S_IWUSR |
      fs.constants.S_IXUSR | fs.constants.S_IXGRP | fs.constants.S_IXOTH
    );
  }
}

if (process.mainModule === module) {
  if (process.argv.length < 3) {
    console.log('Usage: node generate-env /path/to/configFile')
    process.exit(1)
  }
  main(process.argv[2])
} else {
  module.exports = main
}
