import chalk from 'chalk';
import { ExecFileSyncOptions } from 'node:child_process';

export const color = {
  cmd: (str: string) => `"${chalk.cyan(str)}"`,
  config: (str: string) => `${chalk.blueBright(str)}`,
  git: (str: string) => `${chalk.greenBright(str)}`,
  path: (str: string) => `${chalk.magentaBright(str)}`,
  childExec: (cmd: string, args: string[], opts: ExecFileSyncOptions) => {
    args = args || [];
    const cmdstr = [cmd, ...args].join(' ');
    const parts = ['Running', color.cmd(cmdstr)];
    if (opts && opts.cwd) {
      parts.push('in', color.path(String(opts.cwd)));
    }
    return parts.join(' ');
  },
  success: chalk.bgGreenBright.black('SUCCESS'),
  err: chalk.bgRedBright.white('ERROR'),
  info: chalk.bgBlueBright.white('INFO'),
  warn: chalk.bgYellowBright.black('WARN'),
};

export function logError(e: string | Error) {
  if (typeof e === 'string') {
    console.error(`${color.err} ${e}`);
  } else {
    console.error(`${color.err} ${e.stack ? e.stack : e.message}`);
  }
}

export function fatal(e: string | Error, code = 1): never {
  logError(e);
  process.exit(code);
}
