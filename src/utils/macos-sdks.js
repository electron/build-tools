const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { color } = require('./logging');

const macOSSDKsPath = path.resolve(__dirname, '..', 'third_party', 'macOS_SDKs');

function ensureMacOSSDKs() {
  if (!fs.existsSync(macOSSDKsPath)) {
    console.log(`Cloning ${color.cmd('MacOSX-SDKs')} into ${color.path(macOSSDKsPath)}`);
    const url = 'https://github.com/phracker/MacOSX-SDKs.git';
    childProcess.execFileSync('git', ['clone', '-q', url, macOSSDKsPath], { stdio: 'inherit' });
  } else {
    childProcess.execFileSync('git', ['pull', '-q'], { cwd: macOSSDKsPath, stdio: 'inherit' });
  }
}

module.exports = {
  path: macOSSDKsPath,
  ensure: ensureMacOSSDKs,
};
