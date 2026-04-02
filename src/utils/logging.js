const { styleText } = require('node:util');

const color = {
  cmd: (str) => `"${styleText('cyan', str)}"`,
  config: (str) => `${styleText('blueBright', str)}`,
  git: (str) => `${styleText('greenBright', str)}`,
  path: (str) => `${styleText('magentaBright', str)}`,
  childExec: (cmd, args, opts) => {
    args = args || [];
    const cmdstr = [cmd, ...args].join(' ');
    const parts = ['Running', color.cmd(cmdstr)];
    if (opts && opts.cwd) {
      parts.push('in', color.path(opts.cwd));
    }
    return parts.join(' ');
  },
  success: styleText(['bgGreenBright', 'black'], 'SUCCESS'),
  err: styleText(['bgRedBright', 'white'], 'ERROR'),
  info: styleText(['bgBlueBright', 'white'], 'INFO'),
  warn: styleText(['bgYellowBright', 'black'], 'WARN'),
};

function logError(e) {
  if (typeof e === 'string') {
    console.error(`${color.err} ${e}`);
  } else {
    console.error(`${color.err} ${e.stack ? e.stack : e.message}`);
  }
}

function fatal(e, code = 1) {
  logError(e);
  process.exit(code);
}

module.exports = {
  color,
  fatal,
  logError,
};
