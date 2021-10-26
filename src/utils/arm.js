const cp = require('child_process');

const getIsArm = () => {
  const isCurrentlyTranslated = cp.execSync('sysctl sysctl.proc_translated');

  return (
    process.arch === 'arm64' ||
    isCurrentlyTranslated.toString().startsWith('sysctl.proc_translated: 1')
  );
};

module.exports = {
  getIsArm,
};
