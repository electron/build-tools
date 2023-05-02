const fs = require('fs');
const path = require('path');

const yml = require('js-yaml');

const { sanitizeConfig, validateConfig } = require('../src/evm-config');

const validConfig = {
  $schema: 'file:///Users/user_name/.electron_build_tools/evm-config.schema.json',
  root: '/path/to/your/developer/folder',
  remotes: {
    electron: {
      origin: 'git@github.com:electron/electron.git',
    },
  },
  goma: 'none',
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
  it('should validate', () => {
    const exampleConfigsPath = path.resolve(__dirname, '..', 'example-configs');

    const files = fs.readdirSync(exampleConfigsPath, { encoding: 'utf8' });
    expect(files.length).not.toBe(0);

    for (const file of files) {
      const configContents = fs.readFileSync(path.resolve(exampleConfigsPath, file), 'utf8');
      const validationErrors = validateConfig(yml.safeLoad(configContents));
      expect(validationErrors).toBeFalsy();
    }
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
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const config = sanitizeConfig('foobar', validConfig);
    expect(config.configValidationLevel).toEqual('strict');
    expect(spy).not.toHaveBeenCalled();
    spy.mockClear();
  });

  it('should log warnings for invalid config if set to warn', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
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
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
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
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
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
