const fs = require('fs');
const path = require('path');

const { configPath, resolveConfiguredPath } = require('./util');

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

envVars.CHROMIUM_BUILDTOOLS_PATH = path.resolve(envVars.ELECTRON_GN_ROOT, 'src', 'buildtools');

if (process.platform === 'win32') {
  fs.writeFileSync(
    path.resolve(__dirname, '../generated.env.bat'),
`@echo off

rem |-------------------- !!!! WARNING !!!! ---------------------|
rem | This file is auto-generated, please do not modify manually |
rem |------------------------------------------------------------|

${Object.keys(envVars).map(key => `set ${key}=${envVars[key]}`).join('\n')}
`,
  )
} else {
  const envFile = path.resolve(__dirname, '../generated.env.sh');
  fs.writeFileSync(
    envFile,
`#!/usr/bin/env bash

# |-------------------- !!!! WARNING !!!! ---------------------|
# | This file is auto-generated, please do not modify manually |
# |------------------------------------------------------------|

${Object.keys(envVars).map(key => `${key}=${envVars[key]}`).join('\n')}
`
  )
}