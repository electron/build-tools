const cp = require('child_process');
const path = require('path');

const refreshPathVariable = () => {
  if (process.platform === 'win32') {
    const output = cp.execSync(path.resolve(__dirname, 'get-path.bat'));
    const pathOut = output.toString();
    process.env.PATH = pathOut;
  }
};

module.exports = {
  refreshPathVariable,
};
