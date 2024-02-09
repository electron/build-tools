const fs = require('fs');
const path = require('path');
const goma = require('../src/utils/goma');
const { deleteDir } = require('../src/utils/paths');

afterAll(() => {
  deleteDir(goma.dir);
});

describe('e update-goma', () => {
  it('Can successfully download goma client', () => {
    const config = {};
    const sha = goma.downloadAndPrepare(config);
    expect(sha).toEqual(expect.anything());
    const goma_auth_file = path.resolve(goma.dir, 'goma_auth.py');
    expect(fs.existsSync(goma_auth_file)).toStrictEqual(true);
  });

  it('Can successfully download MSFT goma client', () => {
    const config = { gomaSource: 'msft' };
    const sha = goma.downloadAndPrepare(config);
    expect(sha).toEqual(expect.anything());
    const goma_auth_file = path.resolve(goma.dir, 'goma_auth.py');
    expect(fs.existsSync(goma_auth_file)).toStrictEqual(true);
  });
});
