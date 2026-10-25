import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolvePath } from './paths.js';
import * as reclient from './reclient.js';
import type { SanitizedConfig } from '../types.js';

// The REv2 instance name namespaces the remote Action Cache. Release builds
// override this to the release-only namespace (which their RBE token is
// scoped to); everything else uses the shared CI/local namespace.
const DEFAULT_REAPI_INSTANCE = 'projects/electron-rbe/instances/default_instance';

const DEFAULT_REMOTE_JOBS = 200;

type ConfigLike = Pick<
  SanitizedConfig,
  | 'remoteBuild'
  | 'rbeHelperPath'
  | 'rbeServiceAddress'
  | 'rbeInstance'
  | 'rbeTlsClientCert'
  | 'rbeTlsClientKey'
  | 'rbePlatformProperties'
  | 'rbeRemoteJobs'
  | 'root'
>;

function reapiInstance(config: ConfigLike): string {
  return process.env['ELECTRON_RBE_INSTANCE'] || (config.rbeInstance ?? DEFAULT_REAPI_INSTANCE);
}

function project(config: ConfigLike): string {
  return reapiInstance(config).split('/')[1] ?? '';
}

export function env(config: ConfigLike): Record<string, string> {
  if (config.remoteBuild !== 'siso') return {};

  const base: Record<string, string> = {
    SISO_PROJECT: project(config),
    SISO_REAPI_INSTANCE: reapiInstance(config),
    SISO_REAPI_ADDRESS: reclient.serviceAddress(config),
  };

  if (reclient.usesTlsClientAuth(config)) return base;

  base['SISO_CREDENTIAL_HELPER'] = reclient.helperPath(config);
  return Object.assign(base, reclient.helperFlags(config));
}

function getStarFile(envVar: string, filename: string): string {
  const envVal = process.env[envVar];
  if (envVal && fs.existsSync(envVal)) {
    return envVal;
  }
  return path.resolve(import.meta.dirname, '../../tools', filename);
}

export function flags(
  config: ConfigLike,
  hasExecute: boolean,
  userArgs: string[] = [],
): (string | number)[] {
  if (config.remoteBuild !== 'siso') return [];

  const result: (string | number)[] = [];

  // These flags go after the user's and siso keeps the last value it sees, so
  // leave -remote_jobs out when the user passed their own.
  if (!userArgs.some((arg) => /^--?remote_jobs(=|$)/.test(arg.trim()))) {
    result.push('-remote_jobs', config.rbeRemoteJobs ?? DEFAULT_REMOTE_JOBS);
  }

  result.push(
    // Keep each value in its flag's token: the Windows shell join drops empty arguments.
    `-project=${project(config)}`,
    `-reapi_instance=${reapiInstance(config)}`,
    '-reapi_address',
    reclient.serviceAddress(config),
    '-load',
    getStarFile('ELECTRON_BUILD_TOOLS_MAIN_STAR', 'main.star'),
  );

  if (reclient.usesTlsClientAuth(config)) {
    result.push(
      `-reapi_tls_client_auth_cert=${resolvePath(config.rbeTlsClientCert!)}`,
      `-reapi_tls_client_auth_key=${resolvePath(config.rbeTlsClientKey!)}`,
    );
  }

  if (!hasExecute) {
    result.push('-re_exec_enable=false');
  }

  return result;
}

export function backendStarlark(properties: Record<string, string>): string {
  const props = JSON.stringify(properties);
  return `# -*- bazel-starlark -*-

load("@builtin//struct.star", "module")

def __platform_properties(ctx):
    return {
        "default": ${props},
        "large": ${props},
    }

backend = module(
    "backend",
    platform_properties = __platform_properties,
)
`;
}

export async function ensureBackendStarlark(config: ConfigLike): Promise<void> {
  if (config.remoteBuild !== 'siso') return;

  const starlarkDir = path.resolve(config.root, 'src/build/config/siso/backend_config');
  if (!fs.existsSync(starlarkDir)) {
    throw new Error(
      `Missing SISO backend config at ${starlarkDir}. Either disable siso in build-tools or ensure you are on a branch that supports it.`,
    );
  }

  const contents = config.rbePlatformProperties
    ? backendStarlark(config.rbePlatformProperties)
    : await fs.promises.readFile(
        getStarFile('ELECTRON_BUILD_TOOLS_BACKEND_STAR', 'backend.star'),
        'utf8',
      );
  const starlarkPath = path.resolve(starlarkDir, 'backend.star');
  let needsUpdate = true;
  if (fs.existsSync(starlarkPath)) {
    needsUpdate = (await fs.promises.readFile(starlarkPath, 'utf8')) !== contents;
  }

  if (needsUpdate) {
    await fs.promises.mkdir(path.dirname(starlarkPath), { recursive: true });
    await fs.promises.writeFile(starlarkPath, contents);
  }
}
