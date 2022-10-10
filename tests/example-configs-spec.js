const fs = require('fs/promises');
const path = require('path');

const Ajv = require('ajv');
const yml = require('js-yaml');

const schema = require('../evm-config.schema.json');

describe('example configs', () => {
  it('should validate', async () => {
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const exampleConfigsPath = '../example-configs/';

    const files = await fs.readdir(exampleConfigsPath);
    expect(files.length).not.toBe(0);

    for (const file of files) {
      const configContents = fs.readFileSync(path.resolve(exampleConfigsPath, file), 'utf8');
      expect(validate(yml.safeLoad(configContents))).toStrictEqual(true);
    }
  });
});
