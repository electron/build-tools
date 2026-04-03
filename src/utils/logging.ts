import { styleText } from 'node:util';

export const color = {
  cmd: (str: string): string => `"${styleText('cyan', str)}"`,
  config: (str: string): string => styleText('blueBright', str),
  git: (str: string): string => styleText('greenBright', str),
  path: (str: string): string => styleText('magentaBright', str),
  childExec: (cmd: string, args?: readonly string[] | null, opts?: unknown): string => {
    const cmdstr = [cmd, ...(args ?? [])].join(' ');
    const parts = ['Running', color.cmd(cmdstr)];
    const cwd = (opts as { cwd?: unknown } | undefined)?.cwd;
    if (cwd) {
      parts.push('in', color.path(String(cwd)));
    }
    return parts.join(' ');
  },
  success: styleText(['bgGreenBright', 'black'], 'SUCCESS'),
  err: styleText(['bgRedBright', 'white'], 'ERROR'),
  info: styleText(['bgBlueBright', 'white'], 'INFO'),
  warn: styleText(['bgYellowBright', 'black'], 'WARN'),
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
