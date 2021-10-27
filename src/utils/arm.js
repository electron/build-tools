const cp = require('child_process');

const getIsArm = () => {
  if (process.arch === 'arm64') {
    return true;
  }

  try {
    const isCurrentlyTranslated = cp.execSync('sysctl sysctl.proc_translated', { stdio: 'pipe' });
    return isCurrentlyTranslated.toString().startsWith('sysctl.proc_translated: 1');
  } catch (e) {
    return false;
  }
};

module.exports = {
  getIsArm,
};
