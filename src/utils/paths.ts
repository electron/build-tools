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

// Creates `<root>/buildtools` -> `src/buildtools` so depot_tools' gclient_paths
// auto-detection finds buildtools without needing CHROMIUM_BUILDTOOLS_PATH. The
// gclient solution name is `src/electron`, which makes the supported lookup
// (`<primary_solution>/buildtools` then `<gclient_root>/buildtools`) miss the
// real buildtools dir at `<root>/src/buildtools`. A symlink at the gclient
// root satisfies the second check.
export function ensureBuildtoolsSymlink(root: string): void {
  if (!fs.existsSync(root)) return;
  const linkPath = path.join(root, 'buildtools');
  const target = path.join('src', 'buildtools');
  try {
    const existing = fs.readlinkSync(linkPath);
    if (existing === target) return;
    // A different symlink — replace it.
    fs.unlinkSync(linkPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EINVAL' || code === 'UNKNOWN') {
      // Path exists but is not a symlink — leave it alone.
      return;
    }
    if (code !== 'ENOENT') throw err;
  }
  // Windows junctions require an existing target; skip if not synced yet.
  if (process.platform === 'win32' && !fs.existsSync(path.join(root, target))) {
    return;
  }
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}
