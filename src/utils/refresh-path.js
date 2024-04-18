const cp = require('child_process');
const path = require('path');

const refreshPathVariable = () => {
  if (process.platform === 'win32') {
    const file = path.resolve(__dirname, 'get-path.bat');
    const output = cp.execFileSync(file, { shell: true });
    const pathOut = output.toString();
    process.env.PATH = pathOut;
  }
};

module.exports = {
  refreshPathVariable,
};
