import fs from 'fs';
import os from 'os';
import path from 'path';

import YAML from 'yaml';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../dist/utils/depot-tools.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getChromiumBuildtoolsPath: vi.fn(),
  };
});

const { sanitizeConfig, validateConfig, fetchByName } = await import('../dist/evm-config.js');
const { getChromiumBuildtoolsPath } = await import('../dist/utils/depot-tools.js');

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
  env: {},
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

describe('CHROMIUM_BUILDTOOLS_PATH resolution', () => {
  let tmpRoot;
  let resolvedBuildtoolsDir;
  let altBuildtoolsDir;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evm-config-buildtools-'));
    resolvedBuildtoolsDir = path.join(tmpRoot, 'src', 'buildtools');
    altBuildtoolsDir = path.join(tmpRoot, 'other', 'buildtools');
    fs.mkdirSync(resolvedBuildtoolsDir, { recursive: true });
    fs.mkdirSync(altBuildtoolsDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.mocked(getChromiumBuildtoolsPath).mockReset();
  });

  const baseConfig = () => ({
    ...validConfig,
    root: tmpRoot,
    env: {},
  });

  it('drops CHROMIUM_BUILDTOOLS_PATH when depot_tools resolves to the same path', () => {
    vi.mocked(getChromiumBuildtoolsPath).mockReturnValue(resolvedBuildtoolsDir);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = sanitizeConfig('foobar', {
      ...baseConfig(),
      env: { CHROMIUM_BUILDTOOLS_PATH: resolvedBuildtoolsDir },
    });

    expect(config.env).not.toHaveProperty('CHROMIUM_BUILDTOOLS_PATH');
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('depot_tools resolves buildtools to'),
    );
    warnSpy.mockRestore();
  });

  it('keeps CHROMIUM_BUILDTOOLS_PATH and warns when it disagrees with depot_tools', () => {
    vi.mocked(getChromiumBuildtoolsPath).mockReturnValue(resolvedBuildtoolsDir);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = sanitizeConfig('foobar', {
      ...baseConfig(),
      env: { CHROMIUM_BUILDTOOLS_PATH: altBuildtoolsDir },
    });

    expect(config.env.CHROMIUM_BUILDTOOLS_PATH).toBe(altBuildtoolsDir);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('using'),
    );
    warnSpy.mockRestore();
  });

  it('does not set CHROMIUM_BUILDTOOLS_PATH when depot_tools resolves and config has none', () => {
    vi.mocked(getChromiumBuildtoolsPath).mockReturnValue(resolvedBuildtoolsDir);

    const config = sanitizeConfig('foobar', baseConfig());

    expect(config.env).not.toHaveProperty('CHROMIUM_BUILDTOOLS_PATH');
  });

  it('falls back to CHROMIUM_BUILDTOOLS_PATH when depot_tools cannot resolve', () => {
    vi.mocked(getChromiumBuildtoolsPath).mockReturnValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = sanitizeConfig('foobar', {
      ...baseConfig(),
      env: { CHROMIUM_BUILDTOOLS_PATH: altBuildtoolsDir },
    });

    expect(config.env.CHROMIUM_BUILDTOOLS_PATH).toBe(altBuildtoolsDir);
    warnSpy.mockRestore();
  });

  it('fatals when depot_tools cannot resolve and there is no fallback', () => {
    vi.mocked(getChromiumBuildtoolsPath).mockReturnValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

    sanitizeConfig('foobar', baseConfig());

    expect(exitSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not resolve buildtools path via depot_tools'),
    );
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

