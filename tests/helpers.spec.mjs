import { describe, expect, it } from 'vitest';

import { resolvePath } from '../src/utils/paths.js';
import { getPayload } from '../src/utils/crbug.js';
import { parseTokenScopes } from '../src/utils/github-auth.js';
import { fallbackSDK } from '../src/utils/sdk.js';
import { filenameToConfigName, mergeConfigs } from '../src/evm-config.js';

import os from 'node:os';
import path from 'node:path';

describe('paths.resolvePath', () => {
  it('returns absolute paths unchanged', () => {
    const abs = path.resolve('/foo/bar');
    expect(resolvePath(abs)).toBe(abs);
  });

  it('expands ~/ to the home directory', () => {
    expect(resolvePath('~/foo')).toBe(path.resolve(os.homedir(), 'foo'));
  });

  it('resolves relative paths against cwd', () => {
    expect(resolvePath('foo/bar')).toBe(path.resolve(process.cwd(), 'foo/bar'));
  });
});

describe('crbug.getPayload', () => {
  it('extracts text between delimiters', () => {
    expect(getPayload('prefix START middle END suffix', 'START ', ' END')).toBe('middle');
  });

  it('handles empty payload', () => {
    expect(getPayload('ABXY', 'AB', 'XY')).toBe('');
  });
});

describe('github-auth.parseTokenScopes', () => {
  it('parses a scope list', () => {
    const status = `  ✓ Logged in to github.com as foo\n  - Token scopes: 'repo', 'workflow', 'gist'\n`;
    expect(parseTokenScopes(status)).toEqual(['repo', 'workflow', 'gist']);
  });

  it('parses scopes without quotes', () => {
    const status = `Token scopes: repo, workflow`;
    expect(parseTokenScopes(status)).toEqual(['repo', 'workflow']);
  });

  it('returns null when the scope line is absent', () => {
    expect(parseTokenScopes('no scopes here')).toBeNull();
  });
});

describe('sdk.fallbackSDK', () => {
  it('picks the highest semver key', () => {
    const sdks = {
      '14.0': { fileName: 'x', sha256: 'x' },
      '15.2': { fileName: 'y', sha256: 'y' },
      '13.5': { fileName: 'z', sha256: 'z' },
    };
    expect(fallbackSDK(sdks)).toBe('15.2');
  });
});

describe('evm-config.filenameToConfigName', () => {
  it('extracts the name from a json config filename', () => {
    expect(filenameToConfigName('evm.testing.json')).toBe('testing');
  });

  it('extracts the name from a yaml config filename', () => {
    expect(filenameToConfigName('evm.release.yml')).toBe('release');
    expect(filenameToConfigName('evm.debug.yaml')).toBe('debug');
  });

  it('preserves dots in the config name', () => {
    expect(filenameToConfigName('evm.foo.bar.json')).toBe('foo.bar');
  });

  it('returns null for non-config files', () => {
    expect(filenameToConfigName('random.txt')).toBeNull();
    expect(filenameToConfigName('evm-current.txt')).toBeNull();
  });
});

describe('evm-config.mergeConfigs', () => {
  it('overwrites scalars', () => {
    expect(mergeConfigs({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it('concatenates arrays', () => {
    expect(mergeConfigs({ a: [1, 2] }, { a: [3] })).toEqual({ a: [1, 2, 3] });
  });

  it('recurses into objects', () => {
    expect(mergeConfigs({ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } })).toEqual({
      a: { x: 1, y: 3, z: 4 },
    });
  });

  it('adds keys only in source', () => {
    expect(mergeConfigs({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('leaves keys only in target untouched', () => {
    expect(mergeConfigs({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });
});
