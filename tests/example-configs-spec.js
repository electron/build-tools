const fs = require('fs');
const path = require('path');

const yml = require('js-yaml');

const { validateConfig } = require('../src/evm-config');

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
