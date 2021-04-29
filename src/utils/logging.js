const chalk = require('chalk');

const color = {
  cmd: str => `"${chalk.cyan(str)}"`,
  config: str => `${chalk.blueBright(str)}`,
  git: str => `${chalk.greenBright(str)}`,
  path: str => `${chalk.magentaBright(str)}`,
  childExec: (cmd, args, opts) => {
    args = args || [];
    const cmdstr = [cmd, ...args].join(' ');
    const parts = ['Running', color.cmd(cmdstr)];
    if (opts && opts.cwd) {
      parts.push('in', color.path(opts.cwd));
    }
    return parts.join(' ');
  },
  success: chalk.bgGreenBright.black('SUCCESS'),
  err: chalk.bgRedBright.white('ERROR'),
  info: chalk.bgBlueBright.white('INFO'),
  warn: chalk.bgYellowBright.black('WARN'),
};

function fatal(e) {
  if (typeof e === 'string') {
    console.error(`${color.err} ${e}`);
  } else {
    console.error(`${color.err} ${e.stack ? e.stack : e.message}`);
  }
  process.exit(1);
}

module.exports = {
  color,
  fatal,
};
