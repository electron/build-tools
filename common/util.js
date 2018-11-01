const path = require('path');

module.exports = {
  configPath: path.resolve(__dirname, '../config.yml'),
  resolveConfiguredPath: (p) => path.isAbsolute(p) ? p : path.resolve(__dirname, '..', p),
};
