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
  }
}

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
    reclient.serviceAddress(config)
  ]
}

module.exports = {
  env: sisoEnv,
  flags: sisoFlags,
}
