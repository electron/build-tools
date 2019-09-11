const os = require('os');
const path = require('path');

module.exports = {
  configPath: global.CONFIG_PATH_OVERRIDE || path.resolve(__dirname, '../config.yml'),
  resolveConfiguredPath: (p) => p.startsWith('~/')
    ? path.resolve(os.homedir(), p.substr(2))
    : path.isAbsolute(p)
      ? p
      : path.resolve(__dirname, '..', p),
};
