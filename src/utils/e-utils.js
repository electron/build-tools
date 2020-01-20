const chalk = require('chalk');
const fs = require('fs');
const os = require('os');
const path = require('path');

function resolvePath(p) {
  if (path.isAbsolute(p)) return p;
  if (p.startsWith('~/')) return path.resolve(os.homedir(), p.substr(2));
  return path.resolve(process.cwd(), p);
}

function ensureDir(dir) {
  dir = resolvePath(dir);
  if (!fs.existsSync(dir)) {
    console.log(`Creating ${color.path(dir)}`);
    fs.mkdirSync(dir, { recursive: true });
  }
}

const color = {
  cmd: str => `"${chalk.cyan(str)}"`,
  config: str => `${chalk.blueBright(str)}`,
  git: str => `${chalk.greenBright(str)}`,
  path: str => `${chalk.yellow(str)}`,
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
  ensureDir,
  fatal,
  resolvePath,
};
