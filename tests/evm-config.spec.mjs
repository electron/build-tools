import fs from 'fs';
import path from 'path';

import YAML from 'yaml';

const { sanitizeConfig, validateConfig, fetchByName } = require('../src/evm-config');

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
  reclient: 'none',
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
      reclient: 'remote_exec',
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
          instancePath: '/remotes',
          params: {
            missingProperty: 'electron',
          },
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
