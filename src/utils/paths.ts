import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { color } from './logging.js';

export function resolvePath(p: string): string {
  if (path.isAbsolute(p)) return p;
  if (p.startsWith('~/')) return path.resolve(os.homedir(), p.slice(2));
  return path.resolve(process.cwd(), p);
}

export function ensureDir(dir: string): void {
  const resolved = resolvePath(dir);
  if (!fs.existsSync(resolved)) {
    console.log(`Creating ${color.path(resolved)}`);
    fs.mkdirSync(resolved, { recursive: true });
  }
}

export function deleteDir(dir: string): void {
  fs.rmSync(dir, { force: true, recursive: true });
}
