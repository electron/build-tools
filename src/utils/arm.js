const cp = require('child_process');
const path = require('path');

const getIsArm = () => {
  const output = cp.execSync('uname -m');

  return output.includes('arm');
};

module.exports = {
  getIsArm,
};
