const cp = require('node:child_process');
const d = require('debug')('build-tools:open-external');

function openExternal(url) {
  d('opening %s', url);

  let command;
  switch (process.platform) {
    case 'win32':
      command = `start "electron build-tools" "${url}"`;
      break;
    case 'darwin':
      command = `open "${url}"`;
      break;
    case 'linux':
      command = `xdg-open "${url}"`;
      break;
    default:
      throw new Error(`openExternal: Unsupported platform: ${process.platform}`);
  }

  cp.execSync(command);
}

module.exports = {
  openExternal,
};
