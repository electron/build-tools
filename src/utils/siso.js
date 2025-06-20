const fs = require('fs');
const path = require('path');

const reclient = require('./reclient');

const SISO_REAPI_INSTANCE = 'projects/electron-rbe/instances/default_instance';
const SISO_PROJECT = SISO_REAPI_INSTANCE.split('/')[1];

const sisoEnv = (config) => {
  if (config.remoteBuild !== 'siso') return {};

  return {
    SISO_PROJECT,
    SISO_REAPI_INSTANCE,
    SISO_REAPI_ADDRESS: reclient.serviceAddress(config),
    SISO_CREDENTIAL_HELPER: reclient.helperPath(config),
  };
};

function sisoFlags(config) {
  if (config.remoteBuild !== 'siso') return [];

  return [
    '-remote_jobs',
    200,
    '-project',
    SISO_PROJECT,
    '-reapi_instance',
    SISO_REAPI_INSTANCE,
    '-reapi_address',
    reclient.serviceAddress(config),
    '-load',
    path.resolve(__dirname, '../siso/config/electron.star'),
  ];
}

async function ensureBackendStarlark(config) {
  if (config.remoteBuild !== 'siso') return;

  const backendConfig = path.resolve(__dirname, '../siso/config/backend.star');

  const starlarkPath = path.resolve(
    config.root,
    'src',
    'build/config/siso/backend_config/backend.star',
  );
  let needsUpdate = true;
  if (fs.existsSync(starlarkPath)) {
    needsUpdate =
      (await fs.promises.readFile(starlarkPath, 'utf8')) !==
      (await fs.promises.readFile(backendConfig, 'utf8'));
  }

  if (needsUpdate) {
    await fs.promises.mkdir(path.dirname(starlarkPath), { recursive: true });
    await fs.promises.copyFile(backendConfig, starlarkPath);
  }
}

module.exports = {
  env: sisoEnv,
  flags: sisoFlags,
  ensureBackendStarlark,
};
