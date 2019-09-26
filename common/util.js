const fs = require('fs');
const os = require('os');
const path = require('path');

const configRoot = process.env.ELECTRON_BUILD_TOOLS_CONFIG || path.resolve(__dirname, '..')

function saveConfig (filename, o) {
  const serialized = Object.entries(o)
    .map(([key, val]) => `${key}: ${val}`.trim())
    .sort()
    .join('\n')
    + '\n';
  fs.writeFileSync(filename, serialized);
}

module.exports = {
  configRoot,
  saveConfig,
  getConfigFile: (target) => path.resolve(configRoot, `config.${target}.yml`),
  resolveConfiguredPath: (p) => p.startsWith('~/')
    ? path.resolve(os.homedir(), p.substr(2))
    : path.isAbsolute(p)
      ? p
      : path.resolve(configRoot, p),
};
