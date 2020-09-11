const cp = require('child_process');

const getIsArm = () => {
  const output = cp.execSync(`uname -m`);

  return output.includes('arm');
};

module.exports = {
  getIsArm,
};
