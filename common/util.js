const path = require('path');

module.exports = {
  configPath: global.CONFIG_PATH_OVERRIDE || path.resolve(__dirname, '../config.yml'),
  resolveConfiguredPath: (p) => path.isAbsolute(p) ? p : path.resolve(__dirname, '..', p),
};
