import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { color } from './logging.js';

export function resolvePath(p: string): string {
  if (path.isAbsolute(p)) return p;
  if (p.startsWith('~/')) return path.resolve(os.homedir(), p.substr(2));
  return path.resolve(process.cwd(), p);
}

export function ensureDir(dir: string): void {
  dir = resolvePath(dir);
  if (!fs.existsSync(dir)) {
    console.log(`Creating ${color.path(dir)}`);
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function deleteDir(dir: string): void {
  fs.rmSync(dir, { force: true, recursive: true });
}
