const os = require('os');
const path = require('path');

const configRoot = process.env.ELECTRON_BUILD_TOOLS_CONFIG || path.resolve(__dirname, '..')

module.exports = {
  configRoot,
  getConfigFile: (target) => path.resolve(configRoot, `config.${target}.yml`),
  resolveConfiguredPath: (p) => p.startsWith('~/')
    ? path.resolve(os.homedir(), p.substr(2))
    : path.isAbsolute(p)
      ? p
      : path.resolve(configRoot, p),
};
