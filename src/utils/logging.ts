import { styleText } from 'node:util';

type Style = Parameters<typeof styleText>[0];

const style = (fmt: Style, str: string): string => styleText(fmt, str);

export const color = {
  cmd: (str: string): string => `"${style('cyan', str)}"`,
  config: (str: string): string => style('blueBright', str),
  git: (str: string): string => style('greenBright', str),
  path: (str: string): string => style('magentaBright', str),
  childExec: (cmd: string, args?: readonly string[] | null, opts?: unknown): string => {
    const cmdstr = [cmd, ...(args ?? [])].join(' ');
    const parts = ['Running', color.cmd(cmdstr)];
    const cwd = (opts as { cwd?: unknown } | undefined)?.cwd;
    if (cwd) {
      parts.push('in', color.path(String(cwd)));
    }
    return parts.join(' ');
  },
  success: style(['bgGreenBright', 'black'], 'SUCCESS'),
  err: style(['bgRedBright', 'white'], 'ERROR'),
  info: style(['bgBlueBright', 'white'], 'INFO'),
  warn: style(['bgYellowBright', 'black'], 'WARN'),
};

export function logError(e: unknown): void {
  if (typeof e === 'string') {
    console.error(`${color.err} ${e}`);
  } else if (e instanceof Error) {
    console.error(`${color.err} ${e.stack ?? e.message}`);
  } else {
    console.error(`${color.err} ${String(e)}`);
  }
}

export function fatal(e: unknown, code = 1): never {
  logError(e);
  process.exit(code);
}
