const which = require('which').sync;

const { maybeAutoFix } = require('./maybe-auto-fix');
const { refreshPathVariable } = require('./refresh-path');
const { fatal } = require('./logging');

const whichAndFix = (cmd, check, fix) => {
  const found = check ? check() : !!which(cmd, { nothrow: true });
  if (!found) {
    maybeAutoFix(
      fix,
      new Error(
        `A required dependency "${cmd}" could not be located, it probably has to be installed.`,
      ),
    );

    refreshPathVariable();

    if (!(check ? check() : which(cmd, { nothrow: true }))) {
      fatal(
        `A required dependency "${cmd}" could not be located and we could not install it - it likely has to be installed manually.`,
      );
    }
  }
};

module.exports = {
  whichAndFix,
};
