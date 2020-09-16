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
  done: chalk.bgGreenBright.black('DONE! 🎉'),
  err: chalk.bgRedBright.white('ERROR'),
  info: chalk.bgYellowBright.black('INFO'),
  warn: chalk.bgYellowBright.black('WARN'),
};

function fatal(e) {
  console.error(`${color.err} ${e.stack ? e.stack : e.message}`);
  process.exit(1);
}

module.exports = {
  color,
  fatal,
};
