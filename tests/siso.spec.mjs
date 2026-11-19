import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auth, env as reclientEnv } from '../dist/utils/reclient.js';
import { backendStarlark, ensureBackendStarlark, env, flags } from '../dist/utils/siso.js';

const flagValue = (result, name) =>
  result.find((arg) => String(arg).startsWith(`${name}=`))?.slice(name.length + 1);

describe('siso alternative RBE backends', () => {
  const tlsConfig = {
    remoteBuild: 'siso',
    rbeServiceAddress: 'rbe.example.com:443',
    rbeInstance: '',
    rbeTlsClientCert: '/certs/client.crt',
    rbeTlsClientKey: '/certs/client.key',
  };

  it('passes an empty instance name through and leaves the project empty', () => {
    const result = flags(tlsConfig, true);
    expect(flagValue(result, '-reapi_instance')).toBe('');
    expect(flagValue(result, '-project')).toBe('');
    expect(result[result.indexOf('-reapi_address') + 1]).toBe('rbe.example.com:443');
  });

  it('derives the project from a custom instance name', () => {
    const result = flags({ ...tlsConfig, rbeInstance: 'projects/foo/instances/bar' }, true);
    expect(flagValue(result, '-project')).toBe('foo');
  });

  it('passes the TLS client certificate to siso', () => {
    const result = flags(tlsConfig, true);
    expect(flagValue(result, '-reapi_tls_client_auth_cert')).toBe('/certs/client.crt');
    expect(flagValue(result, '-reapi_tls_client_auth_key')).toBe('/certs/client.key');
  });

  it('does not use the credential helper with a TLS client certificate', () => {
    expect(reclientEnv(tlsConfig)).toEqual({});
    expect(env(tlsConfig)).not.toHaveProperty('SISO_CREDENTIAL_HELPER');
  });

  it('expands ~ in the TLS client certificate paths', () => {
    const result = flags({ ...tlsConfig, rbeTlsClientCert: '~/client.crt' }, true);
    expect(flagValue(result, '-reapi_tls_client_auth_cert')).toBe(
      path.join(os.homedir(), 'client.crt'),
    );
  });

  it('accepts existing TLS client certificate files without the credential helper', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siso-tls-'));
    const rbeTlsClientCert = path.join(dir, 'client.crt');
    const rbeTlsClientKey = path.join(dir, 'client.key');
    fs.writeFileSync(rbeTlsClientCert, '');
    fs.writeFileSync(rbeTlsClientKey, '');
    expect(auth({ ...tlsConfig, rbeTlsClientCert, rbeTlsClientKey })).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the default instance when none is configured', () => {
    const result = flags({ remoteBuild: 'siso' }, true);
    expect(flagValue(result, '-reapi_instance')).toBe(
      'projects/electron-rbe/instances/default_instance',
    );
    expect(flagValue(result, '-reapi_tls_client_auth_cert')).toBeUndefined();
  });
});

describe('siso remote jobs', () => {
  const remoteJobs = (result) => result[result.indexOf('-remote_jobs') + 1];

  it('defaults to 200', () => {
    expect(remoteJobs(flags({ remoteBuild: 'siso' }, true))).toBe(200);
  });

  it('uses rbeRemoteJobs when configured', () => {
    expect(remoteJobs(flags({ remoteBuild: 'siso', rbeRemoteJobs: 500 }, true))).toBe(500);
  });

  it.each([
    [['-remote_jobs', '50']],
    [['-remote_jobs=50']],
    [['--remote_jobs', '50']],
    [['--remote_jobs=50']],
  ])('leaves the flag out when the user passes %j', (userArgs) => {
    const result = flags({ remoteBuild: 'siso', rbeRemoteJobs: 500 }, true, userArgs);
    expect(result).not.toContain('-remote_jobs');
  });

  it('is not fooled by other flags', () => {
    const result = flags({ remoteBuild: 'siso' }, true, ['-local_jobs', '8', '-remote_jobs_foo=1']);
    expect(remoteJobs(result)).toBe(200);
  });
});

describe('ensureBackendStarlark', () => {
  let root;
  const backendStar = () => path.join(root, 'src/build/config/siso/backend_config/backend.star');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'siso-backend-'));
    fs.mkdirSync(path.dirname(backendStar()), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('generates the backend config from rbePlatformProperties', async () => {
    const rbePlatformProperties = { os: 'linux', arch: 'amd64' };
    await ensureBackendStarlark({ remoteBuild: 'siso', root, rbePlatformProperties });
    const contents = fs.readFileSync(backendStar(), 'utf8');
    expect(contents).toBe(backendStarlark(rbePlatformProperties));
    expect(contents).toContain('"default": {"os":"linux","arch":"amd64"}');
  });

  it('uses the default backend config otherwise', async () => {
    await ensureBackendStarlark({ remoteBuild: 'siso', root });
    expect(fs.readFileSync(backendStar(), 'utf8')).toContain('container-image');
  });
});
