const fs = require('fs');
const path = require('path');

const { resolveConfiguredPath } = require('./util');

const { config } = require('./validate-env');

const envVars = {
  GIT_CACHE_PATH: resolveConfiguredPath(config.gitCachePath),
  ELECTRON_GN_ROOT: resolveConfiguredPath(config.electronRoot),
  ELECTRON_OUT_DIR: config.electronOutDir || 'Debug',
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
envVars.SCCACHE_BUCKET = 'electronjs-sccache';

envVars.EXTRA_GN_ARGS = `"${config.extraGnArgs || ''}"`
envVars.GN_IMPORT_NAME = config.buildType || 'debug'

const shouldExport = (key) => key === 'CHROMIUM_BUILDTOOLS_PATH';

if (process.platform === 'win32') {
  fs.writeFileSync(
    path.resolve(__dirname, '../generated.env.bat'),
`@echo off

rem |-------------------- !!!! WARNING !!!! ---------------------|
rem | This file is auto-generated, please do not modify manually |
rem |------------------------------------------------------------|

${Object.keys(envVars).map(key => `set ${key}=${envVars[key]}`).join('\n')}
`,
  );
} else {
  const envFile = path.resolve(__dirname, '../generated.env.sh');
  fs.writeFileSync(
    envFile,
`#!/usr/bin/env bash

# |-------------------- !!!! WARNING !!!! ---------------------|
# | This file is auto-generated, please do not modify manually |
# |------------------------------------------------------------|

${Object.keys(envVars).map(key => `${shouldExport(key) ? 'export ' : ''}${key}=${envVars[key]}`).join('\n')}
`
  );
  fs.chmodSync(
    envFile,
    fs.constants.S_IRUSR | fs.constants.S_IRGRP | fs.constants.S_IROTH |
    fs.constants.S_IWUSR |
    fs.constants.S_IXUSR | fs.constants.S_IXGRP | fs.constants.S_IXOTH
  );
}
