const which = require('which').sync;

const { maybeAutoFix } = require('./maybe-auto-fix');

const whichAndFix = (cmd, fix) => {
  const found = !!which(cmd, { nothrow: true });
  if (!found) {
    maybeAutoFix(
      fix,
      new Error(
        `A required dependency "${cmd}" could not be located, it probably has to be installed.`,
      ),
    );
  }
};

module.exports = {
  whichAndFix,
};
