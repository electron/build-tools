import fs from 'fs';
import path from 'path';

import YAML from 'yaml';

const { sanitizeConfig, validateConfig, fetchByName } = require('../dist/evm-config.js');

import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const validConfig = {
  $schema: 'file:///Users/user_name/.electron_build_tools/evm-config.schema.json',
  root: '/path/to/your/developer/folder',
  remotes: {
    electron: {
      origin: 'git@github.com:electron/electron.git',
    },
  },
  preserveSDK: 5,
  remoteBuild: 'none',
  gen: {
    args: [],
    out: 'Testing',
  },
  env: {
    CHROMIUM_BUILDTOOLS_PATH: '/path/to/your/developer/folder/src/build-tools',
  },
};

const invalidConfig = {
  ...validConfig,
  remotes: {
    // Missing the required electron remote
  },
};

describe('example configs', () => {
  beforeAll(() => {
    process.env.EVM_CONFIG = path.resolve(__dirname, '..', 'example-configs');
  });

  afterAll(() => {
    process.env.EVM_CONFIG = path.resolve(__dirname, '..', 'configs');
  });

  it('should validate', () => {
    const files = fs.readdirSync(process.env.EVM_CONFIG, { encoding: 'utf8' });
    expect(files.length).not.toBe(0);

    for (const file of files) {
      const configContents = fs.readFileSync(path.resolve(process.env.EVM_CONFIG, file), 'utf8');
      const validationErrors = validateConfig(YAML.parse(configContents));
      expect(validationErrors).toBeFalsy();
    }
  });

  it('should be able to extend a config', () => {
    const config = fetchByName('testing');

    expect(config).toMatchObject({
      $schema: expect.any(String),
      root: expect.any(String),
      remotes: {
        electron: {
          origin: expect.any(String),
        },
      },
      configValidationLevel: 'strict',
      remoteBuild: 'siso',
      preserveSDK: expect.any(Number),
      gen: {
        out: 'Testing',
        args: expect.any(Array),
      },
      env: expect.any(Object),
    });
  });
});

describe('invalid configs', () => {
  it('should not validate', () => {
    const validationErrors = validateConfig(invalidConfig);
    expect(validationErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.arrayContaining(['remotes']),
        }),
      ]),
    );
  });
});

describe('configValidationLevel', () => {
  it('should default to strict', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = sanitizeConfig('foobar', validConfig);
    expect(config.configValidationLevel).toEqual('strict');
    expect(spy).not.toHaveBeenCalled();
    spy.mockClear();
  });

  it('should add ASAN poison history settings for asan configs', () => {
    const config = sanitizeConfig('foobar', {
      ...validConfig,
      gen: {
        ...validConfig.gen,
        args: ['is_asan=true'],
      },
    });

    expect(config.env.ASAN_OPTIONS).toMatch(/poison_history_size=\d+/);
  });

  it('should preserve an existing ASAN poison history setting', () => {
    const config = sanitizeConfig('foobar', {
      ...validConfig,
      gen: {
        ...validConfig.gen,
        args: ['is_asan=true'],
      },
      env: {
        ...validConfig.env,
        ASAN_OPTIONS: 'detect_leaks=0:poison_history_size=42',
      },
    });

    expect(config.env.ASAN_OPTIONS).toMatch(/detect_leaks=0/);
    expect(config.env.ASAN_OPTIONS).toMatch(/poison_history_size=42/);
  });

  it('should log warnings for invalid config if set to warn', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const config = sanitizeConfig('foobar', {
      ...invalidConfig,
      configValidationLevel: 'warn',
    });
    expect(config.configValidationLevel).toEqual('warn');
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockClear();
    processExitSpy.mockClear();
  });

  it('should log errors and exit for invalid config if set to strict', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const config = sanitizeConfig('foobar', {
      ...invalidConfig,
      configValidationLevel: 'strict',
    });
    expect(config.configValidationLevel).toEqual('strict');
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalled();
    consoleErrorSpy.mockClear();
    processExitSpy.mockClear();
  });

  it('should be silent on invalid config if set to none', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const config = sanitizeConfig('foobar', {
      ...invalidConfig,
      configValidationLevel: 'none',
    });
    expect(config.configValidationLevel).toEqual('none');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
    consoleWarnSpy.mockClear();
    consoleErrorSpy.mockClear();
    processExitSpy.mockClear();
  });
});
