import fs from 'node:fs';
import path from 'node:path';

import { EVMBaseElectronConfiguration } from '../evm-config.schema.js';
import { getServiceAddress, getHelperPath } from './reclient.js';

const SISO_REAPI_INSTANCE = 'projects/electron-rbe/instances/default_instance';
const SISO_PROJECT = SISO_REAPI_INSTANCE.split('/')[1];

export const sisoEnv = (config: EVMBaseElectronConfiguration | null): Record<string, string> => {
  if (config?.remoteBuild !== 'siso') return {};

  return {
    SISO_PROJECT,
    SISO_REAPI_INSTANCE,
    SISO_REAPI_ADDRESS: getServiceAddress(config),
    SISO_CREDENTIAL_HELPER: getHelperPath(config),
  };
};

export function sisoFlags(config: EVMBaseElectronConfiguration): string[] {
  if (config.remoteBuild !== 'siso') return [];

  return [
    '-remote_jobs',
    '200',
    '-project',
    SISO_PROJECT,
    '-reapi_instance',
    SISO_REAPI_INSTANCE,
    '-reapi_address',
    getServiceAddress(config),
    '-load',
    path.resolve(config.root, 'src/electron/build/siso/main.star'),
  ];
}

export async function ensureBackendStarlark(config: EVMBaseElectronConfiguration): Promise<void> {
  if (config.remoteBuild !== 'siso') return;

  const backendConfig = path.resolve(config.root, 'src/electron/build/siso/backend.star');

  if (!fs.existsSync(backendConfig)) {
    throw new Error(
      `Missing SISO backend config at ${backendConfig}. Either disable siso in build-tools or ensure you are on a branch that supports it.`,
    );
  }

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
