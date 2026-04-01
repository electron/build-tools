import * as fs from 'node:fs';
import * as path from 'node:path';

import { maybeAutoFix } from './maybe-auto-fix';
import { refreshPathVariable } from './refresh-path';
import { fatal } from './logging';
import { pathKey } from './path-key';

const isWindows = process.platform === 'win32';

function isExecutable(p: string): boolean {
  try {
    if (isWindows) {
      fs.accessSync(p, fs.constants.F_OK);
      return fs.statSync(p).isFile();
    }
    fs.accessSync(p, fs.constants.F_OK | fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Locate an executable on PATH. Returns the resolved absolute path, or null
 * if not found. Mirrors the subset of `which` behavior needed by build-tools.
 */
export function which(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = pathKey(env);
  const envPath = env[key] ?? '';
  const dirs = envPath.split(path.delimiter).filter(Boolean);

  const exts = isWindows
    ? (env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      if (isExecutable(candidate)) return candidate;
    }
    // On Windows, also try the bare name in case it already has an extension.
    if (isWindows) {
      const bare = path.join(dir, cmd);
      if (isExecutable(bare)) return bare;
    }
  }
  return null;
}

export function commandExists(cmd: string): boolean {
  return which(cmd) !== null;
}

export function whichAndFix(cmd: string, check: (() => boolean) | null, fix: () => void): void {
  const found = check ? check() : which(cmd) !== null;
  if (!found) {
    maybeAutoFix(
      fix,
      new Error(
        `A required dependency "${cmd}" could not be located, it probably has to be installed.`,
      ),
    );

    refreshPathVariable();

    if (!(check ? check() : which(cmd) !== null)) {
      fatal(
        `A required dependency "${cmd}" could not be located and we could not install it - it likely has to be installed manually.`,
      );
    }
  }
}
