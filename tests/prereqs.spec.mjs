import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const modulePath = pathToFileURL(
  path.join(import.meta.dirname, '..', 'dist', 'utils', 'prereqs.js'),
).href;

// `ensureMetalToolchain()` exits the process on failure, so run it in a child
const runEnsureMetalToolchain = (env) =>
  spawnSync(
    process.execPath,
    ['-e', `import('${modulePath}').then((m) => m.ensureMetalToolchain())`],
    {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );

// Whether this machine can actually run the Metal compiler, which decides
// which direction of the check is testable here
const metalToolchainInstalled =
  process.platform === 'darwin' &&
  spawnSync('xcrun', ['metal', '--version'], { stdio: 'ignore' }).status === 0;

describe('prereqs', () => {
  describe('ensureMetalToolchain', () => {
    it.skipIf(!metalToolchainInstalled)('passes when the Metal toolchain is installed', () => {
      const result = runEnsureMetalToolchain({});

      expect(result.status).toEqual(0);
      expect(result.stderr).toEqual('');
    });

    it.skipIf(process.platform !== 'darwin')(
      'fails with install instructions when the Metal toolchain is unavailable',
      () => {
        // No Xcode to find the toolchain in, which is what a missing component looks like
        const result = runEnsureMetalToolchain({ DEVELOPER_DIR: '/nonexistent' });

        expect(result.status).toEqual(1);
        expect(result.stderr).toContain('xcodebuild -downloadComponent MetalToolchain');
      },
    );

    it.skipIf(process.platform === 'darwin')('is a no-op off macOS', () => {
      const result = runEnsureMetalToolchain({});

      expect(result.status).toEqual(0);
    });
  });
});
