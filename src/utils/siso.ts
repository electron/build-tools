import * as fs from 'node:fs';
import * as path from 'node:path';

import * as reclient from './reclient.js';
import type { SanitizedConfig } from '../types.js';

const SISO_REAPI_INSTANCE = 'projects/electron-rbe/instances/default_instance';
const SISO_PROJECT = SISO_REAPI_INSTANCE.split('/')[1] ?? '';

type ConfigLike = Pick<
  SanitizedConfig,
  'remoteBuild' | 'rbeHelperPath' | 'rbeServiceAddress' | 'root'
>;

export function env(config: ConfigLike): Record<string, string> {
  if (config.remoteBuild !== 'siso') return {};

  const base: Record<string, string> = {
    SISO_PROJECT,
    SISO_REAPI_INSTANCE,
    SISO_REAPI_ADDRESS: reclient.serviceAddress(config),
    SISO_CREDENTIAL_HELPER: reclient.helperPath(config),
  };

  return Object.assign(base, reclient.helperFlags());
}

function getStarFile(envVar: string, filename: string): string {
  const envVal = process.env[envVar];
  if (envVal && fs.existsSync(envVal)) {
    return envVal;
  }
  return path.resolve(import.meta.dirname, '../../tools', filename);
}

export function flags(config: ConfigLike, hasExecute: boolean): (string | number)[] {
  if (config.remoteBuild !== 'siso') return [];

  const result: (string | number)[] = [
    '-remote_jobs',
    200,
    '-project',
    SISO_PROJECT,
    '-reapi_instance',
    SISO_REAPI_INSTANCE,
    '-reapi_address',
    reclient.serviceAddress(config),
    '-load',
    getStarFile('ELECTRON_BUILD_TOOLS_MAIN_STAR', 'main.star'),
  ];

  if (!hasExecute) {
    result.push('-re_exec_enable=false');
  }

  return result;
}

export async function ensureBackendStarlark(config: ConfigLike): Promise<void> {
  if (config.remoteBuild !== 'siso') return;

  const starlarkDir = path.resolve(config.root, 'src/build/config/siso/backend_config');
  if (!fs.existsSync(starlarkDir)) {
    throw new Error(
      `Missing SISO backend config at ${starlarkDir}. Either disable siso in build-tools or ensure you are on a branch that supports it.`,
    );
  }

  const backendConfig = getStarFile('ELECTRON_BUILD_TOOLS_BACKEND_STAR', 'backend.star');
  const starlarkPath = path.resolve(starlarkDir, 'backend.star');
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
